import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../src/server.ts";
import type { ConceptGraph } from "../../core/src/types.ts";

const coreModule = "../../core/src/index.ts";

test("Studio serves learning data, reviews, artifacts and live changes", { timeout: 20000 }, async (t) => {
	let core;
	try { core = await import(coreModule); }
	catch (error) {
		if (["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes((error as NodeJS.ErrnoException).code ?? "")) {
			t.skip("Core store is not available/importable yet"); return;
		}
		throw error;
	}
	if (typeof core.PsiStore !== "function") { t.skip("Core does not export PsiStore yet"); return; }
	const home = await mkdtemp(join(tmpdir(), "psi-studio-test-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const store = new core.PsiStore(home);
	const date = new Date().toISOString();
	const graph: ConceptGraph = {
		topic: "t", title: "Tiny universe", bigIdea: "See connections", createdAt: date, updatedAt: date,
		concepts: [
			{ id: "seed", title: "Seed", summary: "Start here", prerequisites: [], difficulty: 1 },
			{ id: "bloom", title: "Bloom", summary: "Build on seeds", prerequisites: ["seed"], difficulty: 2 },
		],
	};
	store.writeGraph("t", graph);
	store.writePlan("t", { topic: "t", goal: "Grow intuition", learnerLevel: "curious", createdAt: date,
		updatedAt: date, lessons: [{ conceptId: "seed", objective: "See a seed", beats: [{ kind: "hook", text: "Imagine!" }],
			visuals: [], checks: [], status: "planned" }] });
	const [card] = store.addCards("t", [{ conceptId: "seed", kind: "mcq", prompt: "What comes first?",
		answer: "A seed", choices: ["A seed", "A flower"] }]);
	store.writeArtifact("t", "seed.html", "<!doctype html><h1>Seed</h1>");
	store.writeArtifact("t", "clip.mp4", Buffer.from("0123456789"));
	store.writeArtifact("t", "seed.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
	const studio = await startStudio({ store, port: 0, host: "127.0.0.1" });
	t.after(() => studio.close());
	const get = (path: string, init?: RequestInit) => fetch(studio.url + path, init);

	await t.test("topics include accurate counts", async () => {
		const response = await get("/api/topics");
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), [{ topic: "t", title: "Tiny universe", bigIdea: "See connections",
			concepts: 2, mastered: 0, due: 1, artifacts: 3 }]);
	});
	await t.test("detail includes graph, plan, learner and frontier", async () => {
		const detail = await (await get("/api/topics/t")).json();
		assert.deepEqual(detail.graph, graph);
		assert.equal(detail.plan.lessons[0].conceptId, "seed");
		assert.equal(detail.learner, null);
		assert.deepEqual(detail.frontier.map((c: { id: string }) => c.id), ["seed"]);
		assert.equal((await get("/api/topics/missing")).status, 404);
	});
	await t.test("due cards expose MCQ choices", async () => {
		const cards = await (await get("/api/topics/t/cards/due")).json();
		assert.equal(cards[0].id, card.id);
		assert.deepEqual(cards[0].choices, ["A seed", "A flower"]);
		assert.deepEqual(await (await get("/api/topics/t/reviews")).json(), []);
	});
	await t.test("review validates input before persisting", async () => {
		for (const rating of [0, 5, "3", null]) {
			const response = await get(`/api/topics/t/cards/${card.id}/review`, {
				method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }),
			});
			assert.equal(response.status, 400);
		}
		assert.equal((await get(`/api/topics/t/cards/${card.id}/review`, {
			method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
		})).status, 400);
		assert.equal((await get(`/api/topics/t/cards/${card.id}/review`, {
			method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.example" },
			body: '{"rating":3}',
		})).status, 403);
		assert.equal((await get("/api/topics/t/cards/absent/review", {
			method: "POST", headers: { "Content-Type": "application/json" }, body: '{"rating":3}',
		})).status, 404);
		assert.equal(store.readCards("t")[0].fsrs.reps, 0);
	});
	await t.test("review changes FSRS, mastery and history", async () => {
		const response = await get(`/api/topics/t/cards/${card.id}/review`, {
			method: "POST", headers: { "Content-Type": "application/json" }, body: '{"rating":3}',
		});
		assert.equal(response.status, 200);
		const updated = await response.json();
		assert.equal(updated.fsrs.reps, 1);
		assert.notEqual(updated.fsrs.due, card.fsrs.due);
		assert.equal(store.readCards("t")[0].fsrs.reps, 1);
		assert.equal(store.readLearner("t").mastery.seed.attempts, 1);
		const reviews = await (await get("/api/topics/t/reviews")).json();
		assert.equal(reviews.length, 1);
		assert.equal(reviews[0].rating, 3);
		assert.equal(reviews[0].cardId, card.id);
		assert.equal((await (await get("/api/topics/t/cards/due")).json()).length, 0);
	});
	await t.test("artifact listing includes media URLs and MIME types", async () => {
		const artifacts = await (await get("/api/topics/t/artifacts")).json();
		assert.equal(artifacts.length, 3);
		assert.equal(artifacts.find((a: { name: string }) => a.name === "clip.mp4").type, "video/mp4");
		const response = await get("/artifacts/t/seed.html");
		assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
		assert.match(response.headers.get("content-security-policy") ?? "", /sandbox allow-scripts/);
		assert.match(response.headers.get("content-security-policy") ?? "", /'unsafe-eval'/);
		assert.match(await response.text(), /<h1>Seed<\/h1>/);
		assert.equal((await get("/artifacts/t/seed.svg")).headers.get("content-type"), "image/svg+xml");
	});
	await t.test("video range serving supports bounded, suffix and open-ended requests", async () => {
		for (const [range, body, contentRange] of [
			["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=-3", "789", "bytes 7-9/10"],
			["bytes=8-", "89", "bytes 8-9/10"], ["bytes=0-999", "0123456789", "bytes 0-9/10"],
		]) {
			const response = await get("/artifacts/t/clip.mp4", { headers: { Range: range } });
			assert.equal(response.status, 206);
			assert.equal(response.headers.get("content-type"), "video/mp4");
			assert.equal(response.headers.get("content-range"), contentRange);
			assert.equal(Number(response.headers.get("content-length")), body.length);
			assert.equal(await response.text(), body);
		}
		for (const range of ["bytes=20-30", "bytes=5-2", "bytes=-0", "bytes=0-1,5-6", "garbage"]) {
			const response = await get("/artifacts/t/clip.mp4", { headers: { Range: range } });
			assert.equal(response.status, 416);
			assert.equal(response.headers.get("content-range"), "bytes */10");
		}
		const response = await get("/artifacts/t/clip.mp4", { method: "HEAD" });
		assert.equal(response.headers.get("content-length"), "10");
		assert.equal(await response.text(), "");
	});
	await t.test("unsafe paths and symlinks cannot escape artifacts or public", async () => {
		for (const path of ["/artifacts/t/..%2f..%2fetc%2fpasswd", "/artifacts/t/%5cetc%5cpasswd",
			"/artifacts/t/%252e%252e%252fsecret", "/artifacts/t/%00", "/artifacts/t/%ZZ",
			"/artifacts/t/C%3aWindows", "/artifacts/t/missing", "/api/topics/%00"]) {
			assert.ok([400, 404].includes((await get(path)).status), path);
		}
		await writeFile(join(home, "secret.txt"), "private");
		await symlink(join(home, "secret.txt"), join(store.artifactsDir("t"), "escape.txt"));
		assert.equal((await get("/artifacts/t/escape.txt")).status, 404);
		assert.equal((await get("/server.ts")).status, 404);
	});
	await t.test("static app and security headers", async () => {
		const response = await get("/");
		assert.equal(response.status, 200);
		assert.match(await response.text(), /ψ Studio/);
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		assert.equal((await get("/app.js")).headers.get("content-type"), "text/javascript; charset=utf-8");
		assert.equal((await get("/styles.css")).headers.get("content-type"), "text/css; charset=utf-8");
		assert.equal((await get("/api/topics", { method: "DELETE" })).status, 405);
	});
	await t.test("review history tolerates an incomplete concurrent line", async () => {
		await appendFile(join(store.topicDir("t"), "reviews.jsonl"), '{"unfinished":');
		assert.equal((await (await get("/api/topics/t/reviews")).json()).length, 1);
	});
	await t.test("SSE notifies nested filesystem changes", async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 4000);
		try {
			const response = await get("/api/events", { signal: controller.signal });
			assert.equal(response.headers.get("content-type"), "text/event-stream");
			const reader = response.body!.getReader();
			await reader.read(); // Initial comment confirms the client is subscribed.
			store.writeArtifact("t", "live.txt", "A new connection");
			let data = "";
			while (!data.includes("event: changed")) {
				const result = await reader.read();
				assert.equal(result.done, false);
				data += new TextDecoder().decode(result.value);
			}
			assert.match(data, /data: \{\}/);
			await reader.cancel();
		} finally { clearTimeout(timeout); controller.abort(); }
	});
	await t.test("close is idempotent", async () => { await studio.close(); await studio.close(); });
});
