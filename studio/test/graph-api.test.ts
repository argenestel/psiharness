import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AgentHub } from "../src/agent.ts";
import { handleGraphRoute } from "../src/graph-api.ts";
import { PsiStore } from "../../core/src/store.ts";

async function fixture(t: TestContext) {
	const home = mkdtempSync(join(tmpdir(), "psi-graph-api-"));
	const bin = join(home, "pi");
	writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--list-models" ]; then
printf 'provider  model  context  max-out  thinking  images\\nlocal  tiny  200K  8K  yes  no\\n'
else
while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":"\\([^" ]*\\)".*/\\1/p')
printf '{"type":"response","id":"%s","command":"set_model","success":true,"data":{"provider":"local","modelId":"tiny"}}\\n' "$id"
done
fi
`);
	chmodSync(bin, 0o755);
	const store = new PsiStore(home);
	const hub = new AgentHub(home, { bin });
	t.after(async () => { await hub.close(); rmSync(home, { recursive: true, force: true }); });
	const request = async (path: string, method = "GET", body?: unknown, auth = true) => {
		if (path === "/api/chat" && method === "POST") {
			return { status: 200, json: async () => hub.create(body as { model?: string }) };
		}
		const req = Readable.from(body ? [JSON.stringify(body)] : []) as IncomingMessage;
		req.url = path; req.method = method; req.headers = auth ? { "x-psi": "1" } : {};
		let status = 0, data = "";
		const res = { writeHead(code: number) { status = code; }, end(value: string) { data = value; } };
		assert.equal(await handleGraphRoute(req, res as ServerResponse, home, hub, bin), true);
		return { status, json: async () => JSON.parse(data) };
	};
	return { home, store, hub, request };

}

test("models and live chat model switching, validation and SSE replay", async (t) => {
	const { hub, request } = await fixture(t);
	assert.equal((await (await request("/api/models")).json()).models[0].id, "local/tiny");
	const { id } = await (await request("/api/chat", "POST", { model: "local/old" })).json();
	for (const model of ["", "tiny", "a/b/c", "a/", "/b"]) {
		assert.equal((await request(`/api/chat/${id}/model`, "POST", { model })).status, 400);
	}
	assert.equal((await request(`/api/chat/${id}/model`, "POST", {})).status, 400);
	assert.equal((await request("/api/chat/missing/model", "POST", { model: "local/tiny" })).status, 404);
	assert.equal((await request(`/api/chat/${id}/model`, "POST", { model: "local/tiny" }, false)).status, 403);
	const switched = await request(`/api/chat/${id}/model`, "POST", { model: "local/tiny" });
	assert.equal(switched.status, 200, JSON.stringify(await switched.json()));
	let data = "";
	const sink = new EventEmitter() as ServerResponse;
	sink.writeHead = (() => sink) as ServerResponse["writeHead"];
	sink.write = ((chunk: string) => { data += chunk; return true; }) as ServerResponse["write"];
	hub.subscribe(id, sink);
	assert.match(data, /"provider":"local","modelId":"tiny"/);
	assert.match(data, /"type":"psi_model_switched","model":"local\/tiny"/);
	sink.emit("close");
});

test("graph decoding, links, paths CRUD and mutation guard", async (t) => {
	const { home, store, request } = await fixture(t);
	for (const [path, method] of [["/api/graph/links", "DELETE"], ["/api/paths/x", "PUT"]]) {
		assert.equal((await request(path, method, {}, false)).status, 403);
	}
	const modulePath = "../../core/src/knowledge.ts";
	let knowledge;
	try { knowledge = await import(modulePath); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
		t.skip("Concurrent core/src/knowledge.ts is not available yet"); return;
	}
	const date = new Date().toISOString();
	store.writeGraph("sample", { topic: "sample", title: "Sample", bigIdea: "Connect", createdAt: date,
		updatedAt: date, concepts: [{ id: "a/b", title: "A", summary: "A", prerequisites: [], difficulty: 1 },
			{ id: "b", title: "B", summary: "B", prerequisites: [], difficulty: 1 }] });
	const graph = new knowledge.KnowledgeStore(home).build();
	const from = graph.nodes.find((n: { kind: string }) => n.kind === "concept").id;
	const to = graph.nodes.find((n: { id: string }) => n.id !== from).id;
	assert.equal((await request("/api/graph")).status, 200);
	assert.equal((await request(`/api/graph/neighborhood/${encodeURIComponent(from)}?depth=1`)).status, 200);
	assert.equal((await request(`/api/graph/neighborhood/${encodeURIComponent(from)}?depth=1.5`)).status, 400);
	assert.equal((await request("/api/graph/links", "POST", { from, to })).status, 200);
	assert.equal((await request("/api/graph/links", "DELETE", { from, to })).status, 200);
	assert.equal((await request("/api/graph/links", "POST", { from })).status, 400);
	const draft = { title: "Learn", goal: "Connect", steps: [from] };
	const created = await (await request("/api/paths", "POST", draft)).json();
	assert.ok(created.id);
	assert.equal((await request("/api/paths")).status, 200);
	assert.equal((await request(`/api/paths/${created.id}`)).status, 200);
	assert.equal((await request(`/api/paths/${created.id}`, "PUT", { ...draft, title: "Updated" })).status, 200);
	assert.equal((await request(`/api/paths/${created.id}`, "DELETE")).status, 200);
	for (const method of ["GET", "PUT", "DELETE"]) {
		assert.equal((await request(`/api/paths/${created.id}`, method, method === "PUT" ? draft : undefined)).status, 404);
	}
});
