import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evalAgentArgs, evalAgentEnv, loadScenario, runScenario } from "../runner.ts";
import { fakePi } from "./fake-pi.ts";

function writeJson(file: string, value: unknown): void {
	writeFileSync(file, JSON.stringify(value, null, "\t") + "\n");
}

test("eval runner imports a fresh pack, preserves wrapped records, cancels dialogs, and retries model/child failures", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "psi-eval-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const pack = join(root, "pack"), scenarios = join(root, "scenarios"), out = join(root, "out");
	mkdirSync(pack, { recursive: true }); mkdirSync(scenarios, { recursive: true }); mkdirSync(out, { recursive: true });
	writeJson(join(pack, "plan.json"), { skill: "demo", title: "Demo" });
	writeJson(join(pack, "challenges.json"), [{ id: "c1", kind: "quickfire", level: 1, prompt: "What?", hints: [] }]);
	const scenarioFile = join(scenarios, "demo.json");
	writeJson(scenarioFile, { id: "demo", title: "Runner demo", skillPack: pack, expectations: { subskills: ["demo"], notes: "smoke" }, keys: { challenges: { c1: { correct: "42", wrong: "41" } } }, turns: [
		{ kind: "other", message: "open" },
		{ kind: "correct_answer" },
		{ kind: "wrong_guess" },
		{ kind: "other", message: "ui" },
		{ kind: "other", message: "model-error" },
		{ kind: "other", message: "handled" },
		{ kind: "other", message: "exit-once" },
	] });
	const fake = fakePi(root);
	const loaded = loadScenario(scenarioFile);
	const args = evalAgentArgs("demo", "test/model");
	assert.ok(args.includes("--no-session"));
	assert.ok(!args.includes("--session"));
	assert.equal(args[args.indexOf("--psi-skill") + 1], "demo");
	const env = evalAgentEnv(join(root, "home"), false, { PSI_CODE_EXEC: "1", XAI_API_KEY: "token" });
	assert.equal(env.PSI_CODE_EXEC, undefined);
	assert.equal(env.XAI_API_KEY, "token");
	const result = await runScenario(loaded, { model: "test/model", outDir: out, pi: fake, handledWaitMs: 100, timeoutMs: 2_000, keep: true });
	const fakeLog = result.psiHome ? readFileSync(join(result.psiHome, "fake-rpc.jsonl"), "utf8") : "";
	if (!result.success && result.completedTurns === 0 && !fakeLog.includes('"direction":"in"')) {
		t.skip("nested subprocesses are unavailable in this sandbox");
		return;
	}
	assert.equal(result.success, false, JSON.stringify(result));
	assert.equal(result.completedTurns, 6);
	const lines = readFileSync(result.path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(lines[0].record.type, "harness_meta");
	assert.match(lines[0].record.skillPack, /pack$/);
	const sent = lines.filter((line) => line.record.type === "harness_turn_sent");
	assert.deepEqual(sent.filter((line) => line.record.turn === 2)[0].record.message, "42");
	assert.deepEqual(sent.filter((line) => line.record.turn === 3)[0].record.message, "41");
	assert.equal(sent.filter((line) => line.record.turn === 5).length, 2);
	assert.equal(sent.filter((line) => line.record.turn === 7).length, 2);
	assert.equal(sent.filter((line) => line.record.turn === 5)[0].record.message, sent.filter((line) => line.record.turn === 5)[1].record.message);
	assert.equal(lines.filter((line) => line.record.type === "harness_ui_auto_cancel" && line.record.id === "dialog-1").length, 1);
	assert.ok(lines.some((line) => line.record.type === "harness_retry_end" && line.record.success === false && line.record.reason === "model_error"));
	assert.ok(lines.some((line) => line.record.type === "harness_exit"));
	assert.ok(lines.some((line) => line.record.type === "harness_state" && line.record.skill === "demo" && line.record.challengeId === "c1"));
	assert.ok(lines.filter((line) => line.record.type === "harness_message").every((line) => typeof line.record.message === "string"));
});

