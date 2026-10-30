import type { FsrsState, Rating, ReviewLog } from "./types.ts";
import { nowIso } from "./slug.ts";

const W = [
	0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
	1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
] as const;
const DAY = 86_400_000;
const DECAY = -0.5;
const FACTOR = 19 / 81;
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const initialDifficulty = (rating: Rating): number => clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10);
const interval = (stability: number): number =>
	clamp(Math.round(stability / FACTOR * (0.9 ** (1 / DECAY) - 1)), 1, 36500);
const elapsed = (s: FsrsState, now: Date): number =>
	s.lastReview === undefined ? 0 : Math.max(0, (now.getTime() - Date.parse(s.lastReview)) / DAY);

/** Initialize a new card, immediately due with no review history. */
export function initFsrs(now: Date = new Date()): FsrsState {
	return { state: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, due: nowIso(now) };
}

/** Estimate recall probability using elapsed fractional days; new cards have no recall history. */
export function retrievability(s: FsrsState, now: Date = new Date()): number {
	if (s.lastReview === undefined || s.stability <= 0) return 0;
	return (1 + FACTOR * elapsed(s, now) / s.stability) ** DECAY;
}

/** Whether the card's due timestamp has arrived. */
export function isDue(s: FsrsState, now: Date = new Date()): boolean {
	return Date.parse(s.due) <= now.getTime();
}

/** Apply FSRS-5 memory updates and fixed learning steps, returning fresh state and log. */
export function schedule(
	s: FsrsState, rating: Rating, now: Date = new Date(),
): { state: FsrsState; log: Omit<ReviewLog, "cardId"> } {
	if (![1, 2, 3, 4].includes(rating)) throw new Error(`Invalid FSRS rating: ${rating}`);
	const elapsedDays = elapsed(s, now);
	let stability: number;
	let difficulty: number;
	if (s.state === 0) {
		stability = W[rating - 1];
		difficulty = initialDifficulty(rating);
	} else {
		const S = Math.max(0.01, s.stability);
		const D = s.difficulty;
		difficulty = clamp(W[7] * initialDifficulty(4) + (1 - W[7]) * (D - W[6] * (rating - 3)), 1, 10);
		if (elapsedDays < 1) {
			// FSRS-5 has 19 weights: no FSRS-6 S^-w19 term. Successful short-term recall cannot reduce S.
			const multiplier = Math.exp(W[17] * (rating - 3 + W[18]));
			stability = S * (rating >= 3 ? Math.max(1, multiplier) : multiplier);
		} else {
			const R = retrievability(s, now);
			const recall = S * (1 + Math.exp(W[8]) * (11 - D) * S ** -W[9]
				* (Math.exp((1 - R) * W[10]) - 1)
				* (rating === 2 ? W[15] : 1) * (rating === 4 ? W[16] : 1));
			if (rating === 1) {
				const forget = W[11] * D ** -W[12] * ((S + 1) ** W[13] - 1) * Math.exp((1 - R) * W[14]);
				// FSRS-5 short-term cap ensures a subsequent same-day Good cannot undo a lapse.
				stability = Math.min(forget, recall, S / Math.exp(W[17] * W[18]));
			} else {
				stability = recall;
			}
		}
	}
	stability = Math.max(0.01, stability);
	let nextState: FsrsState["state"];
	let scheduledDays: number;
	if (s.state === 0 && rating !== 4) {
		nextState = 1;
		scheduledDays = [1, 5, 10][rating - 1] / 1440;
	} else if (rating === 1 || ((s.state === 1 || s.state === 3) && rating === 2)) {
		nextState = s.state === 1 ? 1 : 3;
		scheduledDays = (rating === 1 ? 1 : 5) / 1440;
	} else {
		nextState = 2;
		scheduledDays = interval(stability);
	}
	const reviewedAt = nowIso(now);
	return {
		state: {
			state: nextState, stability, difficulty,
			reps: s.reps + 1,
			lapses: s.lapses + Number(s.state === 2 && rating === 1),
			due: nowIso(new Date(now.getTime() + scheduledDays * DAY)),
			lastReview: reviewedAt,
		},
		log: { rating, reviewedAt, elapsedDays, scheduledDays },
	};
}
