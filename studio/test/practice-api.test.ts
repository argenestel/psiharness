import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PracticeApi, publicChallenge } from "../src/practice-api.ts";
import { PracticeStore } from "../../core/src/practice.ts";
import { StateStore } from "../../core/src/state.ts";
import type { Challenge } from "../../core/src/types.ts";

const packsDir = fileURLToPath(new URL("../../examples/skills/", import.meta.url));
const packChallenges = (slug: string): Challenge[] =>
	JSON.parse(readFileSync(join(packsDir, slug, "challenges.json"), "utf8"));

function fixture(t: { after(fn: () => void): void }) {
	const home = mkdtempSync(join(tmpdir(), "psi-practice-api-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const api = new PracticeApi(home);
	return { home, api, call: (method: string, path: string, body: Record<string, unknown> = {}) =>
		api.handle(method, new URL(path, "http://localhost").pathname.split("/").filter(Boolean),
			new URL(path, "http://localhost"), body) as Promise<any> };
}

test("Practice API imports packs, grades deterministic answers and requires code outcomes", async (t) => {
	const { home, call } = fixture(t);
	const packs = await call("GET", "/api/packs");
	const mental = packs.find((p: { slug: string }) => p.slug === "mental-math");
	assert.equal(mental.imported, false);
	assert.ok(mental.challenges > 0 && mental.title);
	assert.deepEqual(await call("POST", "/api/packs/mental-math/import"), { skill: "mental-math" });
	assert.deepEqual(await call("POST", "/api/packs/mental-math/import"), { skill: "mental-math", alreadyImported: true });
	await assert.rejects(call("POST", "/api/packs/missing/import"), { status: 404 });
	assert.equal((await call("GET", "/api/packs")).find((p: { slug: string }) => p.slug === "mental-math").imported, true);
	assert.ok((await call("GET", "/api/skills")).includes("mental-math"));
	const detail = await call("GET", "/api/skills/mental-math");
	assert.equal(detail.plan.skill, "mental-math");
	const source = packChallenges("mental-math").find((c) => c.expected && c.hints.length)!;
	const challenge: Record<string, any> = detail.challenges.find((c: { id: string }) => c.id === source.id);
	assert.deepEqual({ ...challenge }, { ...Object.fromEntries(Object.entries(source)
		.filter(([key]) => !["expected", "acceptable", "rubric", "hints"].includes(key))),
		hintsCount: source.hints.length, attempts: 0, attempted: false, lastOutcome: null });
	const path = `/api/skills/mental-math/challenges/${challenge.id}`;
	assert.deepEqual(await call("GET", path), challenge);
	// Zero-based, as the challenge widget requests hints.
	assert.deepEqual(await call("GET", path + "/hint?n=0"), { hint: source.hints[0], n: 0, total: source.hints.length });
	assert.equal((await call("GET", path + `/hint?n=${source.hints.length}`)).hint, null);
	await assert.rejects(call("GET", path + "/hint?n=-1"), { status: 400 });
	await assert.rejects(call("GET", path + "/hint?n=x"), { status: 400 });
	new StateStore(home).update({ activeSkill: "mental-math", openChallenge: { skill: "mental-math", id: challenge.id } });
	const correct = await call("POST", path + "/attempt", { answer: source.expected, outcome: "fail" });
	assert.equal(correct.attempt.outcome, "success");
	assert.ok(correct.attempt.xp > 0);
	assert.equal((await call("GET", "/api/state")).openChallenge, undefined);
	const incorrect = await call("POST", path + "/attempt", { answer: "wrong", outcome: "success", lesson: "Try again" });
	assert.equal(incorrect.attempt.outcome, "fail");
	assert.ok(incorrect.attempt.xp > 0);
	assert.equal(incorrect.progress.attempts, 2);
	await assert.rejects(call("POST", path + "/attempt", { answer: "wrong", hintsUsed: -1 }), { status: 400 });
	await assert.rejects(call("POST", path + "/attempt", { answer: "wrong", outcome: "invented" }), { status: 400 });
	// Per-challenge attempt stats and the unattempted filter used by the practice dashboard.
	const after = await call("GET", "/api/skills/mental-math");
	const stats = after.challenges.find((c: { id: string }) => c.id === challenge.id);
	assert.deepEqual([stats.attempts, stats.attempted, stats.lastOutcome], [2, true, "fail"]);
	const open = await call("GET", "/api/skills/mental-math?unattempted=1");
	assert.equal(open.challenges.length, after.challenges.length - 1);
	assert.ok(open.challenges.every((c: { attempted: boolean }) => !c.attempted));
	const store = new PracticeStore(home);
	const code = store.addChallenge({ skill: "mental-math", kind: "apply", level: 1,
		prompt: "Return one", format: "code", language: "javascript", tests: "if (result !== 1) throw Error();", expected: "1" });
	const codePath = `/api/skills/mental-math/challenges/${code.id}/attempt`;
	await assert.rejects(call("POST", codePath, { answer: "1" }), { status: 400 });
	await assert.rejects(call("POST", codePath, { answer: "1", outcome: "invented" }), { status: 400 });
	assert.equal((await call("POST", codePath, { answer: "return 1", outcome: "success" })).attempt.outcome, "success");
	assert.equal((await call("POST", codePath, { answer: "return 0", outcome: "fail" })).attempt.outcome, "fail");
	const codeDetail = await call("GET", `/api/skills/mental-math/challenges/${code.id}`);
	assert.equal(codeDetail.tests, code.tests);
	assert.equal(codeDetail.expected, undefined);
	// An open answer the server cannot grade is returned for tutor grading and not recorded.
	const open2 = store.addChallenge({ skill: "mental-math", kind: "explain", level: 1, prompt: "Why?", rubric: ["because"] });
	const before = store.progress("mental-math").attempts;
	const pending = await call("POST", `/api/skills/mental-math/challenges/${open2.id}/attempt`, { answer: "Because" });
	assert.equal(pending.needsGrading, true);
	assert.equal(pending.attempt.outcome, "pending");
	assert.equal(store.progress("mental-math").attempts, before);
	assert.equal(JSON.parse(readFileSync(join(home, "skills/mental-math/plan.json"), "utf8")).skill, "mental-math");
});

test("every bundled pack imports and its challenges never expose answer keys", async (t) => {
	const { call } = fixture(t);
	const slugs = readdirSync(packsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	const packs = await call("GET", "/api/packs");
	assert.deepEqual(packs.map((p: { slug: string }) => p.slug).sort(), slugs.sort());
	for (const slug of slugs) {
		assert.deepEqual(await call("POST", `/api/packs/${slug}/import`), { skill: slug });
		const detail = await call("GET", `/api/skills/${slug}`);
		assert.equal(detail.challenges.length, packChallenges(slug).length);
		const text = JSON.stringify(detail);
		for (const key of ['"expected"', '"acceptable"', '"rubric"', '"hints"']) assert.ok(!text.includes(key), `${slug} ${key}`);
		for (const c of detail.challenges) {
			const one = JSON.stringify(await call("GET", `/api/skills/${slug}/challenges/${c.id}`));
			assert.ok(!one.includes('"expected"') && !one.includes('"acceptable"'));
			if (c.format === "code") assert.ok(c.tests && c.language, `${slug}/${c.id} keeps tests`);
		}
		const source = packChallenges(slug).find((c) => c.format === "code" && c.setup);
		if (source) {
			const served = detail.challenges.find((c: { id: string }) => c.id === source.id);
			assert.equal(served.setup, source.setup);
			assert.equal(served.starterCode, source.starterCode);
		}
	}
});

test("Memory API persists, summarizes and deletes observations with validation", async (t) => {
	const { call } = fixture(t);
	assert.deepEqual((await call("GET", "/api/memory")).items, []);
	for (const body of [{ kind: "bad", text: "a fact" }, { kind: "goal", text: "" }, { kind: "goal", text: 7 },
		{ kind: "goal", text: "x".repeat(2001) }]) {
		await assert.rejects(call("POST", "/api/memory", body), { status: 400 });
	}
	const memory = await call("POST", "/api/memory", { kind: "preference", text: "I learn with small exercises" });
	assert.equal(memory.source, "learner");
	const saved = await call("GET", "/api/memory");
	assert.equal(saved.items[0].id, memory.id);
	assert.match(saved.summary, /small exercises/);
	assert.ok(Array.isArray(saved.recaps));
	assert.deepEqual(await call("DELETE", `/api/memory/${memory.id}`), { ok: true });
	assert.deepEqual((await call("GET", "/api/memory")).items, []);
	await assert.rejects(call("DELETE", `/api/memory/${memory.id}`), { status: 404 });
});

test("publicChallenge keeps expected rows only for code challenges graded in the browser", () => {
	const base = { id: "c", skill: "s", kind: "apply", level: 1, prompt: "p", hints: ["h"], createdAt: "2026-01-01" } as const;
	const sql = publicChallenge({ ...base, format: "code", language: "sql", tests: "-- t", expected: "[[1]]" });
	assert.equal((sql as { expected?: string }).expected, "[[1]]");
	const text = publicChallenge({ ...base, format: "text", expected: "secret", acceptable: ["s2"] });
	assert.equal("expected" in text, false);
	assert.equal("acceptable" in text, false);
});
