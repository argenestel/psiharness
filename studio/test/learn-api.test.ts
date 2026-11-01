import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleLearnRoute } from "../src/learn-api.ts";
import { PracticeApi } from "../src/practice-api.ts";
import { PracticeStore } from "../../core/src/practice.ts";
import { SourceStore } from "../../core/src/sources.ts";
import { LessonStore } from "../../core/src/lessons.ts";

function fixture(t: TestContext) {
	const home = mkdtempSync(join(tmpdir(), "psi-learn-api-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const request = async (url: string, method = "GET", body?: unknown, auth = true, raw?: string) => {
		const req = Readable.from([raw ?? JSON.stringify(body ?? {})]) as IncomingMessage;
		req.url = url; req.method = method; req.headers = auth ? { "x-psi": "1" } : {};
		let status = 0, data = "";
		const res = { writeHead(code: number) { status = code; }, end(value: string) { data = value; } };
		assert.equal(await handleLearnRoute(req, res as ServerResponse, home), true);
		return { status, body: JSON.parse(data) };
	};
	return { home, request };
}

function seed(home: string) {
	const plan = JSON.parse(readFileSync(new URL("../../examples/skills/python-foundations/plan.json", import.meta.url), "utf8"));
	new PracticeStore(home).writePlan(plan);
	const sources = new SourceStore(home);
	const low = sources.add(plan.skill, { url: "http://example.com/blog", title: "Blog", kind: "forum" });
	const high = sources.add(plan.skill, { url: "https://docs.python.org/3/tutorial/", title: "Tutorial" });
	const id = plan.subskills[0].id;
	const lesson = new LessonStore(home).write(plan.skill, id, { title: "Introduction", explanation: "Learn values.",
		keyIdeas: ["Values have types", "Names refer to values"],
		citations: [{ sourceId: high.id, quote: "Values", locator: "section 1" }] });
	return { skill: plan.skill, id, high, low, lesson, sources };
}

test("fresh summary and validated profile updates", async (t) => {
	const { request } = fixture(t);
	const fresh = await request("/api/me");
	assert.equal(fresh.status, 200);
	assert.deepEqual(fresh.body.dailyGoal, { kind: "challenges", target: 5 });
	const defaults = await request("/api/me/profile", "PUT", {});
	assert.equal(defaults.body.profile.tutorMode, "practice");
	assert.equal((await request("/api/me/profile", "PUT", {}, false)).status, 403);
	const updated = await request("/api/me/profile", "PUT", {
		dailyGoal: { kind: "minutes", target: 20 }, tutorMode: "teach",
	});
	assert.equal(updated.status, 200);
	assert.equal(updated.body.profile.tutorMode, "teach");
	assert.deepEqual(updated.body.summary.dailyGoal, { kind: "minutes", target: 20 });
	for (const target of [0, 101, 1.5, "x"]) {
		assert.equal((await request("/api/me/profile", "PUT", { dailyGoal: { kind: "minutes", target } })).status, 400);
	}
	for (const body of [{ tutorMode: "unknown" }, { dailyGoal: { kind: "xp", target: 5 } }, null, []]) {
		assert.equal((await request("/api/me/profile", "PUT", body, true, JSON.stringify(body))).status, 400);
	}
	assert.equal((await request("/api/me/profile", "PUT", {}, true, "{")).status, 400);
});

test("ranked sources, lesson summaries, resolved and missing citations", async (t) => {
	const { home, request } = fixture(t);
	const { skill, id, high, low, sources } = seed(home);
	const ranked = await request(`/api/skills/${skill}/sources`);
	assert.equal(ranked.status, 200);
	assert.deepEqual(ranked.body.map((source: { id: string }) => source.id), [high.id, low.id]);
	assert.deepEqual((await request(`/api/skills/${skill}/lessons`)).body, [{ id, title: "Introduction" }]);
	const resolved = (await request(`/api/skills/${skill}/lessons/${id}`)).body.citations[0];
	assert.deepEqual(resolved, { n: 1, sourceId: high.id, quote: "Values", locator: "section 1",
		title: high.title, url: high.url, kind: high.kind, rank: high.rank, rankReasons: high.rankReasons });
	sources.remove(skill, high.id);
	assert.deepEqual((await request(`/api/skills/${skill}/lessons/${id}`)).body.citations[0], {
		n: 1, sourceId: high.id, quote: "Values", locator: "section 1", sourceMissing: true,
	});
	const missing = await request(`/api/skills/${skill}/lessons/missing`);
	assert.equal(missing.status, 404);
	assert.match(missing.body.error, /no lesson for subskill missing in skill/);
	assert.equal((await request("/api/skills/unknown/sources")).status, 404);
	for (const skillPath of ["..", "%2e%2e", "python%2ffoundations"]) {
		assert.equal((await request(`/api/skills/${skillPath}/sources`)).status, 400);
	}
	const payload = await new PracticeApi(home).handle("GET", ["api", "skills", skill],
		new URL(`http://localhost/api/skills/${skill}`), {}) as { plan: { subskills: { id: string; lessonAvailable: boolean }[] } };
	assert.ok(payload.plan.subskills.every((s) => s.lessonAvailable === (s.id === id)));
});

test("web pack import includes sources and lessons and remains a no-op on repeat", async (t) => {
	const { home } = fixture(t);
	const api = new PracticeApi(home);
	const parts = ["api", "packs", "python-foundations", "import"];
	const url = new URL("http://localhost/api/packs/python-foundations/import");
	assert.deepEqual(await api.handle("POST", parts, url, {}), { skill: "python-foundations" });
	assert.ok(new SourceStore(home).list("python-foundations").length > 0);
	assert.ok(new LessonStore(home).list("python-foundations").length > 0);
	assert.deepEqual(await api.handle("POST", parts, url, {}), { skill: "python-foundations", alreadyImported: true });
});


test("profile gameLayer validation accepts presentation modes and rejects other values", async (t) => {
	const { request } = fixture(t);
	assert.equal((await request("/api/me")).body.gameLayer, "on");
	for (const gameLayer of ["on", "quiet", "off"]) {
		const response = await request("/api/me/profile", "PUT", { gameLayer });
		assert.equal(response.status, 200);
		assert.equal(response.body.profile.gameLayer, gameLayer);
		assert.equal(response.body.summary.gameLayer, gameLayer);
	}
	for (const gameLayer of ["unknown", "", 1, null, {}, []]) {
		const response = await request("/api/me/profile", "PUT", { gameLayer });
		assert.equal(response.status, 400);
		assert.equal(response.body.error, "Invalid gameLayer");
	}
	assert.equal((await request("/api/me")).body.gameLayer, "off");
});
