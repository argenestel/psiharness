import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { levelFor, newBadges, updateStreak, xpFor } from "./gamify.ts";
import type { Attempt, Challenge, Outcome, PracticeSession, Progress, SkillPlan, Subskill } from "./types.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateSkill(skill: string): void {
	if (typeof skill !== "string" || !SLUG.test(skill)) throw new Error(`Invalid skill slug: ${skill}`);
}

function assertNoSymlink(root: string, target: string): void {
	const relative = path.relative(root, target);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path escapes store root: ${target}`);
	}
	// As in PsiStore, the configured root itself may be a symlink; descendants may not.
	let current = root;
	for (const component of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		try {
			if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink inside store: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

function readText(root: string, file: string): string | undefined {
	assertNoSymlink(root, file);
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function parseJson<T>(text: string, location: string): T {
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		throw new Error(`Invalid JSON in ${location}`, { cause: error });
	}
}

function atomicWrite(root: string, file: string, text: string): void {
	assertNoSymlink(root, file);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	assertNoSymlink(root, file);
	const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporary, text, { flag: "wx" });
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function normalize(answer: string): string {
	// Preserve signs, decimal points and percent markers; strip wrappers and sentence punctuation.
	return answer.toLowerCase().trim().replace(/[−‐‑‒–—﹣－]/gu, "-")
		.replace(/^[\s"'`“”‘’([{!?,:;]+|[\s"'`“”‘’)\]}!?.,:;]+$/gu, "")
		.trim().replace(/\s+/g, " ");
}

function numeric(text: string): number | undefined {
	// Percentages always mean fractions: 75% = 0.75, never 75.
	const percent = text.endsWith("%");
	const body = percent ? text.slice(0, -1).trim() : text;
	const parts = body.split("/").map((part) => part.trim());
	if (parts.length > 2) return undefined;
	const values = parts.map((part) => {
		if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?$|^[+-]?\.\d+$/u.test(part)) return NaN;
		return Number(part.replaceAll(",", ""));
	});
	if (values.some((value) => !Number.isFinite(value)) || values[1] === 0) return undefined;
	const result = values[0] / (values[1] ?? 1) / (percent ? 100 : 1);
	return Number.isFinite(result) ? result : undefined;
}

/** Select the earliest lowest-priority unfinished subskill whose prerequisites are solid. */
export function nextSubskill(plan: SkillPlan): Subskill | undefined {
	validateSkill(plan.skill);
	const solid = new Set(plan.subskills.filter((subskill) => subskill.status === "solid").map((s) => s.id));
	let next: Subskill | undefined;
	for (const subskill of plan.subskills) {
		if (subskill.status !== "solid" && subskill.prerequisites.every((id) => solid.has(id))
			&& (!next || subskill.priority < next.priority)) next = subskill;
	}
	return next;
}

/** Synchronous practice storage; writes are atomic per file, not transactions across files. */
export class PracticeStore {
	readonly root: string;

	/** Resolve the home without creating it. */
	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.root = path.resolve(home);
	}

	private file(skill: string, name: string): string {
		validateSkill(skill);
		const file = path.join(this.root, "skills", skill, name);
		assertNoSymlink(this.root, file);
		return file;
	}

	private read<T>(skill: string, name: string): T | undefined {
		const file = this.file(skill, name);
		const text = readText(this.root, file);
		return text === undefined ? undefined : parseJson<T>(text, file);
	}

	private write(skill: string, name: string, value: unknown): void {
		atomicWrite(this.root, this.file(skill, name), JSON.stringify(value, null, "\t") + "\n");
	}

	private lines<T>(skill: string, name: string): T[] {
		const file = this.file(skill, name);
		return (readText(this.root, file) ?? "").split(/\r?\n/).flatMap((line, i) =>
			line.trim() ? [parseJson<T>(line, `${file}:${i + 1}`)] : []);
	}

	private writeLines(skill: string, name: string, values: unknown[]): void {
		atomicWrite(this.root, this.file(skill, name), values.map((value) => JSON.stringify(value) + "\n").join(""));
	}

	/** List valid skill directories alphabetically, ignoring files and symlink entries. */
	listSkills(): string[] {
		const directory = path.join(this.root, "skills");
		assertNoSymlink(this.root, directory);
		try {
			return fs.readdirSync(directory, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && SLUG.test(entry.name)).map((entry) => entry.name).sort();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}

	/** Read a skill plan, returning undefined only when absent. */
	readPlan(skill: string): SkillPlan | undefined { return this.read(skill, "plan.json"); }

	/** Persist a skill plan as tab-indented JSON. */
	writePlan(plan: SkillPlan): void { this.write(plan.skill, "plan.json", plan); }

	/** Select the next available subskill without mutating the plan. */
	nextSubskill(plan: SkillPlan): Subskill | undefined { return nextSubskill(plan); }

	/** Update a known subskill's status. */
	setSubskillStatus(skill: string, id: string, status: Subskill["status"]): void {
		const plan = this.readPlan(skill);
		const subskill = plan?.subskills.find((candidate) => candidate.id === id);
		if (!plan || !subskill) throw new Error(`Unknown subskill: ${id}`);
		subskill.status = status;
		plan.updatedAt = new Date().toISOString();
		this.writePlan(plan);
	}

	/** Create and persist a uniquely identified challenge. */
	addChallenge(draft: Omit<Challenge, "id" | "createdAt" | "hints"> & { hints?: string[] }): Challenge {
		const challenges = this.listChallenges(draft.skill);
		const challenge: Challenge = { ...draft, id: randomUUID(), createdAt: new Date().toISOString(),
			hints: [...(draft.hints ?? [])] };
		this.write(draft.skill, "challenges.json", [...challenges, challenge]);
		return challenge;
	}

	/** Look up a challenge within a validated skill. */
	getChallenge(skill: string, id: string): Challenge | undefined {
		return this.listChallenges(skill).find((challenge) => challenge.id === id);
	}

	/** List challenges, optionally filtering by subskill and absence of attempts. */
	listChallenges(skill: string, opts: { subskillId?: string; unattempted?: boolean } = {}): Challenge[] {
		const challenges = this.read<Challenge[]>(skill, "challenges.json") ?? [];
		const attempted = opts.unattempted
			? new Set(this.lines<Attempt>(skill, "attempts.jsonl").map((a) => a.challengeId)) : new Set<string>();
		return challenges.filter((challenge) => (opts.subskillId === undefined || challenge.subskillId === opts.subskillId)
			&& !attempted.has(challenge.id));
	}

	/** Grade explicit expected/acceptable answers; open answers require tutor grading. */
	checkAnswer(c: Challenge, answer: string): Outcome | undefined {
		validateSkill(c.skill);
		if (!c.expected?.trim()) return undefined;
		const actual = normalize(answer);
		const number = numeric(actual);
		return [c.expected, ...(c.acceptable ?? [])].some((candidate) => {
			const expected = normalize(candidate);
			if (actual === expected) return true;
			const target = numeric(expected);
			// Explicit tolerance is absolute per Challenge; the default is relative to the expected value.
			return number !== undefined && target !== undefined
				&& Math.abs(number - target) <= (c.tolerance ?? 1e-9 * Math.max(1, Math.abs(target)));
		}) ? "success" : "fail";
	}

	/** Record an attempt, progress and badges, linking it to an open session when present. */
	recordAttempt(draft: Omit<Attempt, "id" | "at" | "xp" | "skill" | "subskillId"> & { at?: string }): {
		attempt: Attempt; progress: Progress; leveledUp: boolean; badges: string[];
	} {
		// The stable draft has no skill: resolve its globally generated challenge id across skills.
		const challenge = this.listSkills().flatMap((skill) => this.listChallenges(skill))
			.find((candidate) => candidate.id === draft.challengeId);
		if (!challenge) throw new Error(`Challenge not found: ${draft.challengeId}`);
		const skill = challenge.skill;
		const now = draft.at === undefined ? new Date() : new Date(draft.at);
		const at = now.toISOString();
		const before = this.progress(skill);
		const previousLevel = levelFor(before.xp).level;
		const history = this.lines<Attempt>(skill, "attempts.jsonl");
		const sessions = this.lines<PracticeSession>(skill, "sessions.jsonl");
		const attempt: Attempt = { ...draft, id: randomUUID(), at, skill, subskillId: challenge.subskillId,
			xp: xpFor({ ...draft, kind: challenge.kind, level: previousLevel }) };
		let progress = updateStreak({ ...before, xp: before.xp + attempt.xp, attempts: before.attempts + 1,
			successes: before.successes + Number(attempt.outcome === "success"),
			failures: before.failures + Number(attempt.outcome === "fail") }, now);
		progress.level = levelFor(progress.xp).level;
		const badges = newBadges(progress, attempt, { history, kind: challenge.kind });
		progress = { ...progress, badges: [...progress.badges, ...badges] };
		const active = sessions.findLast((session) => !session.endedAt);
		if (active) active.attemptIds.push(attempt.id);
		// Atomic replacement preserves one JSON line per attempt and existing history order.
		this.writeLines(skill, "attempts.jsonl", [...history, attempt]);
		if (active) this.writeLines(skill, "sessions.jsonl", sessions);
		this.write(skill, "progress.json", progress);
		return { attempt, progress, leveledUp: progress.level > previousLevel, badges };
	}

	/** Close any prior session for this skill, then start a fresh session. */
	startSession(skill: string, focus?: string, now: Date = new Date()): PracticeSession {
		const startedAt = now.toISOString();
		this.endSession(skill, now);
		const sessions = this.lines<PracticeSession>(skill, "sessions.jsonl");
		const session: PracticeSession = { id: randomUUID(), skill, focus, startedAt, attemptIds: [] };
		this.writeLines(skill, "sessions.jsonl", [...sessions, session]);
		return session;
	}

	/** Find the latest open session for one skill or across all skills. */
	activeSession(skill?: string): PracticeSession | undefined {
		const skills = skill === undefined ? this.listSkills() : [skill];
		return skills.flatMap((name) => this.lines<PracticeSession>(name, "sessions.jsonl"))
			.filter((session) => !session.endedAt).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
	}

	/** Close a session once, atomically rewriting its JSONL row and crediting up to three hours. */
	endSession(skill: string, now: Date = new Date()): PracticeSession | undefined {
		const sessions = this.lines<PracticeSession>(skill, "sessions.jsonl");
		const active = sessions.findLast((session) => !session.endedAt);
		if (!active) return undefined;
		active.endedAt = now.toISOString();
		active.minutes = Math.max(0, Math.min(180, Math.round((now.getTime() - Date.parse(active.startedAt)) / 60_000)));
		const progress = this.progress(skill);
		progress.minutesLogged += active.minutes;
		// A skipped placeholder permits time badges even before the first attempt; only hour badges apply here.
		const last = this.lines<Attempt>(skill, "attempts.jsonl").at(-1);
		const earned = last ? newBadges(progress, last) : newBadges(progress, {
			id: "", challengeId: "", skill, at: active.endedAt, answer: "", outcome: "skipped", hintsUsed: 0, xp: 0,
		});
		progress.badges.push(...earned.filter((badge) => badge.startsWith("hour-")));
		this.writeLines(skill, "sessions.jsonl", sessions);
		this.write(skill, "progress.json", progress);
		return active;
	}

	/** Read progress, or return an empty independent value for an unpracticed skill. */
	progress(skill: string): Progress {
		return this.read<Progress>(skill, "progress.json") ?? {
			skill, xp: 0, level: 1, streakDays: 0, minutesLogged: 0, attempts: 0, successes: 0, failures: 0, badges: [],
		};
	}

	/** Return logged practice hours (two decimals) and the planned hour goal. */
	hours(skill: string): { logged: number; goal: number } {
		return { logged: Math.round(this.progress(skill).minutesLogged / 60 * 100) / 100,
			goal: this.readPlan(skill)?.hoursGoal ?? 20 };
	}
}
