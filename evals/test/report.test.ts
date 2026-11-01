import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { aggregateScores, factualSentences, isMetaSentence, readRunSummaries, renderReport, scoreScenario, spoilerMatcher } from "../score.ts";

type Row = Record<string, unknown>;
const pack = {
	sources: [{ id: "s1", url: "https://docs.python.org/3/tutorial/" }, { id: "s2", url: "https://example.org/a" }],
	challenges: [
		{ id: "num", subskillId: "s", prompt: "Compute the slope.", format: "number", expected: "3" },
		{ id: "pick", subskillId: "s", prompt: "Which one?", format: "choice", expected: "Yes", choices: ["No", "Yes", "Maybe"] },
		{ id: "py", subskillId: "s", prompt: "Write f.", format: "code", language: "python", tests: "assert f()" },
		{ id: "word", subskillId: "s", prompt: "Greet.", expected: "Buenos días" },
	],
};
const long = "Python's str.split with no argument splits on runs of whitespace and drops empty strings at both ends.";
let seq = 0;

function row(turn: number | null, record: Row, attempt = 1): Row { return { turn, attempt, at: 100 + seq++, record }; }
function sent(turn: number, kind: string): Row { return row(turn, { type: "harness_turn_sent", kind, sentAt: 100 }); }
function text(turn: number, content: string): Row {
	return row(turn, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: content }] } });
}
function tool(turn: number, toolName: string, args: Row = {}, result: Row = {}): Row[] {
	const id = `t${seq++}`;
	return [row(turn, { type: "tool_execution_start", toolCallId: id, toolName, args }),
		row(turn, { type: "tool_execution_end", toolCallId: id, toolName, args, result, isError: false })];
}
function settled(turn: number): Row { return row(turn, { type: "agent_settled" }); }
function challenge(turn: number, id: string): Row[] {
	return tool(turn, "psi_challenge", { action: "next" }, { details: { challengeId: id, widget: { type: "challenge", id } } });
}

test("meta and instructional sentences are not factual teaching", () => {
	for (const sentence of [
		"Don’t peek; use the habit: after each operator, name the **value** and **type**, and try zero.",
		"The challenge is still open — that’s the practice for this subskill and it is waiting for you now.",
		"Try this one on your own first, then compare it with the worked example that comes next.",
		"Your turn: write the query that keeps unmatched customers and counts their orders correctly.",
		"Next we can swap the drink, or go back and lock the buenas/buenos mix-up you made earlier.",
		"That line is already in as your answer — I won’t re-grade it, but here is what it shows.",
	]) assert.ok(isMetaSentence(sentence), sentence);
	assert.ok(!isMetaSentence(long));
	for (const verdict of ["That’s the right picture: inner call first, then feed that result in again.",
		"We’re still on syntax and types (names, / vs //, truth values) before functions.",
		"**Continue** keeps us on the opening; the order line can wait until that set is stable.",
		"We still owe Buenos días a clean retry when you want to return to greetings."]) {
		assert.ok(isMetaSentence(verdict), verdict);
	}
	assert.deepEqual(factualSentences("| **Podría** | finite verb that agrees with usted (poder, conditional) |"), []);
	assert.ok(!isMetaSentence("Type hints document intent but Python does not enforce them at runtime for ordinary calls."));
	assert.deepEqual(factualSentences(`Don't peek at the answer below until you have tried the problem yourself.\n${long}\nWhat do you predict happens with tabs here?`), [long]);
});

test("citations list valid and invalid markers and accept sources added this session", () => {
	const missing = scoreScenario([sent(1, "teach"), text(1, long), settled(1)], pack);
	assert.match(missing.checks.citations.failures[0].message, /no citation markers; valid range \[1\.\.2\]/);
	const mixed = scoreScenario([sent(1, "teach"), text(1, `${long} [1] [3]`), settled(1)], pack);
	assert.match(mixed.checks.citations.failures[0].message, /invalid markers \[3\] outside \[1\.\.2\]; valid markers \[1\]/);
	assert.deepEqual((mixed.checks.citations.failures[0].evidence as Row).invalidMarkers, [3]);
	const added = scoreScenario([
		sent(1, "teach"), ...tool(1, "psi_sources", { action: "add", url: "https://new.example/page" }),
		...tool(1, "psi_sources", { action: "add", url: "https://www.docs.python.org/3/tutorial/" }),
		text(1, `${long} [3]`), settled(1),
	], pack);
	assert.equal(added.checks.citations.passed, 1);
	const metaOnly = scoreScenario([sent(1, "teach"), text(1, "Don’t peek at the solution yet; try the challenge card on your own first, please."), settled(1)], pack);
	assert.equal(metaOnly.checks.citations.applicable, 0);
});

test("spoiler matcher: whole numeric tokens, choice labels, and explicit N/A", () => {
	const num = spoilerMatcher({ expected: "3", format: "number" });
	assert.ok(!("skip" in num));
	if ("skip" in num) return;
	assert.ok(num.test("The slope is 3 here.", ""));
	assert.ok(!num.test("Between 30 and 13 at x=3, see [3].", ""));
	assert.ok(num.test("", "Answer: 3.0"));
	const choice = spoilerMatcher({ expected: "Yes", format: "choice", choices: ["No", "Yes", "Maybe"] });
	if ("skip" in choice) throw new Error("choice should be matchable");
	assert.ok(choice.test("The answer is B.", ""));
	assert.ok(choice.test("Go with (B).", ""));
	assert.ok(!choice.test("(A) no, (B) yes, (C) maybe — pick one.", ""));
	assert.ok(!choice.test("The answer is a list of options.", ""));
	assert.deepEqual(spoilerMatcher({ format: "code", language: "python" }), { skip: "python challenge without an expected value (graded by tests)" });
	assert.ok("skip" in spoilerMatcher({ expected: "soy" }));
});

test("spoilers: numeric leak fails, python without expected is explicit N/A, answer-turn echo is not a spoiler", () => {
	const leak = scoreScenario([sent(1, "challenge"), ...challenge(1, "num"), text(1, "Hint: the slope is 3."), settled(1)], pack);
	assert.equal(leak.checks.spoilers.failures.length, 1);
	assert.match(leak.checks.spoilers.failures[0].message, /numeric match/);
	const python = scoreScenario([sent(1, "challenge"), ...challenge(1, "py"), settled(1)], pack);
	assert.equal(python.checks.spoilers.applicable, 0);
	assert.equal(python.checks.spoilers.notApplicable?.[0].challengeId, "py");
	const echo = scoreScenario([
		sent(1, "challenge"), ...challenge(1, "word"), settled(1),
		sent(2, "correct_answer"), text(2, "You wrote Buenos días — grading it now."),
		...tool(2, "psi_attempt", { challengeId: "word", answer: "Buenos días", outcome: "success" }), settled(2),
	], pack);
	assert.equal(echo.checks.spoilers.failures.length, 0);
	assert.equal(echo.checks.spoilers.passed, 1);
});

test("guard interventions are counted per turn, including between turns", () => {
	const guard = (turn: number | null) => row(turn, { type: "entry_appended", entry: { type: "custom", customType: "psi-guard", data: {} } });
	const result = scoreScenario([sent(1, "teach"), guard(1), guard(1), settled(1), guard(null),
		row(1, { type: "entry_appended", entry: { type: "custom", customType: "psi-practice" } })], pack);
	assert.equal(result.guard.count, 3);
	assert.deepEqual(result.guard.byTurn, { "1": 2, "between turns": 1 });
	assert.match(renderReport(result), /Guard interventions \(psi-guard entries\): 3/);
});

test("report keeps the scenario table contiguous, names scenarios in failures, and labels event seq", () => {
	const meta = (id: string, repeat: number) => row(null, { type: "harness_meta", scenarioId: id, repeat, model: "m" });
	const a1 = scoreScenario({ scenario: "a.r1", events: [meta("a", 1), sent(1, "continue"), text(1, "What next?"), settled(1)] }, pack);
	const a2 = scoreScenario({ scenario: "a.r2", events: [meta("a", 2), sent(1, "continue"), text(1, `${long} [1]`),
		...tool(1, "psi_next_steps", { options: [{ label: "Continue", message: "c" }, { label: "Stop", message: "s" }] }), settled(1)] }, pack);
	assert.equal(a1.scenarioId, "a");
	assert.equal(a2.repeat, 2);
	const report = aggregateScores([a1, a2]);
	assert.equal(report.variance?.repeats, 2);
	assert.equal(report.variance?.checks.continueTeaching.min, 0);
	assert.equal(report.variance?.checks.continueTeaching.max, 1);
	const markdown = renderReport(report);
	const lines = markdown.split("\n");
	const header = lines.findIndex((line) => line.startsWith("| Scenario | Score"));
	assert.ok(lines[header + 2].startsWith("| a.r1 ") && lines[header + 3].startsWith("| a.r2 "), "scenario rows are adjacent");
	assert.ok(lines.indexOf("## Scenario details") > header + 3);
	assert.match(markdown, /- \*\*continueTeaching\*\* \[a\.r1\] \(turn 1\)/);
	assert.match(markdown, /"event seq":\d+/);
	assert.doesNotMatch(markdown, /questionPos/);
	assert.match(markdown, /Mean across repeats/);
	assert.match(markdown, /range 0\.0%–100\.0%/);
});

test("per-scenario summaries merge, overriding a legacy summary.json entry for the same run", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "psi-eval-summaries-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeFileSync(join(dir, "summary.json"), JSON.stringify({ scenarios: [
		{ id: "a", success: false, turns: 2, completedTurns: 1, toolCalls: 1, durationMs: 1, errors: ["x"] },
		{ id: "b", success: true, turns: 2, completedTurns: 2, toolCalls: 3, durationMs: 2, errors: [] },
	] }));
	writeFileSync(join(dir, "a.summary.json"), JSON.stringify({ id: "a", repeat: 1, success: true, turns: 2, completedTurns: 2, toolCalls: 4,
		durationMs: 5, errors: [], answers: { dynamic: 1, fallback: 0 } }));
	const runs = readRunSummaries(dir);
	assert.deepEqual(runs.map((run) => [run.id, run.success, run.file, run.answers?.dynamic ?? null]),
		[["a", true, "a.summary.json", 1], ["b", true, "summary.json", null]]);
});
