import type { Attempt, ChallengeKind, Outcome, Progress } from "./types.ts";

const BASE: Record<Outcome, number> = { success: 10, partial: 6, fail: 4, skipped: 0 };
const MULTIPLIER: Record<ChallengeKind, number> = {
	quickfire: 0.5, predict: 1, debug: 1.2, apply: 1.2, explain: 1.3, build: 2, boss: 3,
};

/** Award effort XP, including failures and lessons learned. */
export function xpFor(a: {
	outcome: Outcome; kind: ChallengeKind; level: number; hintsUsed: number; lesson?: string; selfReported?: boolean;
}): number {
	if (a.outcome === "skipped") return 0;
	if (a.selfReported && a.outcome === "success") return BASE.success;
	// Hints are help: round the base, add level and fail-lesson bonuses without hint deductions.
	const earned = Math.max(1, Math.round(BASE[a.outcome] * MULTIPLIER[a.kind])
		+ (a.level - 1) * 2);
	return earned + (a.outcome === "fail" && a.lesson?.trim() ? 5 : 0);
}

/** Return the current level and XP distances to its boundaries. */
export function levelFor(xp: number): { level: number; intoLevel: number; toNext: number } {
	if (!Number.isFinite(xp)) throw new Error("XP must be finite");
	xp = Math.max(0, xp);
	// T(L) = 50 * (L - 1) * L / 2: level 1 at 0, level 2 at 50, level 3 at 150.
	const level = Math.floor((1 + Math.sqrt(1 + 4 * xp / 25)) / 2);
	return { level, intoLevel: xp - 25 * (level - 1) * level, toNext: 25 * level * (level + 1) - xp };
}

function localDay(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
		+ `-${String(date.getDate()).padStart(2, "0")}`;
}

/** Update calendar-day streaks in local time without mutating progress. */
export function updateStreak(p: Progress, now: Date = new Date()): Progress {
	if (!Number.isFinite(now.getTime())) throw new Error("Invalid practice date");
	const today = localDay(now);
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	const previous = p.lastPracticeDate;
	const streakDays = previous && previous >= today ? p.streakDays
		: previous === localDay(yesterday) ? p.streakDays + 1 : 1;
	return { ...p, streakDays, lastPracticeDate: today };
}

/** Display text for the help-seeking badge; legacy no-hints ids remain readable in Progress.badges. */
export const HELP_THEN_SOLVE_LABEL = "Asked for help, then solved it";

/** Award new badges from updated progress; optional context supplies facts absent from the stable types. */
export function newBadges(p: Progress, a: Attempt, context: {
	history?: readonly Attempt[]; kind?: ChallengeKind;
} = {}): string[] {
	const earned: string[] = [];
	if (p.attempts === 1) earned.push("first-attempt");
	// You failed — that's how levels are won.
	if (a.outcome === "fail") earned.push("first-fail");
	// History is previous attempts, excluding a. Never infer consecutive results from aggregate counts.
	const history = context.history?.filter((previous) => previous.skill === a.skill);
	if (a.outcome === "success") {
		const sameSubskill = a.subskillId === undefined ? []
			: history?.filter((previous) => previous.subskillId === a.subskillId);
		if (sameSubskill && sameSubskill.length >= 2
			&& sameSubskill.slice(-2).every((previous) => previous.outcome === "fail")) earned.push("comeback");
		if (a.hintsUsed > 0) earned.push("help-then-solve");
		if (context.kind === "boss") earned.push("boss-slayer");
	}
	for (const days of [3, 7, 30]) if (p.streakDays >= days) earned.push(`streak-${days}`);
	for (const hours of [1, 5, 10, 20]) if (p.minutesLogged >= hours * 60) earned.push(`hour-${hours}`);
	for (const level of [5, 10]) if (p.level >= level) earned.push(`level-${level}`);
	return earned.filter((badge) => !p.badges.includes(badge));
}

/** Success XP multiplier: ×1 below three, ×1.2 at three–four, ×1.5 at five or more; never apply to fails. */
export function comboBonus(combo: number): number {
	return combo >= 5 ? 1.5 : combo >= 3 ? 1.2 : 1;
}

/** Return an encouraging title for a learner's level. */
export function levelTitle(level: number): string {
	if (level >= 10) return "Expert in the making";
	if (level >= 7) return "Confident";
	if (level >= 5) return "Solid foundations";
	if (level >= 3) return "Building momentum";
	if (level >= 2) return "Finding your feet";
	return "Getting started";
}
