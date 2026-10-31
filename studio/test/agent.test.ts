import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { AgentHub, agentArgs, historyRecords, psiToolNames, redactRecord } from "../src/agent.ts";
import { fakePi } from "./fake-pi.ts";

// A variable specifier keeps the untyped browser module out of the type checker.
const chatPath = "../public/js/chat.js";
const { reduceRecord } = await import(chatPath) as { reduceRecord: (state: any, record: any) => any };

class Subscriber extends EventEmitter {
	records: Record<string, any>[] = [];
	writeHead() { return this; }
	write(data: string) {
		if (data.startsWith("id:")) this.records.push(JSON.parse(data.split("data: ")[1]));
		return true;
	}
	end() { this.emit("close"); }
	destroy() { this.end(); }
	response() { return this as unknown as ServerResponse; }
}
async function until(predicate: () => boolean) {
	const deadline = Date.now() + 4000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out awaiting fake pi record");
		await new Promise((r) => setTimeout(r, 10));
	}
}
const consecutive = (records: Record<string, any>[]) =>
	assert.deepEqual(records.map((r) => r.seq - records[0].seq), records.map((_, i) => i));

test("AgentHub frames RPC bytes, sequences/replays events, forwards commands and resumes sessions", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-agent-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const bin = fakePi(home);
	const hub = new AgentHub(home, { bin });
	t.after(() => hub.close());
	const { id } = hub.create({ model: "test/model", skill: "mental-math" });
	assert.equal(hub.list()[0].title, "New chat");
	const subscriber = new Subscriber();
	hub.subscribe(id, subscriber.response());
	await until(() => subscriber.records.some((r) => r.command === "get_state"));
	const state = subscriber.records.find((r) => r.command === "get_state")!.data;
	assert.equal(state.cwd, join(home, "workspace"));
	assert.equal(state.home, home);
	assert.equal(state.args[state.args.indexOf("--model") + 1], "test/model");
	assert.equal(state.args[state.args.indexOf("--tools") + 1], "read,psi_*");
	assert.equal(state.args[state.args.indexOf("--session-dir") + 1], join(home, "web-sessions"));
	assert.equal(state.args[state.args.indexOf("--psi-skill") + 1], "mental-math");
	assert.deepEqual(state.args.slice(0, 2), ["--mode", "rpc"]);
	for (const flag of ["--skill", "--prompt-template", "--no-mcp", "--psi-tutor=true", "-e"]) assert.ok(state.args.includes(flag), flag);
	const response = await hub.send(id, { type: "prompt", message: "First question" }, 4000);
	assert.equal(response!.success, true);
	assert.equal((response!.data as any).disposition, "started");
	await until(() => subscriber.records.some((r) => r.type === "agent_settled"));
	consecutive(subscriber.records);
	assert.ok(subscriber.records[0].seq > Date.now() * 1000 - 60e9, "sequence numbers are time-based");
	assert.deepEqual(subscriber.records.slice(1).map((r) => r.type), ["response", "agent_start", "message_start",
		"message_update", "message_update", "message_end", "tool_execution_start", "tool_execution_end",
		"extension_ui_request", "extension_ui_request", "message_end", "agent_end", "agent_settled"]);
	assert.equal(subscriber.records.find((r) => r.type === "message_update")!.assistantMessageEvent.delta, "Hi 🌱 there");
	assert.equal(subscriber.records.find((r) => r.type === "tool_execution_end")!.result.details.widget.id, "c1");
	// Answer keys never reach the browser: deltas are dropped and tool-call arguments are redacted.
	const wire = JSON.stringify(subscriber.records);
	for (const secret of ['"expected"', '"acceptable"', '"rubric"']) assert.ok(!wire.includes(secret), secret);
	assert.equal(subscriber.records.find((r) => r.type === "tool_execution_start")!.args.prompt, "6*7?");
	assert.equal(subscriber.records.find((r) => r.type === "agent_end")!.messages, undefined);
	assert.equal(hub.list()[0].title, "First question");
	// The replay buffer drops records superseded by message_end / tool_execution_end / settled dialogs.
	const replay = new Subscriber();
	hub.subscribe(id, replay.response());
	assert.deepEqual(replay.records.map((r) => r.type), ["response", "response", "agent_start", "message_end",
		"tool_execution_end", "extension_ui_request", "message_end", "agent_end", "agent_settled"]);
	const view = replay.records.reduce(reduceRecord, {});
	assert.deepEqual(view.messages.map((m: any) => m.text), ["Hi 🌱 there", "Hi there friend"]);
	const since = subscriber.records[4].seq;
	const partial = new Subscriber();
	hub.subscribe(id, partial.response(), since);
	assert.ok(partial.records.every((r) => r.seq > since));
	hub.send(id, { type: "extension_ui_response", id: "ui1", value: "B" });
	await until(() => replay.records.some((r) => r.type === "ui_echo"));
	assert.deepEqual(replay.records.find((r) => r.type === "ui_echo")!.response,
		{ type: "extension_ui_response", id: "ui1", value: "B" });
	hub.send(id, { type: "abort" });
	await until(() => replay.records.some((r) => r.aborted === true));
	await hub.close();
	assert.throws(() => process.kill(state.pid, 0), /ESRCH/);
	// A torn final entry must not hide a valid persisted chat.
	appendFileSync(state.sessionFile, '{"incomplete":');
	const resumed = new AgentHub(home, { bin });
	t.after(() => resumed.close());
	assert.equal(resumed.list()[0].id, id);
	assert.equal(resumed.list()[0].title, "First question");
	// Opening a saved chat replays its history from the session file without spawning pi.
	const next = new Subscriber();
	resumed.subscribe(id, next.response());
	assert.deepEqual(next.records.map((r) => [r.type, r.message?.role ?? r.toolName]), [
		["message_end", "user"], ["message_end", "assistant"], ["tool_execution_end", "psi_challenge"],
		["message_end", "assistant"]]);
	consecutive(next.records);
	const rebuilt = next.records.reduce(reduceRecord, {});
	assert.deepEqual(rebuilt.messages.map((m: any) => [m.role, m.text]), [["user", "First question"],
		["assistant", "Hi 🌱 there"], ["assistant", "Hi there friend"]]);
	assert.equal(rebuilt.tools[0].name, "psi_challenge");
	assert.equal(rebuilt.tools[0].turn, 1);
	assert.equal(rebuilt.tools[0].result.details.widget.id, "c1");
	assert.equal(rebuilt.tools[0].args.prompt, "6*7?");
	assert.ok(!JSON.stringify(next.records).includes('"expected"'));
	// A tab left open across the restart reconnects with an old cursor: it gets only live records, no duplicates.
	const stale = new Subscriber();
	resumed.subscribe(id, stale.response(), subscriber.records.at(-1)!.seq);
	assert.equal(stale.records.length, 0);
	await resumed.send(id, { type: "prompt", message: "Second" }, 4000);
	await until(() => next.records.some((r) => r.type === "agent_settled"));
	assert.equal(next.records.filter((r) => r.command === "get_state").length, 1);
	assert.equal(next.records.find((r) => r.command === "get_state")!.data.sessionFile, state.sessionFile);
	assert.ok(stale.records.length > 0 && stale.records.every((r) => !r.history));
	await resumed.delete(id);
	assert.equal(resumed.list().length, 0);
	assert.throws(() => readFileSync(state.sessionFile), /ENOENT/);
});

test("history follows the active branch of the session tree and redacts answer keys", (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-history-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const file = join(home, "s.jsonl");
	const entry = (id: string, parentId: string | null, message: object) =>
		JSON.stringify({ type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message });
	writeFileSync(file, [JSON.stringify({ type: "session", version: 3, id: "s" }),
		entry("a", null, { role: "system", content: "", sections: {} }),
		entry("b", "a", { role: "user", content: "Abandoned" }),
		entry("c", "a", { role: "user", content: [{ type: "text", text: "Kept" }] }),
		entry("d", "c", { role: "assistant", content: [{ type: "toolCall", id: "x", name: "psi_challenge",
			arguments: { prompt: "p", expected: "secret", acceptable: ["s"] } }] }),
		JSON.stringify({ type: "custom", id: "e", parentId: "d", customType: "psi-practice", data: {} }),
		entry("f", "e", { role: "toolResult", toolCallId: "x", toolName: "psi_challenge", isError: false,
			content: [{ type: "text", text: "ok" }], details: { widget: { type: "challenge", id: "c9", skill: "k" } } }),
		'{"torn":'].join("\n"));
	const records = historyRecords(file);
	assert.deepEqual(records.map((r) => r.type), ["message_end", "message_end", "tool_execution_end"]);
	assert.equal((records[0].message as any).content[0].text, "Kept");
	assert.deepEqual(records[2].args, { prompt: "p" });
	assert.equal((records[2].result as any).details.widget.id, "c9");
	assert.ok(!JSON.stringify(records).includes("secret"));
	assert.deepEqual(redactRecord({ toolName: "psi_attempt", args: { expected: 1 } }), { toolName: "psi_attempt", args: { expected: 1 } });
});

test("omp hosts get explicit tool names and no pi-only flags", () => {
	const names = psiToolNames();
	assert.ok(names.includes("psi_challenge") && names.includes("psi_attempt"));
	const omp = agentArgs({ omp: true, directory: "/d", file: "/d/f.jsonl", model: "xai/grok-4.6" });
	for (const flag of ["--skill", "--prompt-template", "--no-mcp"]) assert.ok(!omp.includes(flag));
	assert.equal(omp[omp.indexOf("--tools") + 1], ["read", ...names].join(","));
	assert.match(omp[omp.indexOf("--append-system-prompt") + 1], /SKILL\.md/);
	assert.equal(omp[omp.indexOf("--model") + 1], "xai/grok-4.6");
});

test("invalid models and slugs are rejected before spawning", (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-invalid-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const hub = new AgentHub(home, { bin: join(home, "missing") });
	t.after(() => hub.close());
	assert.throws(() => hub.create({ model: "--tools=bash" }), { status: 400 });
	assert.throws(() => hub.create({ skill: "../x" }), { status: 400 });
	assert.equal(hub.list().length, 0);
});

test("idle children exit and reconnect resumes with increasing sequence numbers", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-idle-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const hub = new AgentHub(home, { bin: fakePi(home), idleMs: 150 });
	t.after(() => hub.close());
	const { id } = hub.create();
	const subscriber = new Subscriber();
	hub.subscribe(id, subscriber.response());
	await until(() => subscriber.records.some((r) => r.type === "agent_exit"));
	const pid = subscriber.records.find((r) => r.command === "get_state")!.data.pid;
	assert.throws(() => process.kill(pid, 0), /ESRCH/);
	const previous = subscriber.records.at(-1)!.seq;
	hub.send(id, { type: "prompt", message: "Resume" });
	await until(() => subscriber.records.some((r) => r.type === "agent_settled"));
	assert.equal(subscriber.records.find((r) => r.command === "get_state" && r.seq > previous)!.seq, previous + 1);
	consecutive(subscriber.records);
});

test("spawn errors reach subscribers without crashing the server", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-spawn-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const hub = new AgentHub(home, { bin: join(home, "missing") });
	t.after(() => hub.close());
	const { id } = hub.create();
	const subscriber = new Subscriber();
	hub.subscribe(id, subscriber.response());
	await until(() => subscriber.records.some((r) => r.type === "agent_exit"));
	assert.match(subscriber.records.find((r) => r.type === "agent_error")!.error, /ENOENT/);
});
