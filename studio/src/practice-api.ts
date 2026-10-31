import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PracticeStore, validateChallenge } from "../../core/src/practice.ts";
import { StateStore } from "../../core/src/state.ts";
import { MemoryStore } from "../../core/src/memory.ts";
import { slugify } from "../../core/src/slug.ts";
import type { Attempt, Challenge, MemoryItem, MemoryKind, Outcome, PsiState } from "../../core/src/types.ts";

const packsDir = fileURLToPath(new URL("../../examples/skills/", import.meta.url));
const kinds: MemoryKind[] = ["goal", "preference", "background", "strength", "struggle", "misconception",
	"insight", "constraint", "motivation"];
const outcomes: Outcome[] = ["success", "partial", "fail", "skipped"];

/** HTTP failures shared by the new server routes. */
export function apiError(status: number, message: string): Error & { status: number } {
	return Object.assign(new Error(message), { status });
}

function noSymlink(file: string): void {
	try { if (lstatSync(file).isSymbolicLink()) throw apiError(400, "Refusing symlink inside store"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** One attempt as the attempt trail sees it (GET /api/skills/:s/attempts). */
export type AttemptSummary = Pick<Attempt, "id" | "challengeId" | "outcome" | "at" | "xp" | "hintsUsed" | "lesson">
	& { answer: string };

/** A challenge as the browser may see it: answer keys and the hint ladder stay on the server. */
export type PublicChallenge = Omit<Challenge, "expected" | "acceptable" | "rubric" | "hints">
	& { hintsCount: number; attempts: number; attempted: boolean; lastOutcome: Outcome | null };

/** Strip answer keys (code challenges keep setup/tests/starterCode, which the browser sandbox runs). */
export function publicChallenge(c: Challenge, history: Attempt[] = []): PublicChallenge {
	const { expected, acceptable: _a, rubric: _r, hints, ...safe } = c;
	const mine = history.filter((a) => a.challengeId === c.id);
	// SQL code challenges are graded in the browser by comparing result rows to `expected`.
	const sandbox = c.format === "code" && c.language === "sql" && expected !== undefined ? { expected } : {};
	return { ...safe, ...sandbox, hintsCount: Array.isArray(hints) ? hints.length : 0, attempts: mine.length,
		attempted: mine.length > 0, lastOutcome: mine.at(-1)?.outcome ?? null };
}

/** Practice, memory and bundled-pack endpoints; HTTP framing belongs to server.ts. */
export class PracticeApi {
	private home: string;
	private practice: PracticeStore;
	private memory: MemoryStore;
	private state: StateStore;

	constructor(home: string) {
		this.home = resolve(home);
		this.practice = new PracticeStore(home);
		this.memory = new MemoryStore(home);
		this.state = new StateStore(home);
	}

	/** Persist selected context for the agent's next process. */
	async updateState(patch: Partial<Omit<PsiState, "updatedAt">>): Promise<PsiState> {
		return this.state.update(patch);
	}

	/** attempts.jsonl, tolerating a torn final line from a concurrent writer. */
	private attempts(skill: string): Attempt[] {
		const file = join(this.home, "skills", skill, "attempts.jsonl");
		noSymlink(file);
		let raw = "";
		try { raw = readFileSync(file, "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		return raw.split(/\r?\n/).flatMap((line) => {
			try { const value = JSON.parse(line); return value && typeof value.challengeId === "string" ? [value] : []; }
			catch { return []; }
		});
	}

	/** Newest-first attempt summaries for the attempt trail; answers are truncated, feedback omitted. */
	private recentAttempts(skill: string, url: URL): AttemptSummary[] {
		const raw = url.searchParams.get("limit");
		const limit = raw === null || raw === "" ? 40 : Number(raw);
		if (!Number.isSafeInteger(limit) || limit < 1) throw apiError(400, "limit must be a positive integer");
		return this.attempts(skill).slice(-Math.min(limit, 200)).reverse().map((a) => ({
			id: a.id, challengeId: a.challengeId, outcome: a.outcome, at: a.at, xp: Number(a.xp) || 0,
			hintsUsed: Number(a.hintsUsed) || 0,
			answer: typeof a.answer === "string" ? (a.answer.length > 200 ? a.answer.slice(0, 199) + "…" : a.answer) : "",
			...(typeof a.lesson === "string" && a.lesson.trim() ? { lesson: a.lesson } : {}),
		}));
	}

	/** Inline edit of one memory item's text and/or kind. */
	private patchMemory(id: string, body: Record<string, unknown>): MemoryItem {
		const patch: { text?: string; kind?: MemoryKind } = {};
		if (body.text !== undefined) {
			if (typeof body.text !== "string" || !body.text.trim()) throw apiError(400, "Expected non-empty text");
			if (body.text.length > 2000) throw apiError(400, "Memory text is too long");
			patch.text = body.text.trim();
		}
		if (body.kind !== undefined) {
			if (!kinds.includes(body.kind as MemoryKind)) throw apiError(400, "Expected a valid memory kind");
			patch.kind = body.kind as MemoryKind;
		}
		if (!Object.keys(patch).length) throw apiError(400, "Nothing to update: send text or kind");
		if (!this.memory.read().items.some((item) => item.id === id)) throw apiError(404, "Memory item not found");
		return this.memory.update(id, patch);
	}

	private packs(): { slug: string; title: string; skill: string; targetPerformance?: string;
		challenges: number; imported: boolean }[] {
		const installed = new Set(this.practice.listSkills());
		return readdirSync(packsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((entry) => {
			try {
				const plan = JSON.parse(readFileSync(join(packsDir, entry.name, "plan.json"), "utf8"));
				const challenges = JSON.parse(readFileSync(join(packsDir, entry.name, "challenges.json"), "utf8"));
				if (plan?.skill !== entry.name || !Array.isArray(challenges)) return [];
				return [{ slug: entry.name, title: plan.title ?? entry.name, skill: plan.skill,
					targetPerformance: plan.targetPerformance, challenges: challenges.length, imported: installed.has(plan.skill) }];
			} catch { return []; }
		}).sort((a, b) => a.slug.localeCompare(b.slug));
	}

	/** Copy examples/skills/<slug> into the store; importing an installed skill is a no-op, never an overwrite. */
	private importPack(slug: string): { skill: string; alreadyImported?: true } {
		if (!this.packs().some((p) => p.slug === slug)) throw apiError(404, "Pack not found");
		const source = join(packsDir, slug);
		const plan = JSON.parse(readFileSync(join(source, "plan.json"), "utf8"));
		const challenges = JSON.parse(readFileSync(join(source, "challenges.json"), "utf8"));
		if (typeof plan?.skill !== "string" || slugify(plan.skill) !== slug || !Array.isArray(challenges)) {
			throw apiError(400, "Invalid skill pack");
		}
		const skill = slug;
		const target = join(this.home, "skills", skill);
		for (const file of [join(this.home, "skills"), target,
			join(target, "plan.json"), join(target, "challenges.json")]) noSymlink(file);
		if (existsSync(target)) return { skill, alreadyImported: true };
		const normalized: Challenge[] = challenges.map((c) => ({ ...c, skill }));
		const errors = normalized.flatMap((c) => validateChallenge(c).map((e) => `${c.id}: ${e}`));
		if (errors.length) throw apiError(400, `Invalid skill pack: ${errors.slice(0, 3).join("; ")}`);
		// Stage the whole pack, then rename it into place so a crash never leaves a half-imported skill.
		const staging = join(this.home, "skills", `.import-${skill}-${process.pid}-${Date.now()}`);
		mkdirSync(staging, { recursive: true });
		writeFileSync(join(staging, "plan.json"), JSON.stringify({ ...plan, skill }, null, "\t") + "\n");
		writeFileSync(join(staging, "challenges.json"), JSON.stringify(normalized, null, "\t") + "\n");
		renameSync(staging, target);
		return { skill };
	}

	/** Return undefined for unhandled paths; all returned values are JSON serializable. */
	async handle(method: string, p: string[], url: URL, body: Record<string, unknown>): Promise<unknown> {
		if (p[1] === "state" && p.length === 2 && method === "GET") return this.state.read();
		if (p[1] === "packs") {
			if (p.length === 2 && method === "GET") return this.packs();
			if (p.length === 4 && p[3] === "import" && method === "POST") return this.importPack(p[2]);
		}
		if (p[1] === "memory") {
			if (p.length === 2 && method === "GET") return { ...this.memory.read(), summary: this.memory.summarize() };
			if (p.length === 2 && method === "POST") {
				if (!kinds.includes(body.kind as MemoryKind) || typeof body.text !== "string" || !body.text.trim()) {
					throw apiError(400, "Expected a valid memory kind and non-empty text");
				}
				if (body.text.length > 2000) throw apiError(400, "Memory text is too long");
				return this.memory.remember({ kind: body.kind as MemoryKind, text: body.text.trim(), source: "learner" });
			}
			if (p.length === 3 && method === "DELETE") {
				if (!this.memory.forget(p[2])) throw apiError(404, "Memory item not found");
				return { ok: true };
			}
			if (p.length === 3 && method === "PATCH") return this.patchMemory(p[2], body);
		}
		if (p[1] !== "skills") return undefined;
		if (p.length === 2 && method === "GET") return this.practice.listSkills();
		const skill = p[2];
		if (!skill || !this.practice.listSkills().includes(skill)) throw apiError(404, "Skill not found");
		if (p.length === 4 && p[3] === "attempts" && method === "GET") return this.recentAttempts(skill, url);
		if (p.length === 6 && p[3] === "attempts" && p[5] === "lesson" && method === "POST") {
			if (typeof body.lesson !== "string" || !body.lesson.trim()) throw apiError(400, "Expected a non-empty lesson");
			if (body.lesson.length > 2000) throw apiError(400, "Lesson is too long");
			if (!this.attempts(skill).some((a) => a.id === p[4])) throw apiError(404, "Attempt not found");
			return this.practice.addLesson(skill, p[4], body.lesson);
		}
		if (p.length === 3 && method === "GET") {
			const history = this.attempts(skill);
			const unattempted = ["1", "true"].includes(url.searchParams.get("unattempted") ?? "");
			const challenges = this.practice.listChallenges(skill).map((c) => publicChallenge(c, history))
				.filter((c) => !unattempted || !c.attempted);
			return { plan: this.practice.readPlan(skill) ?? null, progress: this.practice.progress(skill), challenges };
		}
		if (p[3] !== "challenges" || !p[4]) return undefined;
		const challenge = this.practice.getChallenge(skill, p[4]);
		if (!challenge) throw apiError(404, "Challenge not found");
		if (p.length === 5 && method === "GET") return publicChallenge(challenge, this.attempts(skill));
		if (p.length === 6 && p[5] === "hint" && method === "GET") {
			// Zero-based, as js/widgets.js requests it (the psi_hint tool is one-based).
			const n = Number(url.searchParams.get("n") ?? 0);
			if (!Number.isSafeInteger(n) || n < 0) throw apiError(400, "Hint index must be a non-negative integer");
			return { hint: challenge.hints[n] ?? null, n, total: challenge.hints.length };
		}
		if (p.length === 6 && p[5] === "attempt" && method === "POST") {
			if (typeof body.answer !== "string") throw apiError(400, "Expected answer string");
			if (body.answer.length > 100_000) throw apiError(400, "Answer is too long");
			if (body.hintsUsed !== undefined && (!Number.isSafeInteger(body.hintsUsed) || Number(body.hintsUsed) < 0)) {
				throw apiError(400, "hintsUsed must be a non-negative integer");
			}
			if (body.lesson !== undefined && typeof body.lesson !== "string") throw apiError(400, "Invalid lesson");
			if (body.outcome !== undefined && !outcomes.includes(body.outcome as Outcome)) throw apiError(400, "Invalid outcome");
			// Code expected values describe sandbox results, not literal learner source text.
			const graded = challenge.format === "code" ? undefined : this.practice.checkAnswer(challenge, body.answer);
			const outcome = graded ?? body.outcome as Outcome | undefined;
			if (outcome === undefined) {
				if (challenge.format === "code") throw apiError(400, "Code attempts require the sandbox outcome");
				// An open answer needs the tutor's rubric judgement: nothing is recorded here; the chat
				// continuation lets the tutor grade it with psi_attempt.
				return { attempt: { challengeId: challenge.id, skill, answer: body.answer, outcome: "pending", xp: 0 },
					progress: this.practice.progress(skill), leveledUp: false, badges: [], needsGrading: true };
			}
			const result = this.practice.recordAttempt({ challengeId: challenge.id, answer: body.answer,
				outcome, hintsUsed: Number(body.hintsUsed ?? 0), lesson: body.lesson as string | undefined });
			const state = this.state.read();
			if (state.openChallenge?.skill === skill && state.openChallenge.id === challenge.id) {
				await this.updateState({ openChallenge: undefined });
			}
			return result;
		}
		return undefined;
	}
}
