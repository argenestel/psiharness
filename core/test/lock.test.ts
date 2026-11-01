import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withFileLock } from "../src/lock.ts";

function pause(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitFor(check: () => boolean, timeoutMs: number): boolean {
	const deadline = Date.now() + timeoutMs;
	while (!check() && Date.now() < deadline) pause(10);
	return check();
}

function stop(child: ChildProcess): void {
	if (child.exitCode === null) child.kill();
}

test("reclaims a lock older than the stale threshold and supports reentrancy", (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-lock-stale-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const target = path.join(home, "memory.json"), lock = `${target}.lock`;
	fs.writeFileSync(lock, `${process.pid}\n`);
	const old = new Date(Date.now() - 11_000);
	fs.utimesSync(lock, old, old);
	assert.equal(withFileLock(target, () => withFileLock(target, () => "nested", { timeoutMs: 10 }),
		{ timeoutMs: 200 }), "nested");
	assert.equal(fs.existsSync(lock), false);
});

test("does not reclaim a live child lock before timeout", (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-lock-live-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const target = path.join(home, "memory.json"), ready = path.join(home, "ready");
	const modulePath = fileURLToPath(new URL("../src/lock.ts", import.meta.url));
	const childScript = `
		import * as fs from "node:fs";
		import { withFileLock } from ${JSON.stringify(modulePath)};
		const target = process.argv[1], ready = process.argv[2];
		withFileLock(target, () => {
			fs.writeFileSync(ready, "ready");
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
		});
	`;
	const child = spawn(process.execPath, ["--input-type=module", "-e", childScript, target, ready],
		{ stdio: "ignore" });
	try {
		assert.equal(waitFor(() => fs.existsSync(ready), 2_000), true);
		const started = Date.now();
		assert.throws(() => withFileLock(target, () => undefined, { timeoutMs: 120 }), (error: unknown) =>
			error instanceof Error && (error as NodeJS.ErrnoException).code === "ELOCKTIMEOUT");
		assert.ok(Date.now() - started >= 100);
	} finally {
		waitFor(() => !fs.existsSync(`${target}.lock`), 2_000);
		stop(child);
	}
});
