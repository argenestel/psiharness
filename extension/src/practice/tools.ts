import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChallengeKind, MemoryKind, Outcome, SkillPlan } from "../../../core/src/types.ts";
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
function result(details: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }], details };
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
		async execute(_id, p) { return result(memory.remember(p)); },
	}));
	pi.registerTool(defineTool({
		name: "psi_memory_recall", label: "Recall learner memory", description: "Find relevant learner observations.",
		parameters: Type.Object({
			query: optionalString(), kind: Type.Optional(memoryKind), skill: optionalString(),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
		}),
		async execute(_id, p) { return result({ items: memory.recall(p) }); },
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
hoursGoal (default 20).
Each subskill: id, title, why, priority (1–3), prerequisites (ids), selfCorrection, drills,
status (locked/active/practicing/solid).
Resources: {title,url?,why}; barriers: {barrier,fix,done}. For get/next, optional plan.skill selects a skill.`,
		parameters: Type.Object({
			action: choice(["create", "update", "get", "next"] as const), plan: Type.Optional(Type.Unknown()),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			if (p.action === "create" || p.action === "update") {
				const parsed = parsePlan(p.plan);
				if (!parsed.plan) return result({ errors: parsed.errors });
				const old = practice.readPlan(parsed.plan.skill);
				if (p.action === "create" && old) return result({ errors: ["Plan exists; use update."] });
				if (p.action === "update" && !old) return result({ errors: ["No plan exists; use create."] });
				parsed.plan.createdAt = old?.createdAt ?? parsed.plan.createdAt;
				practice.writePlan(parsed.plan);
				deps.activate(parsed.plan.skill);
				deps.refresh(ctx);
				return result({ plan: parsed.plan });
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
		description: "Save and present one challenge. Keep expected answers private.",
		parameters: Type.Object({
			skill: Type.String(), subskillId: optionalString(),
			kind: choice<ChallengeKind>(["quickfire", "predict", "debug", "apply", "explain", "build", "boss"]),
			level: Type.Unsafe<1 | 2 | 3 | 4 | 5>(Type.Integer({ minimum: 1, maximum: 5 })),
			prompt: Type.String(), expected: optionalString(), acceptable: Type.Optional(strings()),
			tolerance: Type.Optional(Type.Number({ minimum: 0 })), rubric: Type.Optional(strings()), hints: strings(),
		}),
		// Default tool-call rendering would expose expected/acceptable arguments in the learner UI.
		renderCall() { return { render: () => ["ψ Practice challenge"], invalidate() {} }; },
		async execute(_id, p, _signal, _update, ctx) {
			if (!slug.test(p.skill)) return result({ errors: ["skill must be kebab-case."] });
			const c = practice.addChallenge(p);
			deps.activate(c.skill);
			state.challengeId = c.id;
			state.hintIndex = 0;
			deps.refresh(ctx);
			return result({ challengeId: c.id, skill: c.skill,
				card: `ψ ${c.kind} · Level ${c.level}\n\n${c.prompt}\n\nYour turn. Ask /hint if you want a nudge.` });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_attempt", label: "Record practice attempt",
		description: "Grade a real attempt; deterministic answers override model grades.",
		parameters: Type.Object({
			challengeId: Type.String(), skill: Type.String(), answer: Type.String(), outcome: Type.Optional(outcomeSchema),
			hintsUsed: Type.Optional(Type.Integer({ minimum: 0 })), lesson: optionalString(), feedback: optionalString(),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const c = practice.getChallenge(p.skill, p.challengeId);
			if (!c) return result({ errors: ["Challenge not found for this skill."] });
			const outcome = practice.checkAnswer(c, p.answer) ?? p.outcome;
			if (!outcome) return result({ errors: ["Open answer requires an explicit outcome graded against the rubric."] });
			const hintsUsed = p.hintsUsed ?? (state.skill === p.skill && state.challengeId === c.id ? state.hintIndex : 0);
			const recorded = practice.recordAttempt({ ...p, outcome, hintsUsed });
			deps.activate(p.skill);
			const report = progressReport(practice, p.skill);
			if (state.challengeId === c.id) { state.challengeId = undefined; state.hintIndex = 0; }
			deps.refresh(ctx);
			return result({ outcome, xp: recorded.attempt.xp, level: report.level, leveledUp: recorded.leveledUp,
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
		parameters: Type.Object({ challengeId: Type.String(), skill: Type.String(), n: Type.Integer() }),
		async execute(_id, p) {
			const c = practice.getChallenge(p.skill, p.challengeId);
			if (!c) return result({ errors: ["Challenge not found for this skill."] });
			if (!c.hints.length) return result({ hint: null, message: "No hints in this ladder." });
			const n = Math.max(1, Math.min(c.hints.length, p.n));
			if (state.skill === p.skill && state.challengeId === c.id) state.hintIndex = Math.max(state.hintIndex, n);
			return result({ n, total: c.hints.length, hint: c.hints[n - 1], clamped: n !== p.n });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_practice_session", label: "Practice session",
		description: "Start/stop a timed practice block or show its status.",
		parameters: Type.Object({
			action: choice(["start", "stop", "status"] as const), skill: Type.String(), focus: optionalString(),
			minutes: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 180 })),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			deps.activate(p.skill);
			if (p.action === "start") {
				if (!practice.activeSession(p.skill)) practice.startSession(p.skill, p.focus);
				state.plannedMinutes = p.minutes ?? 20;
			}
			const stopped = p.action === "stop" ? practice.endSession(p.skill) : undefined;
			const session = practice.activeSession(p.skill);
			deps.refresh(ctx);
			return result({ session: stopped ?? session, active: !!session,
				elapsedMinutes: session ? Math.max(0, (Date.now() - Date.parse(session.startedAt)) / 60000) : 0,
				plannedMinutes: state.plannedMinutes ?? 20, hours: practice.hours(p.skill),
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
