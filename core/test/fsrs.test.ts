import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FsrsState, Rating } from "../src/types.ts";
import { initFsrs, isDue, retrievability, schedule } from "../src/fsrs.ts";

const DAY = 86_400_000;
const now = new Date("2026-01-01T12:00:00.000Z");
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-10,
	`${actual} differs from ${expected}`);
const reviewCard = (): FsrsState => ({
	state: 2, stability: 10, difficulty: 5, reps: 5, lapses: 0,
	due: now.toISOString(), lastReview: new Date(now.getTime() - 10 * DAY).toISOString(),
});

describe("FSRS scheduling", () => {
	test("new cards are immediately due and have no review history", () => {
		const state = initFsrs(now);
		assert.equal(state.state, 0);
		assert.equal(state.reps, 0);
		assert.equal(state.lapses, 0);
		assert.equal(state.lastReview, undefined);
		assert.equal(retrievability(state, now), 0);
		assert.equal(isDue(state, now), true);
	});
	for (const [rating, minutes] of [[1, 1], [2, 5], [3, 10]] as const) {
		test(`new rating ${rating} learns in ${minutes} minutes`, () => {
			const result = schedule(initFsrs(now), rating, now);
			assert.equal(result.state.state, 1);
			assert.equal(Date.parse(result.state.due) - now.getTime(), minutes * 60_000);
			close(result.log.scheduledDays, minutes / 1440);
			assert.equal(result.log.elapsedDays, 0);
			assert.equal(result.state.reps, 1);
		});
	}
	test("new Easy graduates to review with initial stability and difficulty", () => {
		const result = schedule(initFsrs(now), 4, now);
		assert.equal(result.state.state, 2);
		assert.equal(result.state.stability, 15.69105);
		close(result.state.difficulty, 7.1949 - Math.exp(0.5345 * 3) + 1);
		assert.equal(result.log.scheduledDays, 16);
	});
	for (const rating of [3, 4] as const) {
		test(`rating ${rating} intervals increase over successive due reviews`, () => {
			let result = schedule(initFsrs(now), rating, now);
			let previous = result.log.scheduledDays;
			for (let i = 0; i < 6; i++) {
				result = schedule(result.state, rating, new Date(result.state.due));
				if (previous < 36500) assert.ok(result.log.scheduledDays > previous);
				else assert.equal(result.log.scheduledDays, 36500);
				assert.equal(result.state.state, 2);
				assert.ok(result.log.scheduledDays >= 1);
				previous = result.log.scheduledDays;
			}
		});
	}
	test("a review lapse increments lapses and schedules relearning in minutes", () => {
		const result = schedule(reviewCard(), 1, now);
		assert.equal(result.state.state, 3);
		assert.equal(result.state.lapses, 1);
		assert.equal(Date.parse(result.state.due) - now.getTime(), 60_000);
		const again = schedule(result.state, 1, new Date(result.state.due));
		assert.equal(again.state.lapses, 1);
		const hard = schedule(again.state, 2, new Date(again.state.due));
		assert.equal(hard.state.state, 3);
		close(hard.log.scheduledDays, 5 / 1440);
		const good = schedule(hard.state, 3, new Date(hard.state.due));
		assert.equal(good.state.state, 2);
		assert.ok(good.log.scheduledDays >= 1);
	});
	test("retrievability is about 90% at the scheduled review interval", () => {
		for (const rating of [2, 3, 4] as const) {
			const { state } = schedule(reviewCard(), rating, now);
			assert.ok(Math.abs(retrievability(state, new Date(state.due)) - 0.9) < 0.01);
			assert.equal(retrievability(state, now), 1);
			assert.equal(retrievability(state, new Date(now.getTime() - DAY)), 1);
		}
	});
	test("isDue handles before, at, and after the due instant", () => {
		const { state } = schedule(initFsrs(now), 4, now);
		const due = Date.parse(state.due);
		assert.equal(isDue(state, new Date(due - 1)), false);
		assert.equal(isDue(state, new Date(due)), true);
		assert.equal(isDue(state, new Date(due + 1)), true);
	});
	test("long-term equations use prior difficulty, recall, penalties, and mean reversion", () => {
		for (const rating of [1, 2, 3, 4] as const) {
			const { state, log } = schedule(reviewCard(), rating, now);
			const recall = 10 * (1 + Math.exp(1.54575) * 6 * 10 ** -0.1192
				* (Math.exp(0.1 * 1.01925) - 1) * (rating === 2 ? 0.2315 : 1)
				* (rating === 4 ? 2.9898 : 1));
			const forget = 1.9395 * 5 ** -0.11 * (11 ** 0.29605 - 1) * Math.exp(0.1 * 2.2698);
			close(state.stability, rating === 1
				? Math.min(forget, recall, 10 / Math.exp(0.51655 * 0.6621)) : recall);
			close(state.difficulty, Math.min(10, Math.max(1,
				0.0046 * (7.1949 - Math.exp(0.5345 * 3) + 1) + 0.9954 * (5 - 1.4604 * (rating - 3)))));
			assert.equal(log.elapsedDays, 10);
			assert.equal(log.rating, rating);
			assert.equal(log.reviewedAt, now.toISOString());
		}
	});
	test("same-day stability uses FSRS-5 short-term weights", () => {
		for (const rating of [1, 2, 3, 4] as const) {
			const card = { ...reviewCard(), lastReview: new Date(now.getTime() - 60_000).toISOString() };
			const { state } = schedule(card, rating, now);
			close(state.stability, 10 * Math.exp(0.51655 * (rating - 3 + 0.6621)));
		}
	});
	test("learning Hard stays in minutes and Good graduates", () => {
		const { state } = schedule(initFsrs(now), 2, now);
		const hard = schedule(state, 2, new Date(state.due));
		assert.equal(hard.state.state, 1);
		close(hard.log.scheduledDays, 5 / 1440);
		const good = schedule(hard.state, 3, new Date(hard.state.due));
		assert.equal(good.state.state, 2);
		assert.ok(good.log.scheduledDays >= 1);
	});
	test("review intervals are integral days bounded between 1 and 36500", () => {
		for (const stability of [0.01, 0.5, 1, 100, 1e8]) {
			for (const rating of [2, 3, 4] as const) {
				const result = schedule({ ...reviewCard(), stability }, rating, now);
				assert.equal(result.state.state, 2);
				assert.ok(Number.isInteger(result.log.scheduledDays));
				assert.ok(result.log.scheduledDays >= 1 && result.log.scheduledDays <= 36500);
			}
		}
	});
	test("does not mutate state and rejects invalid ratings", () => {
		const card = Object.freeze(reviewCard());
		const snapshot = { ...card };
		assert.notEqual(schedule(card, 3, now).state, card);
		assert.deepEqual(card, snapshot);
		assert.throws(() => schedule(card, 5 as Rating, now), /Invalid FSRS rating/);
	});
});
