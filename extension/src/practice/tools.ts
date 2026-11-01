import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ProfileStore } from "../../../core/src/profile.ts";
import { comboBonus } from "../../../core/src/gamify.ts";
import { validateChallenge } from "../../../core/src/practice.ts";
import type { Attempt, Challenge, ChallengeKind, MemoryKind, Outcome, SkillPlan } from "../../../core/src/types.ts";
import { progressReport } from "./hud.ts";
import type { PracticeDeps } from "./index.ts";

const strings = () => Type.Array(Type.String());
const choice = <T extends string>(values: readonly T[]) =>
	Type.Unsafe<T>(Type.Union(values.map((v) => Type.Literal(v))));
const memoryKind = choice<MemoryKind>([
	"goal", "background", "preference", "strength", "struggle", "misconception", "insight", "motivation", "constraint",
]);
const outcomeSchema = choice<Outcome>(["success", "partial", "fail", "skipped"]);
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const optionalString = () => Type.Optional(Type.String());

/** Return model-readable text and structured details without hidden challenge answers. */
function result(details: unknown, text = JSON.stringify(details, null, 2)) {
	return { content: [{ type: "text" as const, text }], details };
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate untrusted plan input before touching storage; all problems are repairable tool results. */
function parsePlan(input: unknown): { plan?: SkillPlan; errors: string[] } {
	const errors: string[] = [];
	if (!object(input)) return { errors: ["plan must be an object."] };
	for (const key of ["skill", "title", "targetPerformance", "whyItMatters"]) {
		if (typeof input[key] !== "string" || !input[key].trim()) errors.push(`${key} must be a nonempty string.`);
	}
	if (typeof input.skill !== "string" || !slug.test(input.skill)) errors.push("skill must be kebab-case.");
	const hoursGoal = input.hoursGoal ?? 20;
	if (typeof hoursGoal !== "number" || !Number.isFinite(hoursGoal) || hoursGoal <= 0) {
		errors.push("hoursGoal must be a positive number.");
	}
	const subs = Array.isArray(input.subskills) ? input.subskills : [];
	if (!subs.length) errors.push("subskills must be a nonempty array.");
	const ids = new Set<string>();
	for (const s of subs) {
		if (!object(s)) { errors.push("Each subskill must be an object."); continue; }
		if (typeof s.id !== "string" || !slug.test(s.id)) errors.push("Subskill ids must be kebab-case.");
		else {
			if (ids.has(s.id)) errors.push(`Duplicate subskill: ${s.id}`);
			ids.add(s.id);
		}
		for (const key of ["title", "why", "selfCorrection"]) {
			if (typeof s[key] !== "string" || !s[key].trim()) errors.push(`${String(s.id)}.${key} is required.`);
		}
		if (![1, 2, 3].includes(s.priority as number)) errors.push(`${String(s.id)} priority must be 1, 2, or 3.`);
		for (const key of ["prerequisites", "drills"]) {
			if (!Array.isArray(s[key]) || !s[key].every((v: unknown) => typeof v === "string")) {
				errors.push(`${String(s.id)}.${key} must be a string array.`);
			}
		}
		if (!["locked", "active", "practicing", "solid"].includes(s.status as string)) {
			errors.push(`${String(s.id)} has an invalid status.`);
		}
	}
	const edges = new Map<string, string[]>();
	for (const s of subs) {
		if (!object(s) || typeof s.id !== "string" || !Array.isArray(s.prerequisites)) continue;
		const prereqs = s.prerequisites.filter((v: unknown): v is string => typeof v === "string");
		edges.set(s.id, prereqs);
		for (const id of prereqs) if (!ids.has(id)) errors.push(`Unknown prerequisite ${id} for ${s.id}.`);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) { errors.push(`Prerequisite cycle involving ${id}.`); return; }
		if (visited.has(id)) return;
		visiting.add(id);
		for (const parent of edges.get(id) ?? []) visit(parent);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of ids) visit(id);
	if (!Array.isArray(input.resources) || input.resources.some((r: unknown) =>
		!object(r) || typeof r.title !== "string" || typeof r.why !== "string"
		|| (r.url !== undefined && typeof r.url !== "string"))) {
		errors.push("resources require title, why, and optional url.");
	}
	if (!Array.isArray(input.barriers) || input.barriers.some((b: unknown) =>
		!object(b) || typeof b.barrier !== "string" || typeof b.fix !== "string" || typeof b.done !== "boolean")) {
		errors.push("barriers require barrier, fix, and done.");
	}
	if (errors.length) return { errors };
	const now = new Date().toISOString();
	return { errors, plan: { ...input, hoursGoal, createdAt: now, updatedAt: now } as SkillPlan };
}

function readAttempts(root: string, skill: string): Attempt[] {
	const file = join(root, "skills", skill, "attempts.jsonl");
	let raw: string;
	try {
		for (const path of [join(root, "skills"), join(root, "skills", skill), file]) {
			if (lstatSync(path).isSymbolicLink()) throw new Error("Refusing symlink: " + path);
		}
		raw = readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return raw.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as Attempt);
}

/** Resolve a challenge in the declared/active skill, falling back only when its id is globally unique. */
function resolveAttemptChallenge(practice: PracticeDeps["practice"], challengeId: string, declaredSkill?: string):
	{ skill: string; challenge: Challenge } | { error: string } {
	if (declaredSkill !== undefined) {
		if (!slug.test(declaredSkill) || !practice.listSkills().includes(declaredSkill)) {
			return { error: "Select a valid skill with /skill first." };
		}
		const challenge = practice.getChallenge(declaredSkill, challengeId);
		return challenge ? { skill: declaredSkill, challenge } : { error: "Challenge not found for this skill." };
	}
	const matches = practice.listSkills().flatMap((skill) => {
		const challenge = practice.getChallenge(skill, challengeId);
		return challenge ? [{ skill, challenge }] : [];
	});
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) {
		const skills = matches.map((match) => match.skill).join(", ");
		return { error: `Challenge "${challengeId}" exists in several skills: ${skills}; supply skill.` };
	}
	return { error: "Select a valid skill with /skill first." };
}

/** Read missed challenges without requiring a new core storage API. */
function nextChallenge(deps: PracticeDeps, skill: string): Challenge | undefined {
	const { practice } = deps;
	const plan = practice.readPlan(skill);
	const next = plan && practice.nextSubskill(plan);
	if (next) {
		const first = practice.listChallenges(skill, { subskillId: next.id, unattempted: true })[0];
		if (first) return first;
	}
	const priorities = new Map(plan?.subskills.map((s) => [s.id, s.priority]));
	const untried = practice.listChallenges(skill, { unattempted: true }).sort((a, b) =>
		(priorities.get(a.subskillId ?? "") ?? Infinity) - (priorities.get(b.subskillId ?? "") ?? Infinity));
	if (untried.length) return untried[0];
	const history = readAttempts(practice.root, skill);
	const latest = new Map<string, Attempt>();
	for (const attempt of history) {
		const previous = latest.get(attempt.challengeId);
		if (!previous || Date.parse(attempt.at) >= Date.parse(previous.at)) latest.set(attempt.challengeId, attempt);
	}
	for (const attempt of [...latest.values()].filter((a) => a.outcome === "fail")
		.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
		const challenge = practice.getChallenge(skill, attempt.challengeId);
		if (challenge) return challenge;
	}
	return undefined;
}

/** Present saved and newly created challenges through the same private widget. */
function presentChallenge(c: Challenge, deps: PracticeDeps, ctx: ExtensionContext) {
	deps.activate(c.skill);
	deps.state.challengeId = c.id;
	deps.state.hintIndex = 0;
	deps.persist();
	deps.refresh(ctx);
	const widget = { type: "challenge", skill: c.skill, id: c.id, kind: c.kind, level: c.level,
		format: c.format ?? "text", prompt: c.prompt, choices: c.choices, unit: c.unit,
		language: c.language, starterCode: c.starterCode, hintsCount: c.hints.length,
		...(c.format === "code" ? { setup: c.setup, tests: c.tests,
			...(c.language === "sql" ? { expected: c.expected } : {}) } : {}) };
	return result({ challengeId: c.id, skill: c.skill, widget },
		"The challenge card is shown to the learner; wait for their answer");
}

/** Register memory, planning, challenge, grading, and session tools. */
export function registerTools(pi: ExtensionAPI, deps: PracticeDeps): void {
	const { memory, practice, state } = deps;
	pi.registerTool(defineTool({
		name: "psi_memory_remember", label: "Remember learning",
		description: "Save a durable learning observation; never secrets.",
		parameters: Type.Object({
			kind: memoryKind, text: Type.String(), skill: optionalString(), topic: optionalString(),
			source: Type.Optional(choice(["learner", "observed", "inferred"] as const)),
		}),
		async execute(_id, p) { return result(memory.remember({ ...p, skill: p.skill ?? state.skill })); },
	}));
	pi.registerTool(defineTool({
		name: "psi_memory_recall", label: "Recall learner memory", description: "Find relevant learner observations.",
		parameters: Type.Object({
			query: optionalString(), kind: Type.Optional(memoryKind), skill: optionalString(),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
		}),
		async execute(_id, p) { return result({ items: memory.recall({ ...p, skill: p.skill ?? state.skill }) }); },
	}));
	pi.registerTool(defineTool({
		name: "psi_memory_forget", label: "Forget memory", description: "Delete one learner observation by id.",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, p) { return result({ forgotten: memory.forget(p.id) }); },
	}));
	pi.registerTool(defineTool({
		name: "psi_recap", label: "Save practice recap", description: "Save wins, struggles, and a concrete next step.",
		parameters: Type.Object({
			summary: Type.String(), wins: strings(), struggles: strings(), next: Type.String(),
			minutes: Type.Optional(Type.Number({ minimum: 0 })), skill: optionalString(),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const recap = memory.addRecap({ ...p, skill: p.skill ?? state.skill, minutes: p.minutes ?? 0 });
			deps.refresh(ctx);
			return result({ recap });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_skill_plan", label: "Skill plan",
		description: `Create/update a complete SkillPlan or get/next for the active skill.
plan fields: skill (kebab-case), title, targetPerformance, whyItMatters, subskills, resources, barriers,
hoursGoal (default 20). Updates merge subskills by id, preserving saved statuses and omitted subskills.
Use removeSubskillIds only for explicitly requested removals.
Each subskill: id, title, why, priority (1–3), prerequisites (ids), selfCorrection, drills,
status (locked/active/practicing/solid).
Resources: {title,url?,why}; barriers: {barrier,fix,done}. For get/next, optional plan.skill selects a skill.`,
		parameters: Type.Object({
			action: choice(["create", "update", "get", "next"] as const), plan: Type.Optional(Type.Unknown()),
			overwrite: Type.Optional(Type.Boolean({
				description: "Only for when the learner explicitly asks to start over; create only.",
			})),
			removeSubskillIds: Type.Optional(strings()),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			if (p.action === "create" || p.action === "update") {
				const skill = object(p.plan) && typeof p.plan.skill === "string" ? p.plan.skill : state.skill;
				if (!skill || !slug.test(skill)) return result({ errors: ["Supply a valid plan.skill."] });
				const old = practice.readPlan(skill);
				if (p.action === "create" && old && p.overwrite !== true) {
					return result({ errors: ["A plan already exists for this skill; use action \"get\" to read it "
						+ "or \"update\" to change it; do not create a new one."] });
				}
				if (p.action === "update" && !old) return result({ errors: ["No plan exists; use create."] });
				let input = p.plan;
				if (p.action === "update" && old && object(input)) {
					if (input.subskills !== undefined && (!Array.isArray(input.subskills)
						|| input.subskills.some((s) => !object(s) || typeof s.id !== "string"))) {
						return result({ errors: ["subskills must be an array of objects with ids."] });
					}
					const subs = new Map(old.subskills.map((s) => [s.id, s]));
					for (const sub of (input.subskills ?? []) as Record<string, unknown>[]) {
						const saved = subs.get(sub.id as string);
						subs.set(sub.id as string, { ...saved, ...sub,
							...(saved ? { status: saved.status } : {}) } as SkillPlan["subskills"][number]);
					}
					for (const id of p.removeSubskillIds ?? []) subs.delete(id);
					input = { ...old, ...input, subskills: [...subs.values()] };
				}
				const parsed = parsePlan(input);
				if (!parsed.plan) return result({ errors: parsed.errors });
				if (p.action === "update") parsed.plan.createdAt = old!.createdAt;
				practice.writePlan(parsed.plan);
				deps.activate(parsed.plan.skill);
				deps.refresh(ctx);
				return result({ plan: parsed.plan, overwritten: p.action === "create" && !!old },
					p.action === "create" && old ? "Existing plan overwritten at the learner’s explicit start-over request."
						: JSON.stringify({ plan: parsed.plan }, null, 2) + (p.action === "create"
							? " Gather 3–6 sources with psi_search, psi_fetch, then psi_sources add. Write the first lesson with psi_lesson write BEFORE psi_challenge." : ""));
			}
			const skill = object(p.plan) && typeof p.plan.skill === "string" ? p.plan.skill : state.skill;
			if (!skill || !slug.test(skill)) return result({ errors: ["Select a skill with /skill or supply plan.skill."] });
			const plan = practice.readPlan(skill);
			if (!plan) return result({ errors: ["No plan exists for this skill; use create."] });
			const next = practice.nextSubskill(plan);
			return result(p.action === "get" ? { plan } : { nextSubskill: next, drills: next?.drills ?? [] });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_challenge", label: "Practice challenge",
		description: "Use action next to present a ready challenge first; create saves a new one. Keep answers private.",
		parameters: Type.Object({
			action: Type.Optional(choice(["create", "next"] as const)),
			skill: optionalString(), subskillId: optionalString(),
			kind: Type.Optional(choice<ChallengeKind>(["quickfire", "predict", "debug", "apply", "explain", "build", "boss"])),
			level: Type.Optional(Type.Unsafe<1 | 2 | 3 | 4 | 5>(Type.Integer({ minimum: 1, maximum: 5 }))),
			prompt: optionalString(), expected: optionalString(), acceptable: Type.Optional(strings()),
			tolerance: Type.Optional(Type.Number({ minimum: 0 })), rubric: Type.Optional(strings()),
			hints: Type.Optional(strings()),
			format: Type.Optional(choice(["text", "number", "math", "choice", "code"] as const)),
			choices: Type.Optional(strings()), unit: optionalString(),
			language: Type.Optional(choice(["python", "javascript", "sql"] as const)),
			starterCode: optionalString(), setup: optionalString(), tests: optionalString(),
		}),
		// Default tool-call rendering would expose expected/acceptable arguments in the learner UI.
		renderCall() { return { render: () => ["ψ Practice challenge"], invalidate() {} }; },
		async execute(_id, p, _signal, _update, ctx) {
			const skill = p.skill ?? state.skill;
			if (!skill || !slug.test(skill)) return result({ errors: ["Select a skill with /skill first."] });
			if (p.action === "next") {
				const c = nextChallenge(deps, skill);
				return c ? presentChallenge(c, deps, ctx) : result({ message:
					"No challenges remain; create one with action \"create\"." });
			}
			const { action: _action, ...fields } = p;
			const draft = { ...fields, skill } as Omit<Challenge, "id" | "createdAt">;
			const errors = validateChallenge({ ...draft, id: "pending", createdAt: new Date().toISOString() });
			if (p.format === "choice" && Array.isArray(p.choices)
				&& (p.choices.length < 2 || p.choices.some((v) => typeof v !== "string" || !v.trim())
					|| new Set(p.choices).size !== p.choices.length)) {
				errors.push("choices must contain at least two distinct nonempty strings.");
			}
			if (errors.length) return result({ errors });
			const c = practice.addChallenge(draft);
			return presentChallenge(c, deps, ctx);
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_attempt", label: "Record practice attempt",
		description: "Grade a real attempt; deterministic answers override model grades. Code requires a browser-run outcome.",
		parameters: Type.Object({
			challengeId: Type.String(), skill: optionalString(), answer: Type.String(), outcome: Type.Optional(outcomeSchema),
			hintsUsed: Type.Optional(Type.Integer({ minimum: 0 })), lesson: optionalString(), feedback: optionalString(),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const resolved = resolveAttemptChallenge(practice, p.challengeId, p.skill ?? state.skill);
			if ("error" in resolved) return result({ errors: [resolved.error] });
			const { skill, challenge: c } = resolved;
			const now = Date.now();
			if (readAttempts(practice.root, skill).some((a) => a.challengeId === c.id
				&& now - Date.parse(a.at) >= 0 && now - Date.parse(a.at) <= 120000)) {
				return { ...result({ errors: ["Attempt already recorded within the last 2 minutes; coach without re-grading."] }),
					isError: true };
			}
			if (c.format === "code" && !p.outcome) {
				return result({ errors: ["code requires an explicit outcome from a code run."] });
			}
			const checked = p.outcome === "skipped" || c.format === "code" ? undefined : practice.checkAnswer(c, p.answer);
			const outcome = p.outcome === "skipped" ? "skipped" : checked ?? p.outcome;
			if (!outcome) return result({ errors: ["Open answer requires an explicit outcome graded against the rubric."] });
			const hintsUsed = p.hintsUsed ?? (state.skill === skill && state.challengeId === c.id ? state.hintIndex : 0);
			const source = checked === undefined ? "tutor" : "checked";
			const recorded = practice.recordAttempt({ ...p, skill, outcome, hintsUsed, source, verified: source === "checked" });
			deps.activate(skill);
			const report = progressReport(practice, skill);
			if (state.challengeId === c.id) { state.challengeId = undefined; state.hintIndex = 0; }
			deps.persist();
			deps.refresh(ctx);
			const combo = new ProfileStore(practice.root).summarize().combo;
			const bonus = outcome === "success" ? comboBonus(combo) : 1;
			const widget = { type: "attempt", combo, comboBonus: bonus, comboDisplayOnly: true, outcome, xp: recorded.attempt.xp, level: report.level,
				levelBar: report.levelBar, leveledUp: recorded.leveledUp, badges: recorded.badges, streak: report.streak };
			return result({ widget, combo, comboBonus: bonus, comboDisplayOnly: true, outcome, xp: recorded.attempt.xp,
				level: report.level, leveledUp: recorded.leveledUp, verified: recorded.verified, source: recorded.source,
				levelBar: report.levelBar, streak: report.streak, badges: recorded.badges,
				guidance: outcome === "fail"
					? "Experiment logged: failure still earns XP. Ask the learner what they will try differently. "
						+ "A recorded lesson earns bonus XP; include it with the attempt when available. "
						+ "Do not duplicate this attempt for a bonus."
					: "Celebrate the attempt and honest progress. Invite the next small challenge; never shame mistakes." });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_hint", label: "Challenge hint",
		description: "Show a 1-based hint from the hint ladder; clamp to its range.",
		parameters: Type.Object({ challengeId: Type.String(), skill: optionalString(), n: Type.Integer() }),
		async execute(_id, p) {
			const skill = p.skill ?? state.skill;
			if (!skill || !slug.test(skill)) return result({ errors: ["Select a valid skill with /skill first."] });
			const c = practice.getChallenge(skill, p.challengeId);
			if (!c) return result({ errors: ["Challenge not found for this skill."] });
			if (!c.hints.length) return result({ hint: null, message: "No hints in this ladder." });
			const n = Math.max(1, Math.min(c.hints.length, p.n));
			if (state.skill === skill && state.challengeId === c.id) state.hintIndex = Math.max(state.hintIndex, n);
			return result({ n, total: c.hints.length, hint: c.hints[n - 1], clamped: n !== p.n });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_practice_session", label: "Practice session",
		description: "Start/stop a timed practice block or show its status.",
		parameters: Type.Object({
			action: choice(["start", "stop", "status"] as const), skill: optionalString(), focus: optionalString(),
			minutes: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 180 })),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const skill = p.skill ?? state.skill;
			if (!skill || !slug.test(skill)) return result({ errors: ["Select a valid skill with /skill first."] });
			deps.activate(skill);
			if (p.action === "start") {
				if (!practice.activeSession(skill)) practice.startSession(skill, p.focus);
				state.plannedMinutes = p.minutes ?? 20;
			}
			const stopped = p.action === "stop" ? practice.endSession(skill) : undefined;
			const session = practice.activeSession(skill);
			deps.refresh(ctx);
			return result({ session: stopped ?? session, active: !!session,
				elapsedMinutes: session ? Math.max(0, (Date.now() - Date.parse(session.startedAt)) / 60000) : 0,
				plannedMinutes: state.plannedMinutes ?? 20, hours: practice.hours(skill),
				guidance: p.action === "stop" ? "Save psi_recap and durable learning observations."
					: "Attempt first; one challenge at a time." });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_progress_report", label: "Practice progress",
		description: "Show XP, level, streak, hours, attempts, badges, and next subskill.",
		parameters: Type.Object({ skill: optionalString() }),
		async execute(_id, p) {
			const skills = p.skill ? [p.skill] : state.skill ? [state.skill] : practice.listSkills();
			return result({ skills: skills.map((skill) => progressReport(practice, skill)) });
		},
	}));
}
