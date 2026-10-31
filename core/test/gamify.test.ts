import { test } from "node:test";
import * as assert from "node:assert/strict";
import { comboBonus, levelFor, levelTitle, newBadges, updateStreak, xpFor } from "../src/gamify.ts";
import type { Attempt, ChallengeKind, Progress } from "../src/types.ts";

function progress(patch: Partial<Progress> = {}): Progress {
	return { skill: "sql", xp: 0, level: 1, streakDays: 0, minutesLogged: 0,
		attempts: 0, successes: 0, failures: 0, badges: [], ...patch };
}

function attempt(patch: Partial<Attempt> = {}): Attempt {
	return { id: "a", challengeId: "c", skill: "sql", subskillId: "joins", at: "2026-01-01T12:00:00Z",
		answer: "", outcome: "success", hintsUsed: 0, xp: 10, ...patch };
}

test("XP outcome and kind tables reward failure and round multiplied bases", () => {
	const rows: [ChallengeKind, number, number, number][] = [
		["quickfire", 5, 3, 2], ["predict", 10, 6, 4], ["debug", 12, 7, 5],
		["apply", 12, 7, 5], ["explain", 13, 8, 5], ["build", 20, 12, 8], ["boss", 30, 18, 12],
	];
	for (const [kind, success, partial, fail] of rows) {
		for (const [outcome, expected] of [["success", success], ["partial", partial], ["fail", fail]] as const) {
			assert.equal(xpFor({ kind, outcome, level: 1, hintsUsed: 0 }), expected);
		}
	}
});

test("XP applies level bonuses, hint floors, skipped zero, and a final lesson bonus", () => {
	const base = { kind: "boss", outcome: "fail", level: 3, hintsUsed: 1 } as const;
	assert.equal(xpFor(base), 14);
	assert.equal(xpFor({ ...base, lesson: " Try again " }), 19);
	assert.equal(xpFor({ ...base, lesson: "  " }), 14);
	assert.equal(xpFor({ ...base, hintsUsed: 100 }), 1);
	assert.equal(xpFor({ ...base, hintsUsed: 100, lesson: "Look for patterns" }), 6);
	assert.equal(xpFor({ ...base, outcome: "success", lesson: "Ignored" }), 32);
	assert.equal(xpFor({ ...base, outcome: "skipped", lesson: "Ignored" }), 0);
});

test("levels use triangular boundaries 0, 50, 150, 300, 500", () => {
	for (let level = 1; level <= 100; level++) {
		const threshold = 25 * (level - 1) * level;
		assert.deepEqual(levelFor(threshold), { level, intoLevel: 0, toNext: 50 * level });
		assert.deepEqual(levelFor(threshold + 50 * level - 1),
			{ level, intoLevel: 50 * level - 1, toNext: 1 });
	}
	assert.deepEqual(levelFor(-1), levelFor(0));
	assert.throws(() => levelFor(Infinity), /finite/);
});

test("streaks use local calendar dates, preserve same/future days, and do not mutate", () => {
	const now = new Date(2026, 2, 9, 0, 5);
	const initial = progress({ streakDays: 2, lastPracticeDate: "2026-03-08" });
	assert.equal(updateStreak(initial, now).streakDays, 3);
	assert.equal(initial.streakDays, 2);
	assert.notEqual(updateStreak(initial, now), initial);
	assert.equal(updateStreak(initial, new Date(2026, 2, 8, 23, 59)).streakDays, 2);
	assert.equal(updateStreak(initial, new Date(2026, 2, 10)).streakDays, 1);
	assert.equal(updateStreak(progress(), now).streakDays, 1);
	assert.equal(updateStreak(initial, new Date(2026, 2, 7)).streakDays, 2);
	assert.equal(updateStreak(initial, now).lastPracticeDate, "2026-03-09");
	assert.equal(updateStreak(progress({ streakDays: 3, lastPracticeDate: "2025-12-31" }),
		new Date(2026, 0, 1)).streakDays, 4);
});

test("badges award first attempts, failure, bosses and attained thresholds only once", () => {
	assert.deepEqual(newBadges(progress({ attempts: 1 }), attempt({ outcome: "fail" })),
		["first-attempt", "first-fail"]);
	const p = progress({ attempts: 4, level: 5, streakDays: 3, minutesLogged: 60 });
	assert.deepEqual(newBadges(p, attempt(), { kind: "boss" }),
		["boss-slayer", "streak-3", "hour-1", "level-5"]);
	assert.deepEqual(newBadges({ ...p, badges: ["boss-slayer", "streak-3", "hour-1", "level-5"] },
		attempt(), { kind: "boss" }), []);
	assert.deepEqual(p.badges, []);
	assert.deepEqual(newBadges(progress({ attempts: 2, streakDays: 30, minutesLogged: 1200, level: 10 }), attempt()),
		["streak-3", "streak-7", "streak-30", "hour-1", "hour-5", "hour-10", "hour-20", "level-5", "level-10"]);
});

test("comeback uses consecutive failures on the same known subskill", () => {
	const p = progress({ attempts: 4 });
	const fail = attempt({ outcome: "fail" });
	assert.deepEqual(newBadges(p, attempt(), { history: [fail, attempt({ subskillId: "other" }), fail] }),
		["comeback"]);
	assert.deepEqual(newBadges(p, attempt(), { history: [fail, attempt(), fail] }), []);
	assert.deepEqual(newBadges(p, attempt({ subskillId: undefined }), { history: [fail, fail] }), []);
	assert.deepEqual(newBadges(p, attempt({ outcome: "partial" }), { history: [fail, fail] }), []);
	assert.deepEqual(newBadges(p, attempt()), []);
});

test("no-hints requires five consecutive hint-free successes including the current attempt", () => {
	const p = progress({ attempts: 5 });
	const history = Array.from({ length: 4 }, () => attempt());
	assert.deepEqual(newBadges(p, attempt(), { history }), ["no-hints"]);
	assert.deepEqual(newBadges(p, attempt({ hintsUsed: 1 }), { history }), []);
	assert.deepEqual(newBadges(p, attempt(), { history: history.slice(1) }), []);
	assert.deepEqual(newBadges(p, attempt(), { history: [attempt({ outcome: "partial" }), ...history.slice(1)] }), []);
	assert.deepEqual(newBadges(p, attempt(), { history: [attempt({ hintsUsed: 1 }), ...history.slice(1)] }), []);
});

test("comboBonus returns the documented success XP multiplier at every boundary", () => {
	for (const [combo, expected] of [[-1, 1], [0, 1], [1, 1], [2, 1], [3, 1.2], [4, 1.2], [5, 1.5], [100, 1.5]]) {
		assert.equal(comboBonus(combo), expected);
	}
});

test("levelTitle covers all bands and levels below one", () => {
	const titles = ["Getting started", "Finding your feet", "Building momentum", "Building momentum",
		"Solid foundations", "Solid foundations", "Confident", "Confident", "Confident", "Expert in the making"];
	for (const [i, title] of titles.entries()) assert.equal(levelTitle(i + 1), title);
	assert.equal(levelTitle(-10), titles[0]);
	assert.equal(levelTitle(0), titles[0]);
	assert.equal(levelTitle(100), titles[9]);
});
