import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentHub } from "../src/agent.ts";
import { fakePi } from "./fake-pi.ts";
import type { ServerResponse } from "node:http";

// The same fake script also runs in a VM to validate protocol logic on hosts that deny subprocess I/O.
test("RPC transport retains Unicode, ordered fanout, bounded replay and process lifecycle", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-protocol-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const bin = fakePi(home);
	const children: (EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; killed: boolean })[] = [];
	t.mock.method(childProcess, "spawn", (_bin: string, args: string[], options: any) => {
		const child = Object.assign(new EventEmitter(), {
			stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
			kill(this: EventEmitter & { killed: boolean }) { this.killed = true; queueMicrotask(() => this.emit("close", 0, "SIGTERM")); return true; },
		});
		children.push(child);
		const source = readFileSync(bin, "utf8").replace(/^#![^\n]*\n/, "")
			.replace('import { appendFileSync } from "node:fs";', "");
		runInNewContext(source, { appendFileSync, Buffer, process: {
			argv: ["node", bin, ...args], stdin: child.stdin, stdout: child.stdout,
			cwd: () => options.cwd, env: options.env, pid: children.length,
		} });
		return child as unknown as ChildProcessWithoutNullStreams;
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const hub = new AgentHub(home, { bin, idleMs: 30 });
	t.after(() => hub.close());
	const { id } = hub.create("fake/model");
	function subscriber(since = 0) {
		const records: Record<string, any>[] = [];
		const res = Object.assign(new EventEmitter(), { writeHead() {},
			write(frame: string) { if (frame.startsWith("id:")) records.push(JSON.parse(frame.split("data: ")[1])); return true; },
			end(this: EventEmitter) { this.emit("close"); }, destroy(this: EventEmitter) { this.emit("close"); } });
		hub.subscribe(id, res as unknown as ServerResponse, since);
		return records;
	}
	const events = subscriber();
	assert.equal(events[0].command, "get_state");
	hub.send(id, { type: "prompt", message: "First question" });
	assert.equal(events.find((r) => r.type === "message_update")!.assistantMessageEvent.delta, "Hi 🌱\u2028there");
	assert.deepEqual(events.map((r) => r.seq - events[0].seq), events.map((_, i) => i));
	assert.equal(events.find((r) => r.type === "tool_execution_end")!.result.details.widget.id, "c1");
	assert.equal(events.find((r) => r.type === "extension_ui_request")!.method, "select");
	const cursor = events[2].seq;
	const replay = subscriber(cursor);
	assert.ok(replay.length > 0 && replay.every((r) => r.seq > cursor));
	assert.deepEqual(replay.map((r) => r.seq), [...replay.map((r) => r.seq)].sort((a, b) => a - b));
	hub.send(id, { type: "extension_ui_response", id: "ui1", value: "B" });
	assert.deepEqual(events.at(-1)!.response, { type: "extension_ui_response", id: "ui1", value: "B" });
	hub.send(id, { type: "abort" });
	assert.equal(events.at(-1)!.aborted, true);
	for (let n = 0; n < 600; n++) hub.send(id, { type: "prompt", message: `Question ${n}` });
	const bounded = subscriber();
	const durable = (r: Record<string, any>) => r.type === "message_end" || r.type === "tool_execution_end";
	// Non-durable records are bounded; every completed message and tool result survives for a fresh tab.
	const live = bounded.filter((r) => !durable(r)).length;
	assert.ok(live <= 2000 && live > 1990, String(live));
	assert.equal(bounded.filter((r) => r.type === "message_end").length, 2 * 601);
	assert.equal(bounded.filter((r) => r.type === "tool_execution_end").length, 601);
	assert.equal(bounded.at(-1)!.seq, events.at(-1)!.seq);
	assert.equal(hub.list()[0].title, "First question");
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(children[0].killed, true);
	assert.equal(events.at(-1)!.type, "agent_exit");
	const lastSeq = events.at(-1)!.seq;
	hub.send(id, { type: "prompt", message: "Resume" });
	assert.equal(children.length, 2);
	assert.equal(events.find((r) => r.seq === lastSeq + 1)!.command, "get_state");
	await hub.close();
	assert.ok(children.every((child) => child.killed));
	assert.throws(() => hub.create(), { status: 503 });
	await hub.close();
});
