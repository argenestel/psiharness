import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import type { ServerResponse } from "node:http";
import { AgentHub } from "../src/agent.ts";

/** A saved pi session with `turns` user/assistant/tool-result triples carrying `size`-byte tool output each. */
function largeSession(home: string, turns: number, size: number): string {
	const id = "00000000-0000-4000-8000-000000000001";
	const lines = [{ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: home }];
	let parent: string | null = null, n = 0;
	const add = (message: Record<string, unknown>) => {
		const entry = { type: "message", id: `e${++n}`, parentId: parent, timestamp: new Date().toISOString(), message };
		parent = entry.id; lines.push(entry as never);
	};
	for (let i = 0; i < turns; i++) {
		add({ role: "user", content: [{ type: "text", text: `Question ${i}` }] });
		add({ role: "assistant", content: [{ type: "text", text: `Answer ${i}` },
			{ type: "toolCall", id: `t${i}`, name: "read", arguments: { path: `/notes/${i}.md` } }] });
		add({ role: "toolResult", toolCallId: `t${i}`, toolName: "read",
			content: [{ type: "text", text: `${i}:`.padEnd(size, "x") }], isError: false });
	}
	add({ role: "assistant", content: [{ type: "text", text: "LAST MESSAGE" }] });
	writeFileSync(join(home, "web-sessions", `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
	return id;
}

test("reopening a saved chat replays a history far larger than the socket buffer", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-replay-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const hub = new AgentHub(home, { bin: "/nonexistent" });
	t.after(() => hub.close());
	// About 3 MB of replay: well over the ~16 KB that made the old write() destroy the stream.
	const id = largeSession(home, 60, 50_000);
	const server = createServer((req, res) => hub.subscribe(id, res, 0));
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	t.after(() => server.close());
	const { port } = server.address() as AddressInfo;
	const body = await new Promise<string>((resolve, reject) => {
		const req = get({ host: "127.0.0.1", port, path: "/" }, (res) => {
			let text = "";
			// A slow reader: pause first so the server's socket buffer fills during replay.
			res.pause();
			setTimeout(() => res.resume(), 300);
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				text += chunk;
				if (text.includes("LAST MESSAGE")) { req.destroy(); resolve(text); }
			});
			res.on("end", () => reject(new Error(`Stream ended early after ${text.length} bytes`)));
			res.on("error", reject);
		});
		req.on("error", (error) => { if (!/LAST MESSAGE/.test(String(error))) reject(error); });
		setTimeout(() => reject(new Error("Timed out waiting for replay")), 8000).unref();
	});
	const records = body.split("\n\n").filter((f) => f.startsWith("id:")).map((f) => JSON.parse(f.split("data: ")[1]));
	assert.equal(records.filter((r) => r.type === "tool_execution_end").length, 60);
	assert.equal(records.filter((r) => r.type === "message_end").length, 121);
	assert.ok(body.length > 2_500_000);
});

class SlowResponse extends EventEmitter {
	chunks: string[] = []; destroyed = false; writableEnded = false; full = false;
	writeHead() { return this; }
	write(chunk: string) { this.chunks.push(chunk); return !this.full; }
	end() { this.writableEnded = true; this.emit("close"); }
	destroy() { this.destroyed = true; this.emit("close"); }
	response() { return this as unknown as ServerResponse; }
}

test("SSE writes queue while blocked, flush in order on drain, and only a stuck client is cut off", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-drain-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const hub = new AgentHub(home, { bin: "/nonexistent", stallMs: 80, maxQueuedBytes: 1_000_000 });
	t.after(() => hub.close());
	const id = largeSession(home, 5, 100);
	const slow = new SlowResponse();
	slow.full = true;
	hub.subscribe(id, slow.response(), 0);
	// Only the first chunk reached the socket; the rest waits in the queue.
	assert.equal(slow.chunks.length, 1);
	slow.full = false;
	slow.emit("drain");
	const frames = slow.chunks.filter((c) => c.startsWith("id:"));
	assert.equal(frames.length, 5 * 3 + 1);
	const seqs = frames.map((f) => Number(/^id: (\d+)/.exec(f)![1]));
	assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
	assert.equal(slow.destroyed, false);

	const stuck = new SlowResponse();
	stuck.full = true;
	hub.subscribe(id, stuck.response(), 0);
	await new Promise((r) => setTimeout(r, 150));
	assert.equal(stuck.destroyed, true, "a client that never drains is disconnected after stallMs");

	const flooded = new SlowResponse();
	flooded.full = true;
	const tiny = new AgentHub(home, { bin: "/nonexistent", maxQueuedBytes: 200, stallMs: 10_000 });
	t.after(() => tiny.close());
	tiny.subscribe(id, flooded.response(), 0);
	assert.equal(flooded.destroyed, true, "a client past maxQueuedBytes is disconnected");
});
