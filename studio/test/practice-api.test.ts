import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PracticeApi, publicChallenge } from "../src/practice-api.ts";
import { PracticeStore } from "../../core/src/practice.ts";
import { StateStore } from "../../core/src/state.ts";
import { PsiStore } from "../../core/src/store.ts";
import { startStudio } from "../src/server.ts";
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
	assert.deepEqual([correct.source, correct.verified, correct.attempt.source, correct.attempt.verified],
		["checked", true, "checked", true]);
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
	const codeSuccess = await call("POST", codePath, { answer: "return 1", outcome: "success" });
	assert.equal(codeSuccess.attempt.outcome, "success");
	assert.deepEqual([codeSuccess.source, codeSuccess.verified, codeSuccess.attempt.source, codeSuccess.attempt.verified],
		["self-reported", false, "self-reported", false]);
	assert.equal(codeSuccess.attempt.xp, 10);
	const codeFailure = await call("POST", codePath, { answer: "return 0", outcome: "fail" });
	assert.equal(codeFailure.attempt.outcome, "fail");
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
		for (const key of ['"acceptable"', '"rubric"', '"hints"']) assert.ok(!text.includes(key), `${slug} ${key}`);
		for (const c of detail.challenges) {
			const one = JSON.stringify(await call("GET", `/api/skills/${slug}/challenges/${c.id}`));
			// Only SQL code challenges carry expected result rows, which the browser sandbox compares against.
			const sqlCode = c.format === "code" && c.language === "sql";
			assert.equal("expected" in c, sqlCode, `${slug}/${c.id} expected exposure`);
			assert.ok(sqlCode || !one.includes('"expected"'));
			assert.ok(!one.includes('"acceptable"'));
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

test("attempt routes scope duplicate challenge ids to their URL skill", async (t) => {
	const { home, call } = fixture(t);
	const challengeId = "duplicate-challenge";
	for (const skill of ["python-foundations", "javascript-essentials"]) {
		const directory = join(home, "skills", skill);
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "challenges.json"), JSON.stringify([{
			id: challengeId, skill, kind: "quickfire", level: 1, prompt: "Pass?", expected: "yes", hints: [],
			createdAt: "2026-01-01",
		}]));
	}
	for (const skill of ["python-foundations", "javascript-essentials"]) {
		const result = await call("POST", `/api/skills/${skill}/challenges/${challengeId}/attempt`, { answer: "yes" });
		assert.deepEqual([result.attempt.skill, result.source, result.verified], [skill, "checked", true]);
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
	const base = { id: "c", skill: "s", kind: "apply" as const, level: 1 as const, prompt: "p", hints: ["h"],
		createdAt: "2026-01-01" };
	const sql = publicChallenge({ ...base, format: "code", language: "sql", tests: "-- t", expected: "[[1]]" });
	assert.equal((sql as { expected?: string }).expected, "[[1]]");
	const text = publicChallenge({ ...base, format: "text", expected: "secret", acceptable: ["s2"] });
	assert.equal("expected" in text, false);
	assert.equal("acceptable" in text, false);
});

test("attempts route returns newest-first summaries with truncated answers and a bounded limit", async (t) => {
	const { call } = fixture(t);
	await call("POST", "/api/packs/mental-math/import");
	const source = packChallenges("mental-math").find((c) => c.expected)!;
	const path = `/api/skills/mental-math/challenges/${source.id}/attempt`;
	assert.deepEqual(await call("GET", "/api/skills/mental-math/attempts"), []);
	await call("POST", path, { answer: source.expected });
	await call("POST", path, { answer: "x".repeat(500), lesson: "Check the tens first", hintsUsed: 1 });
	const list = await call("GET", "/api/skills/mental-math/attempts");
	assert.equal(list.length, 2);
	assert.deepEqual(list.map((a: { outcome: string }) => a.outcome), ["fail", "success"]);
	const [miss, hit] = list;
	assert.deepEqual(Object.keys(miss).sort(),
		["answer", "at", "challengeId", "hintsUsed", "id", "lesson", "outcome", "xp"]);
	assert.equal(miss.lesson, "Check the tens first");
	assert.equal(miss.hintsUsed, 1);
	assert.ok(miss.answer.length <= 200 && miss.answer.endsWith("…"));
	assert.equal("lesson" in hit, false);
	assert.equal(hit.challengeId, source.id);
	assert.ok(hit.xp > 0 && Date.parse(hit.at) <= Date.parse(miss.at));
	assert.equal((await call("GET", "/api/skills/mental-math/attempts?limit=1"))[0].id, miss.id);
	assert.equal((await call("GET", "/api/skills/mental-math/attempts?limit=999")).length, 2);
	for (const bad of ["0", "-3", "x", "1.5"]) {
		await assert.rejects(call("GET", `/api/skills/mental-math/attempts?limit=${bad}`), { status: 400 });
	}
	await assert.rejects(call("GET", "/api/skills/missing/attempts"), { status: 404 });
});

test("lesson route stores a lesson after a miss, shows it on the trail and pays the bonus once", async (t) => {
	const { call } = fixture(t);
	await call("POST", "/api/packs/mental-math/import");
	const source = packChallenges("mental-math").find((c) => c.expected)!;
	const miss = await call("POST", `/api/skills/mental-math/challenges/${source.id}/attempt`, { answer: "nope" });
	assert.equal(miss.attempt.outcome, "fail");
	const path = `/api/skills/mental-math/attempts/${miss.attempt.id}/lesson`;
	const saved = await call("POST", path, { lesson: "Split into tens and ones" });
	assert.equal(saved.bonus, 5);
	assert.equal(saved.progress.xp, miss.progress.xp + 5);
	const [trail] = await call("GET", "/api/skills/mental-math/attempts");
	assert.deepEqual([trail.lesson, trail.xp], ["Split into tens and ones", miss.attempt.xp + 5]);
	assert.equal((await call("POST", path, { lesson: "Tens first" })).bonus, 0);
	for (const body of [{}, { lesson: "" }, { lesson: 3 }, { lesson: "x".repeat(2001) }]) {
		await assert.rejects(call("POST", path, body), { status: 400 });
	}
	await assert.rejects(call("POST", "/api/skills/mental-math/attempts/missing/lesson", { lesson: "x" }), { status: 404 });
	await assert.rejects(call("POST", `/api/skills/missing/attempts/${miss.attempt.id}/lesson`, { lesson: "x" }),
		{ status: 404 });
});

test("Memory API edits an item's text and kind in place with validation", async (t) => {
	const { call } = fixture(t);
	const item = await call("POST", "/api/memory", { kind: "preference", text: "Short sessions work for me" });
	const edited = await call("PATCH", `/api/memory/${item.id}`, { text: "  Twenty-minute sessions work best  " });
	assert.equal(edited.id, item.id);
	assert.equal(edited.text, "Twenty-minute sessions work best");
	assert.equal(edited.kind, "preference");
	assert.equal((await call("PATCH", `/api/memory/${item.id}`, { kind: "constraint" })).kind, "constraint");
	const saved = (await call("GET", "/api/memory")).items;
	assert.deepEqual([saved.length, saved[0].text, saved[0].kind], [1, "Twenty-minute sessions work best", "constraint"]);
	for (const body of [{}, { text: "" }, { text: 3 }, { kind: "bad" }, { text: "x".repeat(2001) }]) {
		await assert.rejects(call("PATCH", `/api/memory/${item.id}`, body), { status: 400 });
	}
	await assert.rejects(call("PATCH", "/api/memory/mem-missing", { text: "hi" }), { status: 404 });
});

// The real request listener, without opening a socket (as in request-handler.test.ts).
test("server wires PATCH /api/memory/:id behind X-Psi and the attempts route", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-practice-http-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	let native!: Server;
	t.mock.method(Server.prototype, "listen", function (this: Server, ...args: unknown[]) {
		native = this; (args.at(-1) as () => void)(); return this;
	});
	t.mock.method(Server.prototype, "address", () => ({ port: 4173, address: "127.0.0.1", family: "IPv4" }));
	t.mock.method(Server.prototype, "close", function (this: Server, callback: () => void) { callback(); return this; });
	const studio = await startStudio({ port: 0, store: new PsiStore(home), agentBin: join(home, "missing") });
	t.after(() => studio.close());
	const call = async (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
		const req = Readable.from([Buffer.from(body === undefined ? "" : JSON.stringify(body))]) as unknown as IncomingMessage;
		req.url = path; req.method = method;
		req.headers = { host: "localhost", "content-type": "application/json", ...headers };
		let output = "", status = 200, finish!: () => void;
		const done = new Promise<void>((resolve) => { finish = resolve; });
		const res = Object.assign(new EventEmitter(), { headersSent: false, setHeader() {},
			writeHead(code: number) { status = code; this.headersSent = true; },
			end(data = "") { output += data; finish(); } });
		native.emit("request", req, res as unknown as ServerResponse);
		await done;
		return { status, body: output ? JSON.parse(output) : undefined };
	};
	const psi = { "x-psi": "1" };
	const item = (await call("/api/memory", "POST", { kind: "goal", text: "Learn mental math" }, psi)).body;
	assert.equal((await call(`/api/memory/${item.id}`, "PATCH", { text: "Learn SQL" })).status, 403);
	const edited = await call(`/api/memory/${item.id}`, "PATCH", { text: "Learn SQL joins" }, psi);
	assert.deepEqual([edited.status, edited.body.text], [200, "Learn SQL joins"]);
	assert.equal((await call("/api/skills", "PATCH", {}, psi)).status, 405);
	assert.equal((await call("/api/packs/mental-math/import", "POST", {}, psi)).status, 200);
	const attempts = await call("/api/skills/mental-math/attempts?limit=5");
	assert.deepEqual([attempts.status, attempts.body], [200, []]);
	const source = packChallenges("mental-math").find((c) => c.expected)!;
	const miss = (await call(`/api/skills/mental-math/challenges/${source.id}/attempt`, "POST", { answer: "nope" }, psi)).body;
	const lessonPath = `/api/skills/mental-math/attempts/${miss.attempt.id}/lesson`;
	assert.equal((await call(lessonPath, "POST", { lesson: "Round first" })).status, 403);
	const saved = await call(lessonPath, "POST", { lesson: "Round first" }, psi);
	assert.deepEqual([saved.status, saved.body.bonus, saved.body.attempt.lesson], [200, 5, "Round first"]);
});
