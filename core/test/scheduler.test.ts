import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectNextChallenge, nextChallenge } from "../src/scheduler.ts";
import { PracticeStore } from "../src/practice.ts";
import { initFsrs, schedule } from "../src/fsrs.ts";
import type { Attempt, Challenge, SkillPlan } from "../src/types.ts";

const now = Date.parse("2026-01-10T12:00:00Z");
const challenge = (id: string, subskillId = "a", level: Challenge["level"] = 2): Challenge => ({
	id, subskillId, level, skill: "sql", kind: "apply", prompt: id, hints: [], createdAt: new Date(0).toISOString(),
});
const attempt = (id: string, c: Challenge, outcome: Attempt["outcome"] = "success", at = now): Attempt => ({
	id, challengeId: c.id, skill: "sql", subskillId: c.subskillId, outcome, at: new Date(at).toISOString(),
	answer: "", hintsUsed: 0, xp: 10,
});
const plan: SkillPlan = {
	skill: "sql", title: "SQL", targetPerformance: "Query", whyItMatters: "Data", hoursGoal: 20,
	createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), resources: [], barriers: [],
	subskills: ["a", "b"].map((id) => ({ id, title: id, why: id, priority: 1, prerequisites: [],
		selfCorrection: "Check", drills: [], status: "practicing" })),
};

test("scheduler spaces successful reviews using injected FSRS dates", () => {
	const c = challenge("review");
	const a = attempt("1", c);
	const memory = schedule(initFsrs(new Date(now)), 3, new Date(now)).state;
	const input = { challenges: [c], attempts: [a], plan };
	assert.equal(selectNextChallenge("sql", input, { now }), undefined);
	assert.equal(selectNextChallenge("sql", input, { now: Date.parse(memory.due) - 1 }), undefined);
	assert.equal(selectNextChallenge("sql", input, { now: new Date(memory.due) })?.reason, "review");
});

test("scheduler interleaves a due item after two consecutive items from one subskill", () => {
	const a = challenge("a"), b = challenge("b", "b"), fresh = challenge("new");
	const attempts = [attempt("1", b, "success", now - 86400000),
		attempt("2", a, "success", now - 1200000), attempt("3", a, "success", now - 600000)];
	const input = { challenges: [a, b, fresh], attempts, plan };
	assert.equal(selectNextChallenge("sql", input, { now, subskillId: "a" })?.challenge.id, b.id);
	// A third same-subskill request still obeys the due cross-subskill preference.
	input.attempts.push(attempt("4", a, "success", now - 1));
	assert.equal(selectNextChallenge("sql", input, { now, subskillId: "a" })?.challenge.id, b.id);
});

test("scheduler never bypasses the retry gap via an already due review", () => {
	for (const outcome of ["fail", "partial"] as const) {
		const c = challenge("miss"), other = challenge("other", "b");
		const input = { challenges: [c], attempts: [attempt("1", c, outcome, now - 86400000)], plan };
		assert.equal(selectNextChallenge("sql", input, { now }), undefined);
		input.attempts.push(attempt("2", other, "success", now - 2000));
		assert.equal(selectNextChallenge("sql", input, { now }), undefined);
		input.attempts.push(attempt("3", other, "success", now - 1000));
		assert.equal(selectNextChallenge("sql", input, { now })?.reason, "retry");
	}
});

test("scheduler lowers difficulty after two misses and stretches after three successes", () => {
	const old = challenge("old", "a", 3), low = challenge("low", "a", 2), high = challenge("high", "a", 4);
	const input = { challenges: [old, low, high], plan,
		attempts: [attempt("1", old, "fail", now - 2000), attempt("2", old, "partial", now - 1000)] };
	assert.equal(selectNextChallenge("sql", input, { now })?.challenge.id, low.id);
	input.attempts = [1, 2, 3].map((i) => attempt(String(i), old, "success", now - 4000 + i * 1000));
	assert.deepEqual(selectNextChallenge("sql", input, { now }), { challenge: high, reason: "stretch" });
});

test("scheduler selection is deterministic across input permutations, with id ties", () => {
	const a = challenge("a", "a", 1), b = challenge("b", "a", 1), old = challenge("old", "a", 1);
	const input = { challenges: [b, old, a], attempts: [attempt("2", old), attempt("1", old)], plan };
	const expected = { challenge: a, reason: "new" };
	assert.deepEqual(selectNextChallenge("sql", input, { now }), expected);
	assert.deepEqual(selectNextChallenge("sql", input, { now }), expected);
	assert.deepEqual(selectNextChallenge("sql", { ...input, challenges: [...input.challenges].reverse(),
		attempts: [...input.attempts].reverse() }, { now }), expected);
});

test("scheduler ignores skips and future attempts, excludes locked prerequisites and respects focus", () => {
	const a = challenge("a", "a", 1), b = challenge("b", "b", 1);
	const locked: SkillPlan = { ...plan, subskills: plan.subskills.map((s) => s.id === "b"
		? { ...s, status: "locked", prerequisites: ["a"] } : s) };
	assert.equal(selectNextChallenge("sql", { challenges: [b], attempts: [], plan: locked }, { now }), undefined);
	assert.equal(selectNextChallenge("sql", { challenges: [a], attempts: [] }, { now, subskillId: "b" }), undefined);
	assert.equal(selectNextChallenge("sql", { challenges: [a], attempts:
		[attempt("1", a, "skipped"), attempt("2", a, "fail", now + 1)] }, { now })?.reason, "new");
	assert.throws(() => selectNextChallenge("sql", { challenges: [], attempts: [] }, { now: NaN }), /date/);
});

test("default-home and custom-home scheduling use the same read-only selection", (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-scheduler-"));
	const previous = process.env.PSI_HOME;
	t.after(() => {
		if (previous === undefined) delete process.env.PSI_HOME; else process.env.PSI_HOME = previous;
		rmSync(home, { recursive: true, force: true });
	});
	process.env.PSI_HOME = home;
	const store = new PracticeStore(home);
	store.writePlan(plan);
	const c = challenge("new", "a", 1);
	writeFileSync(join(home, "skills/sql/challenges.json"), JSON.stringify([c]));
	assert.deepEqual(store.nextChallenge("sql", { now }), nextChallenge("sql", { now }));
	assert.equal(nextChallenge("sql", { now })?.challenge.id, c.id);
	// Legacy no-hints ids remain readable, and new awards use only the help-seeking id.
	mkdirSync(join(home, "skills/legacy"));
	writeFileSync(join(home, "skills/legacy/progress.json"), JSON.stringify({ badges: ["no-hints"] }));
	assert.deepEqual(store.progress("legacy").badges, ["no-hints"]);
});
