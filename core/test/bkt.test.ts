import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Mastery } from "../src/types.ts";
import { DEFAULT_BKT_PARAMS, isMastered, updateMastery } from "../src/bkt.ts";

describe("Bayesian Knowledge Tracing", () => {
	test("uses the published default parameters", () => {
		assert.deepEqual(DEFAULT_BKT_PARAMS, { pInit: 0.2, pTransit: 0.15, pSlip: 0.1, pGuess: 0.2 });
	});
	test("correct observations increase knowledge toward mastery", () => {
		let m: Mastery | undefined;
		for (let i = 0; i < 10; i++) {
			const next = updateMastery(m, "idea", true);
			assert.ok(next.pKnown > (m?.pKnown ?? 0.2));
			assert.ok(next.pKnown <= 1);
			m = next;
		}
		assert.ok(isMastered(m));
	});
	test("mastery threshold is inclusive at 0.95", () => {
		const m = updateMastery(undefined, "idea", true);
		assert.equal(isMastered(), false);
		assert.equal(isMastered({ ...m, pKnown: 0.949999 }), false);
		assert.equal(isMastered({ ...m, pKnown: 0.95 }), true);
	});
	test("incorrect evidence lowers knowledge before the learning transition", () => {
		const prev: Mastery = { conceptId: "idea", pKnown: 0.8, attempts: 4, correct: 4 };
		const posterior = 0.8 * 0.1 / (0.8 * 0.1 + 0.2 * 0.8);
		const next = updateMastery(prev, "idea", false);
		assert.ok(Math.abs(next.pKnown - (posterior + (1 - posterior) * 0.15)) < 1e-12);
		assert.ok(next.pKnown < prev.pKnown);
		assert.ok(Math.abs(updateMastery(prev, "idea", false, { pTransit: 0 }).pKnown - posterior) < 1e-12);
	});
	test("updates counters and timestamp without mutating previous mastery", () => {
		const prev = Object.freeze(updateMastery(undefined, "idea", true));
		const snapshot = { ...prev };
		const next = updateMastery(prev, "idea", false);
		assert.deepEqual(prev, snapshot);
		assert.notEqual(next, prev);
		assert.equal(next.attempts, 2);
		assert.equal(next.correct, 1);
		assert.equal(next.conceptId, "idea");
		assert.ok(Number.isFinite(Date.parse(next.lastSeen!)));
	});
	test("custom priors work and impossible evidence stays finite", () => {
		assert.equal(updateMastery(undefined, "idea", true, { pInit: 1, pTransit: 0 }).pKnown, 1);
		assert.equal(updateMastery(undefined, "idea", false, { pInit: 1, pSlip: 0 }).pKnown, 1);
		assert.throws(() => updateMastery(undefined, "idea", true, { pSlip: -1 }), /Invalid BKT/);
	});
});
