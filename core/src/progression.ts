import type { Attempt, Challenge, SkillPlan, Subskill } from "./types.ts";

function historyStatus(plan: SkillPlan, id: string, challenges: Challenge[], attempts: Attempt[]): Subskill["status"] {
	const own = challenges.filter((c) => c.skill === plan.skill && c.subskillId === id);
	const ids = new Set(own.map((c) => c.id));
	const history = attempts.filter((a) => a.skill === plan.skill && (a.subskillId === id || ids.has(a.challengeId)))
		.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	if (!history.length) return "active";
	const solved = new Set(history.filter((a) => a.outcome === "success" && ids.has(a.challengeId))
		.map((a) => a.challengeId));
	const recent = history.slice(-5);
	const gates = own.filter((c) => c.kind === "boss" || c.level >= 4);
	return own.length > 0 && solved.size >= Math.min(3, ids.size)
		&& recent.filter((a) => a.outcome === "success").length / recent.length >= 0.6
		&& gates.every((c) => solved.has(c.id)) ? "solid" : "practicing";
}

/**
 * Recompute statuses from history, ignoring saved mastery. Every boss or level >= 4 challenge must be solved;
 * absent gates impose no requirement. The last five chronological attempts (or all available) set the success rate.
 * Resolve prerequisites to a fixed point, so reverse-ordered chains work; cycles and missing prerequisites stay locked.
 */
export function reconcileStatuses(plan: SkillPlan, challenges: Challenge[], attempts: Attempt[]): SkillPlan {
	const subskills = plan.subskills.map((s) => ({ ...s, status: "locked" as Subskill["status"] }));
	const solid = new Set<string>();
	let changed: boolean;
	do {
		changed = false;
		for (const s of subskills) {
			if (s.status !== "locked" || !s.prerequisites.every((id) => solid.has(id))) continue;
			s.status = historyStatus(plan, s.id, challenges, attempts);
			if (s.status === "solid") solid.add(s.id);
			changed = true;
		}
	} while (changed);
	return { ...plan, subskills };
}

/**
 * Advance the attempted subskill without downgrading saved solid statuses. History may include the current attempt;
 * it is added once if absent. Unlock all eligible locked nodes in the same pass, but unlocking alone never masters
 * a node or satisfies its dependents' solid prerequisite. Every existing boss/level >= 4 challenge is a mastery gate.
 */
export function advanceAfterAttempt(
	plan: SkillPlan, challenges: Challenge[], attempts: Attempt[], attempt: Attempt,
): { plan: SkillPlan; unlocked: string[]; mastered: string[] } {
	const history = attempts.some((a) => a.id === attempt.id) ? attempts : [...attempts, attempt];
	const subskills = plan.subskills.map((s) => ({ ...s }));
	const solid = new Set(subskills.filter((s) => s.status === "solid").map((s) => s.id));
	const mastered: string[] = [];
	const unlocked: string[] = [];
	const challenge = challenges.find((c) => c.id === attempt.challengeId && c.skill === plan.skill);
	const target = subskills.find((s) => s.id === (challenge?.subskillId ?? attempt.subskillId));
	if (attempt.skill === plan.skill && target && target.status !== "solid"
		&& target.prerequisites.every((id) => solid.has(id))) {
		target.status = historyStatus(plan, target.id, challenges, history);
		if (target.status === "solid") {
			solid.add(target.id);
			mastered.push(target.id);
		}
	}
	for (const s of subskills) {
		if (s.status === "locked" && s.prerequisites.every((id) => solid.has(id))) {
			s.status = "active";
			unlocked.push(s.id);
		}
	}
	return { plan: { ...plan, subskills }, unlocked, mastered };
}

/** Count solid subskills and round completion to an integer percentage; empty plans are zero percent complete. */
export function skillCompletion(plan: SkillPlan): { solid: number; total: number; percent: number } {
	const total = plan.subskills.length;
	const solid = plan.subskills.filter((s) => s.status === "solid").length;
	return { solid, total, percent: total ? Math.round(solid / total * 100) : 0 };
}
