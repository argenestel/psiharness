import { initFsrs, isDue, retrievability, schedule } from "./fsrs.ts";
import { PracticeStore } from "./practice.ts";
import type { Attempt, Challenge, ChallengeReason, SkillPlan } from "./types.ts";

/** Why a practice item was selected. */
export type { ChallengeReason } from "./types.ts";
/**
 * Optional focus and clock; numeric clocks are milliseconds since the epoch. `reviewOnly` restricts the choice to due
 * reviews and spaced retries (a session warm-up), across all subskills.
 */
export interface SchedulerOptions { subskillId?: string; now?: number | Date; reviewOnly?: boolean }
/**
 * A selected item and its presentation reason. `needsVariant` marks a retry whose missed item has no fresh variant yet:
 * the tutor should write one (psi_challenge create with variantOf) instead of re-serving the same question.
 */
export interface ChallengeSelection { challenge: Challenge; reason: ChallengeReason; needsVariant?: boolean }
/** Read-only snapshot supplied by PracticeStore; selection never persists memory state. */
export interface SchedulerInput {
	challenges: readonly Challenge[];
	attempts: readonly Attempt[];
	plan?: SkillPlan;
}

/** A missed item may come back after two other attempts, or after this much time (e.g. in the next session). */
export const RETRY_AFTER_MS = 30 * 60000;

const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Select from the default practice home; custom homes use PracticeStore.nextChallenge. */
export function nextChallenge(skill: string, opts: SchedulerOptions = {}): ChallengeSelection | undefined {
	return new PracticeStore().nextChallenge(skill, opts);
}

/**
 * Replay success as Good (3), partial as Hard (2), fail as Again (1); ignore skipped attempts.
 * Attempt timestamps do not measure time spent answering, so Easy is never inferred.
 * Due reviews and spaced retries mix with new items and one nearest level-up item.
 * A challenge and its variants (`variantOf`) share one memory: a missed item comes back as an unattempted variant
 * when one exists, else as itself with `needsVariant` so the tutor writes a fresh version of the same idea.
 * Recent performance estimates success near 70–85%; two misses lower the target level, three wins raise it.
 * Chronological history uses id ties, as does candidate ranking, independently of snapshot input order.
 */
export function selectNextChallenge(
	skill: string, input: SchedulerInput, opts: SchedulerOptions = {},
): ChallengeSelection | undefined {
	return rankChallenges(skill, input, opts)[0];
}

/** Due reviews and spaced retries available now, best first (what a session warm-up would serve). */
export function dueReviews(
	skill: string, input: SchedulerInput, opts: Omit<SchedulerOptions, "reviewOnly"> = {},
): ChallengeSelection[] {
	return rankChallenges(skill, input, { ...opts, reviewOnly: true });
}

type Candidate = ChallengeSelection & { due: boolean };

function rankChallenges(skill: string, input: SchedulerInput, opts: SchedulerOptions): ChallengeSelection[] {
	const now = new Date(opts.now ?? Date.now());
	if (!Number.isFinite(now.getTime())) throw new Error("Invalid scheduler date");
	const challenges = input.challenges.filter((c) => c.skill === skill).slice()
		.sort((a, b) => compareId(a.id, b.id));
	const byId = new Map(challenges.map((c) => [c.id, c]));
	const root = (c: Challenge): string => c.variantOf && byId.has(c.variantOf) ? c.variantOf : c.id;
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
	const families = new Map<string, Challenge[]>();
	for (const c of challenges) families.set(root(c), [...families.get(root(c)) ?? [], c]);
	const candidates: Candidate[] = [];
	const untried: Challenge[] = [];
	for (const members of families.values()) {
		const head = byId.get(root(members[0]!))!;
		if (!accessible(head)) continue;
		const ids = new Set(members.map((c) => c.id));
		const own = history.flatMap((a, index) => ids.has(a.challengeId) ? [{ attempt: a, index }] : []);
		const last = own.at(-1);
		if (!last) {
			for (const c of members) if (focused(c)) untried.push(c);
			continue;
		}
		let memory = initFsrs(new Date(own[0]!.attempt.at));
		for (const { attempt } of own) {
			memory = schedule(memory, attempt.outcome === "success" ? 3 : attempt.outcome === "partial" ? 2 : 1,
				new Date(attempt.at)).state;
		}
		const due = isDue(memory, now) || retrievability(memory, now) < 0.9;
		const status = subs.get(head.subskillId ?? "")?.status;
		const reviewable = status === "solid" || status === "practicing";
		// An unattempted variant is the fresh version to serve; otherwise the most recently attempted member.
		const tried = new Set(own.map((o) => o.attempt.challengeId));
		const fresh = members.filter((c) => !tried.has(c.id) && accessible(c))
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || compareId(a.id, b.id))[0];
		const lastTried = byId.get(last.attempt.challengeId)!;
		if (last.attempt.outcome !== "success") {
			// This gate applies even if the failed item's FSRS learning step is already due.
			const spaced = history.length - last.index - 1 >= 2
				|| now.getTime() - Date.parse(last.attempt.at) >= RETRY_AFTER_MS;
			if (spaced && (focused(head) || reviewable)) {
				candidates.push(fresh ? { challenge: fresh, reason: "retry", due }
					: { challenge: lastTried, reason: "retry", needsVariant: true, due });
			}
		} else if (due && reviewable) candidates.push({ challenge: fresh ?? lastTried, reason: "review", due });
	}
	if (!opts.reviewOnly) {
		const stretch = untried.filter((c) => c.level > typical)
			.sort((a, b) => a.level - b.level || compareId(a.id, b.id))[0];
		for (const challenge of untried) {
			if (challenge.level <= typical || challenge === stretch) {
				candidates.push({ challenge, reason: challenge === stretch ? "stretch" : "new", due: false });
			}
		}
	}
	const lastTwo = history.slice(-2);
	const lastSub = lastTwo.length === 2 ? subskill(lastTwo[1]!) : undefined;
	const interleave = lastSub !== undefined && subskill(lastTwo[0]!) === lastSub;
	const otherDue = candidates.filter((c) => c.due && c.challenge.subskillId !== lastSub);
	const pool = interleave && otherDue.length && !opts.reviewOnly ? otherDue : candidates;
	pool.sort((a, b) => {
		const direction = misses || wins
			? Math.abs(a.challenge.level - target) - Math.abs(b.challenge.level - target) : 0;
		return direction || Number(b.due) - Number(a.due)
			|| Math.abs(expected(a.challenge) - 0.775) - Math.abs(expected(b.challenge) - 0.775)
			|| compareId(a.challenge.id, b.challenge.id);
	});
	return pool.map(({ due: _due, ...selection }) => selection);
}
