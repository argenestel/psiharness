import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChallengeTracker, evalAgentArgs, evalAgentEnv, loadScenario, parseEvalArgs, runFileStem, runScenario } from "../runner.ts";
import { main, pool } from "../run.ts";
import { scoreDirectory } from "../score.ts";
import { fakePi } from "./fake-pi.ts";

function writeJson(file: string, value: unknown): void {
	writeFileSync(file, JSON.stringify(value, null, "\t") + "\n");
}

function fixture(root: string, turns: unknown[]): string {
	const pack = join(root, "pack"), scenarios = join(root, "scenarios");
	mkdirSync(pack, { recursive: true }); mkdirSync(scenarios, { recursive: true });
	writeJson(join(pack, "plan.json"), { skill: "demo", title: "Demo" });
	writeJson(join(pack, "challenges.json"), [
		{ id: "c1", kind: "quickfire", level: 1, prompt: "What?", hints: [] },
		{ id: "c2", kind: "quickfire", level: 1, prompt: "2+2?", format: "number", expected: "4", hints: [] },
	]);
	const scenarioFile = join(scenarios, "demo.json");
	writeJson(scenarioFile, { id: "demo", title: "Runner demo", skillPack: pack, expectations: { subskills: ["demo"], notes: "smoke" },
		keys: { challenges: { c1: { correct: "42", wrong: "41" }, c2: { correct: "4", wrong: "5" } } }, turns });
	return scenarioFile;
}

test("eval runner imports a fresh pack, answers the open challenge dynamically, cancels dialogs, and retries failures", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "psi-eval-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const out = join(root, "out");
	mkdirSync(out, { recursive: true });
	const scenarioFile = fixture(root, [
		{ kind: "other", message: "open" },
		{ kind: "correct_answer" },
		{ kind: "challenge", message: "present" },
		{ kind: "wrong_guess" },
		{ kind: "wrong_guess", message: "scripted guess" },
		{ kind: "other", message: "ui" },
		{ kind: "other", message: "model-error" },
		{ kind: "other", message: "handled" },
		{ kind: "other", message: "exit-once" },
		{ kind: "other", message: "guard" },
	]);
	const fake = fakePi(root);
	const loaded = loadScenario(scenarioFile);
	const args = evalAgentArgs("demo", "test/model");
	assert.ok(args.includes("--no-session"));
	assert.ok(!args.includes("--session"));
	assert.equal(args[args.indexOf("--psi-skill") + 1], "demo");
	const env = evalAgentEnv(join(root, "home"), false, { PSI_CODE_EXEC: "1", XAI_API_KEY: "token" });
	assert.equal(env.PSI_CODE_EXEC, undefined);
	assert.equal(env.XAI_API_KEY, "token");
	const result = await runScenario(loaded, { model: "test/model", outDir: out, pi: fake, handledWaitMs: 100, timeoutMs: 2_000, keep: true, warn: () => {} });
	const fakeLog = result.psiHome ? readFileSync(join(result.psiHome, "fake-rpc.jsonl"), "utf8") : "";
	if (!result.success && result.completedTurns === 0 && !fakeLog.includes('"direction":"in"')) {
		t.skip("nested subprocesses are unavailable in this sandbox");
		return;
	}
	assert.equal(result.success, false, JSON.stringify(result));
	assert.equal(result.completedTurns, 9);
	assert.deepEqual(result.answers, { dynamic: 2, fallback: 1 });
	const lines = readFileSync(result.path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(lines[0].record.type, "harness_meta");
	assert.match(lines[0].record.skillPack, /pack$/);
	const sent = lines.filter((line) => line.record.type === "harness_turn_sent");
	const message = (turn: number) => sent.filter((line) => line.record.turn === turn)[0].record.message;
	// Turn 2: state.json names c1. Turn 4: the psi_challenge widget (c2) is newest. Turn 5: both were attempted.
	assert.equal(message(2), "42");
	assert.equal(message(4), "5");
	assert.equal(message(5), "scripted guess");
	const answers = lines.filter((line) => line.record.type === "harness_answer").map((line) => line.record);
	assert.deepEqual(answers.map((record) => [record.turn, record.mode, record.challengeId ?? null, record.openFrom ?? null]),
		[[2, "dynamic", "c1", "state"], [4, "dynamic", "c2", "widget"], [5, "fallback", null, null]]);
	assert.equal(sent.filter((line) => line.record.turn === 7).length, 2);
	assert.equal(sent.filter((line) => line.record.turn === 9).length, 2);
	assert.equal(message(7), sent.filter((line) => line.record.turn === 7)[1].record.message);
	assert.equal(lines.filter((line) => line.record.type === "harness_ui_auto_cancel" && line.record.id === "dialog-1").length, 1);
	assert.ok(lines.some((line) => line.record.type === "harness_retry_end" && line.record.success === false && line.record.reason === "model_error"));
	assert.ok(lines.some((line) => line.record.type === "harness_exit"));
	assert.ok(lines.some((line) => line.record.type === "harness_state" && line.record.skill === "demo" && line.record.challengeId === "c1"));
	assert.ok(lines.filter((line) => line.record.type === "harness_message").every((line) => typeof line.record.message === "string"));
	const report = scoreDirectory(out);
	assert.equal(report.guard.count, 1);
	assert.equal(report.scenarios[0].answers.dynamic, 2);
});

test("ChallengeTracker prefers the newest unattempted widget and falls back to state", () => {
	const tracker = new ChallengeTracker();
	assert.equal(tracker.open({}), undefined);
	assert.deepEqual(tracker.open({ challengeId: "s1", activeSkill: "demo" }), { id: "s1", source: "state", skill: "demo" });
	tracker.observe({ type: "tool_execution_end", toolName: "psi_challenge", isError: true, result: { details: { widget: { type: "challenge", id: "bad" } } } });
	tracker.observe({ type: "tool_execution_end", toolName: "psi_challenge", result: { details: { widget: { type: "challenge", id: "w1", format: "choice" } } } });
	assert.equal(tracker.open({ challengeId: "s1" })?.id, "w1");
	assert.equal(tracker.open({ challengeId: "s1" })?.format, "choice");
	tracker.observe({ type: "tool_execution_start", toolCallId: "a", toolName: "psi_attempt", args: { challengeId: "w1" } });
	tracker.observe({ type: "tool_execution_end", toolCallId: "a", toolName: "psi_attempt", result: { details: { outcome: "fail" } } });
	assert.equal(tracker.open({ challengeId: "w1" }), undefined);
	assert.equal(tracker.open({ challengeId: "s1" })?.id, "s1");
});

test("CLI options parse --concurrency and --repeat and reject bad values", () => {
	const parsed = parseEvalArgs(["--concurrency", "3", "--repeat=2", "--out", "/tmp/x"]);
	assert.equal(parsed.concurrency, 3);
	assert.equal(parsed.repeat, 2);
	assert.equal(parseEvalArgs([]).concurrency, 1);
	assert.equal(parseEvalArgs([]).repeat, 1);
	assert.throws(() => parseEvalArgs(["--concurrency", "0"]), /integer/);
	assert.throws(() => parseEvalArgs(["--repeat", "x"]), /integer/);
	assert.equal(runFileStem("a b", 1, 1), "a-b");
	assert.equal(runFileStem("a", 2, 3), "a.r2");
});

test("pool runs at most N jobs at once and keeps order", async () => {
	let active = 0, peak = 0;
	const results = await pool([5, 1, 3, 2, 4], 2, async (value) => {
		active++; peak = Math.max(peak, active);
		await new Promise((done) => setTimeout(done, value * 3));
		active--;
		return value * 10;
	});
	assert.deepEqual(results, [50, 10, 30, 20, 40]);
	assert.equal(peak, 2);
});

test("parallel repeated runs write separate traces and per-scenario summaries that score.ts merges", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "psi-eval-par-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const scenarioFile = fixture(root, [{ kind: "other", message: "open" }, { kind: "correct_answer" }]);
	const out = join(root, "out");
	const previous = process.env.PSI_EVAL_PI;
	process.env.PSI_EVAL_PI = fakePi(root);
	const log = console.log;
	console.log = () => {};
	let code: number;
	try { code = await main(["--scenario", scenarioFile, "--repeat", "2", "--concurrency", "2", "--out", out, "--model", "test/model"]); }
	finally {
		console.log = log;
		if (previous === undefined) delete process.env.PSI_EVAL_PI; else process.env.PSI_EVAL_PI = previous;
	}
	if (code !== 0 && !existsSync(join(out, "demo.r1.jsonl"))) { t.skip("nested subprocesses are unavailable in this sandbox"); return; }
	assert.equal(code, 0);
	for (const name of ["demo.r1.jsonl", "demo.r2.jsonl", "demo.r1.summary.json", "demo.r2.summary.json"]) assert.ok(existsSync(join(out, name)), name);
	assert.ok(!existsSync(join(out, "summary.json")));
	const report = scoreDirectory(out);
	assert.deepEqual(report.runs.map((run) => [run.id, run.repeat, run.success, run.answers?.dynamic]), [["demo", 1, true, 1], ["demo", 2, true, 1]]);
	assert.deepEqual(report.scenarios.map((scenario) => [scenario.scenarioId, scenario.repeat]), [["demo", 1], ["demo", 2]]);
	assert.equal(report.variance?.repeats, 2);
});
