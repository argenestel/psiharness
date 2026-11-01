import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareRows, pythonAvailable, verifyAllKeys, verifyKeys } from "../keys.ts";

const python = pythonAvailable();

test("every bundled answer key grades as labelled by the pack's own checker", { skip: python ? false : "python3 unavailable" }, () => {
	const files = verifyAllKeys();
	assert.ok(files.length >= 4);
	for (const file of files) {
		assert.deepEqual(file.missing, [], `${file.slug} has challenges without keys`);
		assert.deepEqual(file.unknown, [], `${file.slug} has keys without challenges`);
		const bad = file.checks.filter((check) => !check.ok);
		assert.deepEqual(bad, [], `${file.slug}: ${JSON.stringify(bad)}`);
		for (const check of file.checks) {
			if (check.method === "skip") assert.ok(check.marked, `${file.slug}/${check.challengeId} skipped without a skip marker`);
			else {
				assert.equal(check.correct, "success", `${file.slug}/${check.challengeId} correct`);
				assert.notEqual(check.wrong, "success", `${file.slug}/${check.challengeId} wrong`);
			}
		}
	}
});

test("verifier flags wrong keys that pass, unmarked rubric keys, and needless skip markers", { skip: python ? false : "python3 unavailable" }, (t) => {
	const pack = mkdtempSync(join(tmpdir(), "psi-eval-keys-test-"));
	t.after(() => rmSync(pack, { recursive: true, force: true }));
	mkdirSync(pack, { recursive: true });
	writeFileSync(join(pack, "plan.json"), JSON.stringify({ skill: "demo" }));
	writeFileSync(join(pack, "challenges.json"), JSON.stringify([
		{ id: "n", kind: "quickfire", format: "number", expected: "4", prompt: "2+2" },
		{ id: "r", kind: "explain", prompt: "Explain", rubric: "..." },
		{ id: "m", kind: "quickfire", format: "choice", expected: "Yes", choices: ["No", "Yes"], prompt: "?" },
		{ id: "py", kind: "apply", format: "code", language: "python", prompt: "f", tests: "assert f(2) == 4" },
		{ id: "sql", kind: "apply", format: "code", language: "sql", prompt: "q", setup: "CREATE TABLE t(x); INSERT INTO t VALUES (1),(2);",
			expected: "[[2],[1]]", tests: "-- ordered" },
	]));
	const result = verifyKeys(pack, {
		n: { correct: "4", wrong: "4.0" },
		r: { correct: "because", wrong: "no" },
		m: { correct: "b", wrong: "No", skip: "not needed" },
		py: { correct: "def f(x):\n\treturn x * 2", wrong: "def f(x):\n\treturn x + 1" },
		sql: { correct: "SELECT x FROM t ORDER BY x DESC;", wrong: "SELECT x FROM t ORDER BY x;" },
	});
	const byId = Object.fromEntries(result.checks.map((check) => [check.challengeId, check]));
	assert.equal(byId.n.ok, false);
	assert.match(byId.n.reason ?? "", /wrong key grades success/);
	assert.equal(byId.r.ok, false);
	assert.match(byId.r.reason ?? "", /not marked "skip"/);
	assert.equal(byId.m.ok, false);
	assert.match(byId.m.reason ?? "", /grades it deterministically/);
	assert.deepEqual([byId.py.method, byId.py.correct, byId.py.wrong, byId.py.ok], ["python-tests", "success", "fail", true]);
	assert.deepEqual([byId.sql.method, byId.sql.correct, byId.sql.wrong, byId.sql.ok], ["sql-rows", "success", "fail", true]);
});

test("compareRows mirrors the browser runner: unordered by default, ordered on request", () => {
	assert.equal(compareRows([[1], [2]], [[2], [1]]), true);
	assert.equal(compareRows([[1], [2]], [[2], [1]], true), false);
	assert.equal(compareRows([[1]], [[1], [1]]), false);
});
