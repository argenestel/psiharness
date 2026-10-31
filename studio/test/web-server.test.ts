import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PsiStore } from "../../core/src/store.ts";
import { startStudio } from "../src/server.ts";
import { fakePi } from "./fake-pi.ts";

test("Web HTTP routes enforce X-Psi, bound JSON and stream/replay fake RPC", { timeout: 15000 }, async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-web-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const server = await startStudio({ port: 0, host: "127.0.0.1", store: new PsiStore(home), agentBin: fakePi(home) });
	t.after(() => server.close());
	const call = (path: string, body?: unknown, method = "POST", headers = { "X-Psi": "1", "Content-Type": "application/json" }) =>
		fetch(server.url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	for (const path of ["/api/chat", "/api/memory", "/api/packs/mental-math/import"]) {
		assert.equal((await call(path, {}, "POST", { "X-Psi": "", "Content-Type": "application/json" })).status, 403);
	}
	assert.equal((await call("/api/chat", { model: 5 })).status, 400);
	assert.equal((await call("/api/chat", { skill: "../outside" })).status, 400);
	assert.equal((await call("/api/chat", { model: "x".repeat(256 * 1024) })).status, 413);
	assert.equal((await fetch(server.url + "/api/chat", { method: "POST", headers: { "X-Psi": "1", "Content-Type": "application/json" }, body: "{" })).status, 400);
	const created = await call("/api/chat", { model: "fake/model", skill: "mental-math" });
	assert.equal(created.status, 200);
	const { id } = await created.json();
	assert.equal((await (await fetch(server.url + "/api/state")).json()).activeSkill, "mental-math");
	assert.equal((await (await fetch(server.url + "/api/chat")).json())[0].id, id);
	const controller = new AbortController();
	t.after(() => controller.abort());
	const response = await fetch(`${server.url}/api/chat/${id}/events`, { signal: controller.signal });
	assert.equal(response.headers.get("content-type"), "text/event-stream");
	const reader = response.body!.getReader();
	let buffer = "";
	const decoder = new TextDecoder();
	const records: Record<string, any>[] = [];
	async function receive(predicate: () => boolean) {
		while (!predicate()) {
			const { done, value } = await reader.read();
			assert.equal(done, false);
			buffer += decoder.decode(value, { stream: true });
			let end;
			while ((end = buffer.indexOf("\n\n")) >= 0) {
				const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
				const line = frame.split("\n").find((line) => line.startsWith("data: "));
				if (line) records.push(JSON.parse(line.slice(6)));
			}
		}
	}
	const prompted = await call(`/api/chat/${id}/prompt`, { message: "Hello" });
	assert.equal(prompted.status, 200);
	assert.deepEqual((await prompted.json()).data.disposition, "started");
	await receive(() => records.some((r) => r.type === "agent_settled"));
	assert.deepEqual(records.map((r) => r.seq - records[0].seq), records.map((_, i) => i));
	assert.ok(!JSON.stringify(records).includes('"expected"'));
	const since = records[2].seq;
	const replayController = new AbortController();
	const replay = await fetch(`${server.url}/api/chat/${id}/events?since=${since}`, { signal: replayController.signal });
	const replayReader = replay.body!.getReader();
	let replayText = "";
	while (!replayText.includes('"type":"agent_settled"')) replayText += decoder.decode((await replayReader.read()).value);
	assert.ok(!replayText.includes(`id: ${since}\n`));
	const ids = [...replayText.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
	assert.ok(ids.length > 0 && ids.every((n) => n > since));
	replayController.abort();
	assert.equal((await call(`/api/chat/${id}/ui`, { id: "ui1", value: "A", type: "bash" })).status, 200);
	await receive(() => records.some((r) => r.type === "ui_echo"));
	assert.equal(records.find((r) => r.type === "ui_echo")!.response.type, "extension_ui_response");
	assert.equal((await call(`/api/chat/${id}/abort`)).status, 200);
	await receive(() => records.some((r) => r.aborted === true));
	assert.equal((await call("/api/packs/mental-math/import", {})).status, 200);
	const skill = await (await fetch(server.url + "/api/skills/mental-math")).json();
	assert.ok(!JSON.stringify(skill).includes('"expected"'));
	const c = JSON.parse(readFileSync(new URL("../../examples/skills/mental-math/challenges.json", import.meta.url), "utf8"))
		.find((c: { expected?: string }) => c.expected);
	const attempt = await (await call(`/api/skills/mental-math/challenges/${c.id}/attempt`, { answer: c.expected })).json();
	assert.equal(attempt.attempt.outcome, "success");
	const memory = await (await call("/api/memory", { kind: "goal", text: "Learn mental math" })).json();
	assert.equal((await call(`/api/memory/${memory.id}`, undefined, "DELETE")).status, 200);
	controller.abort();
	assert.equal((await call(`/api/chat/${id}`, undefined, "DELETE")).status, 200);
	assert.equal((await fetch(`${server.url}/api/chat/${id}/events`)).status, 404);
	await server.close();
});

test("CSP lets KaTeX, the code runners and artifact frames work, and nothing else", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-csp-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const server = await startStudio({ port: 0, host: "127.0.0.1", store: new PsiStore(home), agentBin: join(home, "missing") });
	t.after(() => server.close());
	const policy = (header: string | null) => new Map((header ?? "").split(";").map((part) => {
		const [name, ...values] = part.trim().split(/\s+/);
		return [name, values] as [string, string[]];
	}));
	const page = await fetch(server.url + "/");
	const csp = policy(page.headers.get("content-security-policy"));
	const katex = "https://cdn.jsdelivr.net/npm/katex@0.16.11/";
	assert.deepEqual(csp.get("default-src"), ["'self'"]);
	for (const directive of ["script-src", "style-src", "font-src"]) assert.ok(csp.get(directive)!.includes(katex), directive);
	assert.ok(!csp.get("script-src")!.includes("'unsafe-inline'"));
	assert.ok(!csp.get("style-src")!.includes("'unsafe-inline'"));
	assert.ok(!csp.get("script-src")!.some((source) => source === "https:" || source === "*" || source === "https://cdn.jsdelivr.net"));
	// The JS runner's srcdoc frame inherits this policy: its bootstrap script is allowed by exact hash,
	// its blob: worker by worker-src, and learner code (new Function in that worker) by 'unsafe-eval'.
	const codelab = readFileSync(new URL("../public/js/codelab.js", import.meta.url), "utf8");
	const frameScript = /<script>([\s\S]*?)<\/script>/.exec(/const JS_FRAME = `([\s\S]*?)`;/.exec(codelab)![1])![1];
	assert.ok(csp.get("script-src")!.includes(`'sha256-${createHash("sha256").update(frameScript).digest("base64")}'`));
	assert.ok(csp.get("script-src")!.includes("'unsafe-eval'"));
	assert.deepEqual(csp.get("worker-src"), ["'self'", "blob:"]);
	assert.deepEqual(csp.get("frame-src"), ["'self'"]);
	assert.deepEqual(csp.get("object-src"), ["'none'"]);
	assert.deepEqual(csp.get("base-uri"), ["'none'"]);
	assert.ok(csp.get("connect-src")!.includes("'self'"));
	// Pyodide and sql.js load inside dedicated workers, whose own response policy pins their CDN paths and wasm.
	const python = policy((await fetch(server.url + "/js/runners/python-worker.js")).headers.get("content-security-policy"));
	assert.deepEqual(python.get("script-src"), ["https://cdn.jsdelivr.net/pyodide/v0.26.4/full/", "'wasm-unsafe-eval'"]);
	assert.deepEqual(python.get("connect-src"), ["https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"]);
	const sql = policy((await fetch(server.url + "/js/runners/sql-runner.js")).headers.get("content-security-policy"));
	assert.deepEqual(sql.get("script-src"), ["'self'", "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/", "'wasm-unsafe-eval'"]);
	assert.deepEqual(sql.get("connect-src"), ["https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/"]);
	assert.equal((await fetch(server.url + "/js/runners/js-worker.js")).status, 200);
	// Every non-GET needs X-Psi; HEAD is a GET.
	assert.equal((await fetch(server.url + "/", { method: "HEAD" })).status, 200);
	assert.equal((await fetch(server.url + "/api/memory", { method: "DELETE" })).status, 403);
	await server.close();
});
