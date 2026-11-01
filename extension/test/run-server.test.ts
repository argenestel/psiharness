import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { parseRun, serveRuns } from "../src/practice/run-server.ts";
import { runRemote } from "../src/practice/run-client.ts";
import { execute } from "../src/practice/run.ts";

function post(socketPath: string, body: string): Promise<{ status: number; data: any }> {
	return new Promise((resolve, reject) => {
		const req = request({ socketPath, path: "/run", method: "POST" }, (res) => {
			let text = ""; res.on("data", (c) => { text += c; });
			res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(text) }));
		});
		req.on("error", reject); req.end(body);
	});
}

test("the runner executes over its Unix socket and the client returns the result", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "psi-runner-"));
	const socket = join(dir, "run.sock");
	const server = await serveRuns(socket);
	t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
	assert.equal(statSync(socket).mode & 0o777, 0o600);
	const result = await runRemote(socket, { language: "javascript", code: "console.log(6 * 7)" });
	assert.equal(result.stdout.trim(), "42");
	assert.equal(result.exitCode, 0);
	const bad = await post(socket, JSON.stringify({ language: "ruby", code: "puts 1" }));
	assert.equal(bad.status, 400);
	assert.match(bad.data.error, /Unsupported language/);
	assert.equal((await post(socket, "{nope")).status, 400);
	await assert.rejects(runRemote(socket, { language: "python", code: 5 as unknown as string }), /code must be a string/);
});

test("PSI_RUN_SOCKET routes execution to the runner and fails closed when it is down", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "psi-runner-"));
	const previous = process.env.PSI_RUN_SOCKET;
	t.after(() => {
		if (previous === undefined) delete process.env.PSI_RUN_SOCKET; else process.env.PSI_RUN_SOCKET = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	process.env.PSI_RUN_SOCKET = join(dir, "missing.sock");
	await assert.rejects(execute({ language: "javascript", code: "console.log(1)" }), /Code runner unavailable/);
	const bashWas = process.env.PSI_CODE_EXEC_BASH;
	delete process.env.PSI_CODE_EXEC_BASH;
	await assert.rejects(execute({ language: "bash", code: "echo hi" }), /PSI_CODE_EXEC_BASH=1/);
	if (bashWas !== undefined) process.env.PSI_CODE_EXEC_BASH = bashWas;
});

test("parseRun accepts only the documented fields and types", () => {
	assert.deepEqual(parseRun({ language: "sql", code: "SELECT 1;", setup: "", extra: 1 }),
		{ language: "sql", code: "SELECT 1;", setup: "" });
	assert.equal(parseRun(null), "Expected a JSON object.");
	assert.equal(parseRun({ language: "python", code: "1", stdin: 3 }), "stdin must be a string.");
});

test("the runner and its core never import the pi agent", () => {
	for (const file of ["run-core.ts", "run-server.ts", "run-client.ts"]) {
		const source = readFileSync(new URL(`../src/practice/${file}`, import.meta.url), "utf8");
		assert.doesNotMatch(source, /@earendil-works|@oh-my-pi/, file);
	}
});
