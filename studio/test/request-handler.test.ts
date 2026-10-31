import test from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../src/server.ts";
import { PsiStore } from "../../core/src/store.ts";

// Exercise the real HTTP request listener without requiring permission to open a socket.
test("request handler enforces Host, X-Psi and body limits before routing persistent APIs", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-handler-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	let native: Server;
	t.mock.method(Server.prototype, "listen", function (this: Server, ...args: unknown[]) {
		native = this;
		(args.at(-1) as () => void)();
		return this;
	});
	t.mock.method(Server.prototype, "address", () => ({ port: 4173, address: "127.0.0.1", family: "IPv4" }));
	t.mock.method(Server.prototype, "close", function (this: Server, callback: () => void) { callback(); return this; });
	const studio = await startStudio({ port: 0, store: new PsiStore(home), agentBin: join(home, "missing") });
	t.after(() => studio.close());
	async function call(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
		const bytes = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
		const req = Readable.from([Buffer.from(bytes)]) as unknown as IncomingMessage;
		req.url = path; req.method = method;
		req.headers = { host: "localhost", "content-type": "application/json", ...headers };
		let output = "", status = 200;
		let finish!: () => void;
		const done = new Promise<void>((resolve) => { finish = resolve; });
		const res = Object.assign(new EventEmitter(), {
			headersSent: false,
			setHeader() {},
			writeHead(code: number) { status = code; this.headersSent = true; },
			end(data = "") { output += data; finish(); },
		});
		native.emit("request", req, res as unknown as ServerResponse);
		await done;
		return { status, body: output ? JSON.parse(output) : undefined };
	}
	assert.equal((await call("/api/memory", "POST", { kind: "goal", text: "Learn" })).status, 403);
	assert.equal((await call("/api/memory", "DELETE")).status, 403);
	assert.equal((await call("/api/state", "PUT")).status, 403);
	assert.equal((await call("/api/state", "GET", undefined, { host: "evil.example" })).status, 421);
	const authorized = { "x-psi": "1" };
	assert.equal((await call("/api/chat", "POST", "{", authorized)).status, 400);
	assert.equal((await call("/api/chat", "POST", [], authorized)).status, 400);
	assert.equal((await call("/api/chat", "POST", {}, { ...authorized, "content-type": "text/plain" })).status, 415);
	assert.equal((await call("/api/chat", "POST", { model: "x".repeat(256 * 1024) }, authorized)).status, 413);
	assert.equal((await call("/api/chat", "POST", { skill: "../bad" }, authorized)).status, 400);
	const created = await call("/api/chat", "POST", { skill: "mental-math", topic: "numbers" }, authorized);
	assert.equal(created.status, 200);
	assert.equal(typeof created.body.id, "string");
	assert.equal((await call("/api/state")).body.activeSkill, "mental-math");
	assert.equal((await call("/api/chat")).body[0].id, created.body.id);
	assert.equal((await call(`/api/chat/${created.body.id}/events?since=-1`)).status, 400);
	assert.equal((await call("/api/chat/missing/prompt", "POST", { message: "Hi" }, authorized)).status, 404);
	assert.equal((await call("/api/packs/mental-math/import", "POST", {}, authorized)).status, 200);
	assert.equal((await call("/api/packs/mental-math/import", "POST", {}, authorized)).body.alreadyImported, true);
	assert.equal((await call("/api/chat", "POST", { model: "--tools=bash" }, authorized)).status, 400);
	const detail = (await call("/api/skills/mental-math")).body;
	assert.ok(!JSON.stringify(detail).includes('"expected"'));
	const challenge = JSON.parse(readFileSync(new URL("../../examples/skills/mental-math/challenges.json", import.meta.url), "utf8"))
		.find((c: { expected?: string }) => c.expected);
	const attempt = await call(`/api/skills/mental-math/challenges/${challenge.id}/attempt`, "POST",
		{ answer: challenge.expected, outcome: "fail" }, authorized);
	assert.equal(attempt.body.attempt.outcome, "success");
	const memory = await call("/api/memory", "POST", { kind: "goal", text: "Learn arithmetic" }, authorized);
	assert.equal(memory.status, 200);
	assert.equal((await call("/api/memory")).body.items[0].text, "Learn arithmetic");
	assert.equal((await call(`/api/memory/${memory.body.id}`, "DELETE", undefined, authorized)).status, 200);
	assert.equal((await call("/api/memory")).body.items.length, 0);
	await studio.close();
});
