import { initFsrs, isDue, retrievability, schedule } from "./fsrs.ts";
import { PracticeStore } from "./practice.ts";
import type { Attempt, Challenge, ChallengeReason, SkillPlan } from "./types.ts";

/** Why a practice item was selected. */
export type { ChallengeReason } from "./types.ts";
/** Optional focus and clock; numeric clocks are milliseconds since the epoch. */
export interface SchedulerOptions { subskillId?: string; now?: number | Date }
/** A selected item and its presentation reason. */
export interface ChallengeSelection { challenge: Challenge; reason: ChallengeReason }
/** Read-only snapshot supplied by PracticeStore; selection never persists memory state. */
export interface SchedulerInput {
	challenges: readonly Challenge[];
	attempts: readonly Attempt[];
	plan?: SkillPlan;
}

const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Select from the default practice home; custom homes use PracticeStore.nextChallenge. */
export function nextChallenge(skill: string, opts: SchedulerOptions = {}): ChallengeSelection | undefined {
	return new PracticeStore().nextChallenge(skill, opts);
}

/**
 * Replay success as Good (3), partial as Hard (2), fail as Again (1); ignore skipped attempts.
 * Attempt timestamps do not measure time spent answering, so Easy is never inferred.
 * Due reviews and gap-separated retries mix with new items and one nearest level-up item.
 * Recent performance estimates success near 70–85%; two misses lower the target level, three wins raise it.
 * Chronological history uses id ties, as does candidate ranking, independently of snapshot input order.
 */
export function selectNextChallenge(
	skill: string, input: SchedulerInput, opts: SchedulerOptions = {},
): ChallengeSelection | undefined {
	const now = new Date(opts.now ?? Date.now());
	if (!Number.isFinite(now.getTime())) throw new Error("Invalid scheduler date");
	const challenges = input.challenges.filter((c) => c.skill === skill).slice()
		.sort((a, b) => compareId(a.id, b.id));
	const byId = new Map(challenges.map((c) => [c.id, c]));
	const history = input.attempts.filter((a) => a.skill === skill && a.outcome !== "skipped"
		&& Number.isFinite(Date.parse(a.at)) && Date.parse(a.at) <= now.getTime()).slice()
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || compareId(a.id, b.id));
	const subs = new Map(input.plan?.subskills.map((s) => [s.id, s]));
	const solid = new Set(input.plan?.subskills.filter((s) => s.status === "solid").map((s) => s.id));
	const accessible = (c: Challenge): boolean => {
		const sub = c.subskillId === undefined ? undefined : subs.get(c.subskillId);
		return !input.plan || c.subskillId === undefined || !!sub && sub.prerequisites.every((id) => solid.has(id));
	};
	const subskill = (a: Attempt): string | undefined => byId.get(a.challengeId)?.subskillId ?? a.subskillId;
	const recent = history.filter((a) => byId.has(a.challengeId)
		&& (opts.subskillId === undefined || subskill(a) === opts.subskillId)).slice(-5);
	const levels = recent.map((a) => byId.get(a.challengeId)!.level).sort((a, b) => a - b);
	const typical = levels.length ? levels[Math.floor(levels.length / 2)] : 1;
	const misses = recent.length >= 2 && recent.slice(-2).every((a) => a.outcome !== "success");
	const wins = recent.length >= 3 && recent.slice(-3).every((a) => a.outcome === "success");
	const target = Math.max(1, Math.min(5, typical + (misses ? -1 : wins ? 1 : 0)));
	const successRate = (recent.filter((a) => a.outcome === "success").length + 3.2) / (recent.length + 4);
	const expected = (c: Challenge): number => Math.max(0.05, Math.min(0.95,
		successRate - 0.15 * (c.level - typical)));
	const focused = (c: Challenge): boolean => opts.subskillId === undefined || c.subskillId === opts.subskillId;
	const candidates: (ChallengeSelection & { due: boolean })[] = [];
	const untried: Challenge[] = [];
	for (const challenge of challenges) {
		if (!accessible(challenge)) continue;
		const own = history.flatMap((a, index) => a.challengeId === challenge.id ? [{ attempt: a, index }] : []);
		const last = own.at(-1);
		if (!last) {
			if (focused(challenge)) untried.push(challenge);
			continue;
		}
		let memory = initFsrs(new Date(own[0].attempt.at));
		for (const { attempt } of own) {
			memory = schedule(memory, attempt.outcome === "success" ? 3 : attempt.outcome === "partial" ? 2 : 1,
				new Date(attempt.at)).state;
		}
		const due = isDue(memory, now) || retrievability(memory, now) < 0.9;
		const status = subs.get(challenge.subskillId ?? "")?.status;
		const reviewable = status === "solid" || status === "practicing";
		if (last.attempt.outcome !== "success") {
			// This gate applies even if the failed item's FSRS learning step is already due.
			if (history.length - last.index - 1 >= 2 && (focused(challenge) || reviewable)) {
				candidates.push({ challenge, reason: "retry", due });
			}
		} else if (due && reviewable) candidates.push({ challenge, reason: "review", due });
	}
	const stretch = untried.filter((c) => c.level > typical)
		.sort((a, b) => a.level - b.level || compareId(a.id, b.id))[0];
	for (const challenge of untried) {
		if (challenge.level <= typical || challenge === stretch) {
			candidates.push({ challenge, reason: challenge === stretch ? "stretch" : "new", due: false });
		}
	}
	const lastTwo = history.slice(-2);
	const lastSub = lastTwo.length === 2 ? subskill(lastTwo[1]) : undefined;
	const interleave = lastSub !== undefined && subskill(lastTwo[0]) === lastSub;
	const otherDue = candidates.filter((c) => c.due && c.challenge.subskillId !== lastSub);
	const pool = interleave && otherDue.length ? otherDue : candidates;
	pool.sort((a, b) => {
		const direction = misses || wins
			? Math.abs(a.challenge.level - target) - Math.abs(b.challenge.level - target) : 0;
		return direction || Number(b.due) - Number(a.due)
			|| Math.abs(expected(a.challenge) - 0.775) - Math.abs(expected(b.challenge) - 0.775)
			|| compareId(a.challenge.id, b.challenge.id);
	});
	const pick = pool[0];
	return pick && { challenge: pick.challenge, reason: pick.reason };
}
