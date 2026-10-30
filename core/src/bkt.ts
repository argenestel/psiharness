import type { Mastery } from "./types.ts";
import { nowIso } from "./slug.ts";

/** Probabilities controlling Bayesian Knowledge Tracing. */
export interface BktParams {
	pInit: number;
	pTransit: number;
	pSlip: number;
	pGuess: number;
}

/** Default prior, learning, slip, and guess probabilities. */
export const DEFAULT_BKT_PARAMS: Readonly<BktParams> = Object.freeze({
	pInit: 0.2, pTransit: 0.15, pSlip: 0.1, pGuess: 0.2,
});

/** Apply one observation and learning transition without mutating prior mastery. */
export function updateMastery(
	prev: Mastery | undefined, conceptId: string, correct: boolean, params: Partial<BktParams> = {},
): Mastery {
	const p = { ...DEFAULT_BKT_PARAMS, ...params };
	for (const [name, value] of Object.entries(p)) {
		if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid BKT probability: ${name}`);
	}
	const prior = prev?.pKnown ?? p.pInit;
	const known = prior * (correct ? 1 - p.pSlip : p.pSlip);
	const unknown = (1 - prior) * (correct ? p.pGuess : 1 - p.pGuess);
	// An impossible observation supplies no evidence; retain the prior before learning.
	const posterior = known + unknown === 0 ? prior : known / (known + unknown);
	return {
		conceptId,
		pKnown: posterior + (1 - posterior) * p.pTransit,
		attempts: (prev?.attempts ?? 0) + 1,
		correct: (prev?.correct ?? 0) + Number(correct),
		lastSeen: nowIso(),
	};
}

/** Whether a concept meets the 95% mastery threshold. */
export function isMastered(m?: Mastery): boolean {
	return m !== undefined && m.pKnown >= 0.95;
}
