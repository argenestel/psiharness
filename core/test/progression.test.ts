import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { advanceAfterAttempt, reconcileStatuses, skillCompletion } from "../src/progression.ts";
import { PracticeStore } from "../src/practice.ts";
import { KnowledgeStore } from "../src/knowledge.ts";
import type { Attempt, Challenge, SkillPlan, Subskill } from "../src/types.ts";

const at = "2026-01-01T00:00:00.000Z";
const sub = (id: string, prerequisites: string[] = []): Subskill => ({
	id, title: id, prerequisites, status: "locked", why: "", priority: 1, selfCorrection: "", drills: [],
});
const plan = (): SkillPlan => ({
	skill: "demo", title: "Demo", targetPerformance: "", whyItMatters: "", resources: [], barriers: [],
	hoursGoal: 20, createdAt: at, updatedAt: at,
	subskills: [sub("c", ["b"]), sub("b", ["a"]), sub("a")],
});
const challenges: Challenge[] = [1, 2, 3].map((n) => ({
	id: String(n), skill: "demo", subskillId: "a", kind: "apply", level: 1, prompt: "Try", hints: [], createdAt: at,
}));
function attempt(id: string, outcome: Attempt["outcome"] = "success", n = 0): Attempt {
	return { id: id + outcome + n, challengeId: id, skill: "demo", subskillId: "a",
		at: new Date(Date.parse(at) + n * 1000).toISOString(), answer: "", outcome, hintsUsed: 0, xp: 1 };
}
const statuses = (p: SkillPlan) => Object.fromEntries(p.subskills.map((s) => [s.id, s.status]));

test("first attempt practices without mutating inputs", () => {
	const p = plan();
	const before = structuredClone(p);
	const result = advanceAfterAttempt(p, challenges, [], attempt("1", "fail"));
	assert.equal(statuses(result.plan).a, "practicing");
	assert.deepEqual(p, before);
});

test("distinct solutions and recent success rate gate solidity", () => {
	const p = plan();
	const successes = challenges.map((c) => attempt(c.id));
	assert.equal(statuses(reconcileStatuses(p, challenges, successes.slice(0, 2))).a, "practicing");
	assert.equal(statuses(reconcileStatuses(p, challenges, [attempt("1"), attempt("1"), attempt("1")])).a,
		"practicing");
	const boundary = [...successes, attempt("1", "fail", 1), attempt("2", "fail", 2)];
	assert.equal(statuses(reconcileStatuses(p, challenges, boundary)).a, "solid");
	assert.equal(statuses(reconcileStatuses(p, challenges, [...boundary, attempt("3", "partial", 3)])).a,
		"practicing");
	assert.equal(statuses(reconcileStatuses(p, challenges.slice(0, 2), successes.slice(0, 2))).a, "solid");
	assert.equal(statuses(reconcileStatuses(p, [], [])).a, "active");
});

test("every boss and high-level challenge must be solved when present", () => {
	const gates: Challenge[] = [
		{ ...challenges[0], id: "boss", kind: "boss" },
		{ ...challenges[0], id: "hard", level: 4 },
	];
	const all = [...challenges, ...gates];
	const history = challenges.map((c) => attempt(c.id));
	assert.equal(statuses(reconcileStatuses(plan(), all, history)).a, "practicing");
	history.push(attempt("boss"));
	assert.equal(statuses(reconcileStatuses(plan(), all, history)).a, "practicing");
	history.push(attempt("hard"));
	assert.equal(statuses(reconcileStatuses(plan(), all, history)).a, "solid");
});

test("incremental mastery unlocks eligible dependents without auto-mastering or downgrading", () => {
	const history = challenges.map((c) => attempt(c.id));
	const result = advanceAfterAttempt(plan(), challenges, history, history[2]);
	assert.deepEqual(result.mastered, ["a"]);
	assert.deepEqual(result.unlocked, ["b"]);
	assert.deepEqual(statuses(result.plan), { a: "solid", b: "active", c: "locked" });
	const fail = attempt("1", "fail", 10);
	assert.equal(statuses(advanceAfterAttempt(result.plan, challenges, [fail], fail).plan).a, "solid");
	assert.deepEqual(skillCompletion(result.plan), { solid: 1, total: 3, percent: 33 });
	assert.deepEqual(skillCompletion({ ...plan(), subskills: [] }), { solid: 0, total: 0, percent: 0 });
});

test("reconciliation rebuilds reverse-ordered chains and ignores unsupported saved mastery", () => {
	const p = plan();
	p.subskills[0].status = "solid";
	const b: Challenge = { ...challenges[0], id: "b1", subskillId: "b" };
	const bAttempt = { ...attempt("b1"), subskillId: "b" };
	assert.deepEqual(statuses(reconcileStatuses(p, [...challenges, b],
		[...challenges.map((c) => attempt(c.id)), bAttempt])), { a: "solid", b: "solid", c: "active" });
	assert.deepEqual(statuses(reconcileStatuses(p, challenges, [bAttempt])),
		{ a: "active", b: "locked", c: "locked" });
});

test("store persists progression, one-off migration, reconciliation and knowledge statuses", (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-progression-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const store = new PracticeStore(home);
	store.writePlan(plan());
	const own = challenges.map(({ id, createdAt, ...draft }) => store.addChallenge(draft));
	assert.equal(statuses(store.readPlan("demo")!).a, "locked"); // Reads do not migrate.
	const record = (id: string, outcome: Attempt["outcome"] = "success") =>
		store.recordAttempt({ challengeId: id, answer: "", outcome, hintsUsed: 0 });
	record(own[0].id);
	const marked = store.readPlan("demo") as SkillPlan & { reconciledAt?: string };
	assert.ok(marked.reconciledAt && Number.isFinite(Date.parse(marked.reconciledAt)));
	assert.equal(statuses(marked).a, "practicing");
	// A sentinel proves later attempts do not rewrite the migration marker.
	marked.reconciledAt = at;
	store.writePlan(marked);
	record(own[1].id);
	const result = record(own[2].id);
	assert.deepEqual(result.mastered, ["a"]);
	assert.deepEqual(result.unlocked, ["b"]);
	assert.equal((store.readPlan("demo") as typeof marked).reconciledAt, at);
	const graph = new KnowledgeStore(home).build();
	assert.equal(graph.nodes.find((n) => n.id === "subskill:demo/a")?.status, "solid");
	assert.equal(graph.nodes.find((n) => n.id === "subskill:demo/b")?.status, "next");
	store.setSubskillStatus("demo", "a", "locked");
	assert.equal(statuses(store.reconcile("demo")!).a, "solid");
	assert.equal(statuses(new PracticeStore(home).readPlan("demo")!).a, "solid");
	assert.deepEqual(fs.readdirSync(path.join(home, "skills", "demo")).filter((f) => f.endsWith(".tmp")), []);
});

test("migration restores existing history before recording the next attempt", (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-migration-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const store = new PracticeStore(home);
	store.writePlan(plan());
	const { id, createdAt, ...draft } = challenges[0];
	const c = store.addChallenge(draft);
	fs.writeFileSync(path.join(home, "skills", "demo", "attempts.jsonl"),
		JSON.stringify(attempt(c.id)) + "\n");
	const result = store.recordAttempt({ challengeId: c.id, answer: "", outcome: "fail", hintsUsed: 0 });
	assert.equal(statuses(store.readPlan("demo")!).a, "solid");
	assert.deepEqual(result.mastered, []);
});

test("solving a variant of a failed boss satisfies its gate; variants count as one item", () => {
	const boss: Challenge = { ...challenges[0]!, id: "boss", kind: "boss", level: 5 };
	const variant: Challenge = { ...challenges[0]!, id: "boss-v", kind: "boss", level: 5, variantOf: "boss" };
	const all = [...challenges, boss, variant];
	const history = [attempt("boss", "fail", 1), attempt("1", "success", 2), attempt("2", "success", 3),
		attempt("boss-v", "success", 4), attempt("3", "success", 5)];
	assert.equal(reconcileStatuses(plan(), all, history).subskills.find((s) => s.id === "a")?.status, "solid");
	// Without the variant's success the failed boss still gates mastery.
	assert.equal(reconcileStatuses(plan(), all, history.filter((a) => a.challengeId !== "boss-v"))
		.subskills.find((s) => s.id === "a")?.status, "practicing");
	// An original and its variant are one item: two solved versions of one question are not two distinct solutions.
	const pair = [challenges[0]!, { ...challenges[0]!, id: "1-v", variantOf: "1" }, challenges[1]!, challenges[2]!];
	assert.equal(reconcileStatuses(plan(), pair, [attempt("1", "success", 1), attempt("1-v", "success", 2),
		attempt("2", "success", 3)]).subskills.find((s) => s.id === "a")?.status, "practicing");
});
