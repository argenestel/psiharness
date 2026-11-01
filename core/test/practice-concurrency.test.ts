import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { PracticeStore } from "../src/practice.ts";

test("concurrent processes preserve all attempts and progress", { timeout: 55_000 }, async (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-concurrency-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const store = new PracticeStore(home);
	const challenge = store.addChallenge({ skill: "shared", kind: "predict", level: 1,
		prompt: "Answer", expected: "yes" });
	const moduleUrl = new URL("../src/practice.ts", import.meta.url).href;
	const code = `import { PracticeStore } from ${JSON.stringify(moduleUrl)};
		const store = new PracticeStore(${JSON.stringify(home)});
		for (let i = 0; i < 25; i++) store.recordAttempt({
			skill: "shared", challengeId: ${JSON.stringify(challenge.id)},
			answer: "yes", outcome: "success", hintsUsed: 0
		});`;
	await Promise.all(Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", reject);
		child.on("exit", (status) => status === 0 ? resolve() : reject(new Error(stderr)));
	})));
	const rows = fs.readFileSync(path.join(home, "skills/shared/attempts.jsonl"), "utf8")
		.trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(rows.length, 100);
	assert.equal(store.progress("shared").attempts, 100);
	assert.equal(new Set(rows.map((row) => row.id)).size, 100);
});
