import test from "node:test";
import assert from "node:assert/strict";
import { aggregateScores, renderReport, scoreScenario } from "../score.ts";

type Row = Record<string, unknown>;
let seq = 0;
function row(turn: number | null, record: Row, attempt = 1): Row {
	return { turn, attempt, at: 100 + seq++, record };
}
function text(turn: number, value = "a".repeat(200)): Row {
	return row(turn, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: value }] } });
}
function tool(turn: number, toolName: string, args: Row = {}, result: Row = {}, isError = false): Row[] {
	const toolCallId = `call-${seq++}`;
	return [row(turn, { type: "tool_execution_start", toolCallId, toolName, args }),
		row(turn, { type: "tool_execution_end", toolCallId, toolName, args, result, isError })];
}
function rep(turn: number, args: Row = { action: "next" }): Row[] {
	return tool(turn, "psi_challenge", args, { details: { challengeId: `rep-${seq}` } });
}

test("density counts warm-up reviews, variants, and recorded grades, once per tool call", () => {
	const result = scoreScenario([
		row(10, { type: "harness_turn_sent", kind: "teach" }), text(10),
		row(20, { type: "harness_turn_sent", kind: "challenge" }), ...rep(20, { action: "review" }),
		text(30), ...rep(30, { action: "create", variantOf: "original" }),
		...tool(30, "psi_attempt", {}, { details: { recorded: true } }),
		text(40), ...tool(40, "psi_attempt", {}, { details: { outcome: "fail" } }),
	]);
	assert.deepEqual(result.practice.metrics, { turnsToFirstRep: 2, repsPerTeachingTurn: 2 / 3,
		maxTeachStreak: 1, gradedAttempts: 2, teachingTurns: 3, presentedChallenges: 2 });
	assert.equal(result.practice.checks["practice-cadence"].ratio, 1);
});

test("no reps is null; errors, args-only IDs, missing results, and recorded:false do not count", () => {
	const result = scoreScenario([
		text(1), ...tool(1, "psi_challenge", {}, { details: { challengeId: "bad" } }, true),
		text(2), ...tool(2, "psi_challenge", { challengeId: "args-only" }),
		...tool(2, "psi_attempt", {}, { details: { recorded: false } }),
		text(3), ...tool(3, "psi_challenge", {}, { details: { errors: ["blocked"], challengeId: "blocked" } }),
		...tool(3, "psi_attempt", {}, { details: { recorded: true } }, true),
		text(4), ...tool(4, "psi_attempt", {}, { errors: ["rejected"] }),
		row(4, { type: "tool_execution_start", toolName: "psi_attempt", toolCallId: "unfinished" }),
	]);
	assert.deepEqual(result.practice.metrics, { turnsToFirstRep: null, repsPerTeachingTurn: 0,
		maxTeachStreak: 4, gradedAttempts: 0, teachingTurns: 4, presentedChallenges: 0 });
	const cadence = result.practice.checks["practice-cadence"];
	assert.equal(cadence.ratio, 0);
	assert.match(cadence.failures[0].message, /4 exceeds 3/);
	assert.match(result.practice.modeDetection, /not detectable/);
});

test("prose threshold is 200; lesson show/write must succeed; psi_run counts as a teaching turn", () => {
	const result = scoreScenario([
		text(1, "a".repeat(199)), text(2, "a".repeat(200)),
		text(3, `\`\`\`js\n${"a".repeat(300)}\n\`\`\``),
		...tool(4, "psi_lesson", { action: "show" }), ...tool(4, "psi_run"), text(4),
		...tool(5, "psi_lesson", { action: "write" }),
		...tool(6, "psi_lesson", { action: "show" }, {}, true),
		...tool(7, "psi_lesson", { action: "list" }),
		row(8, { type: "tool_execution_start", toolName: "psi_lesson", args: { action: "show" } }),
		...tool(9, "psi_run", {}, {}, true),
	]);
	assert.equal(result.practice.metrics.teachingTurns, 4);
	assert.equal(result.practice.metrics.maxTeachStreak, 4, "no practice in between: the streak spans all four");
	assert.equal(scoreScenario([]).practice.metrics.repsPerTeachingTurn, null);
});

test("streaks reset only on presented challenges and recorded attempts, like the runtime counter", () => {
	const result = scoreScenario([
		text(1), text(2), text(3), ...rep(4), text(4),
		text(5), text(6), text(7), ...tool(7, "psi_attempt"),
		text(8), text(9, "OK"), text(10), ...rep(11), text(11),
	]);
	assert.equal(result.practice.metrics.maxTeachStreak, 3);
	assert.equal(result.practice.checks["practice-cadence"].ratio, 1);
	// "teach, teach, ok" repeated never resets: ten teaching turns with no practice fail the cadence check.
	const lecture = scoreScenario(Array.from({ length: 15 }, (_, i) => text(i + 1, i % 3 === 2 ? "OK" : undefined)));
	assert.equal(lecture.practice.metrics.maxTeachStreak, 10);
	assert.equal(lecture.practice.checks["practice-cadence"].ratio, 0);
	// Turns spent waiting on an unanswered card do not count; once it is answered, teaching counts again.
	const waiting = scoreScenario([text(1), ...rep(2), text(2), text(3), text(4), text(5), text(6),
		text(7), ...tool(7, "psi_attempt", {}, { details: { recorded: true } }), text(8), text(9)]);
	assert.equal(waiting.practice.metrics.maxTeachStreak, 2);
});

test("cadence requires three teaching turns and exempts explicitly observed test mode", () => {
	assert.equal(scoreScenario([text(1), text(2)]).practice.checks["practice-cadence"].applicable, 0);
	assert.equal(scoreScenario([text(1), text(2), text(3)]).practice.checks["practice-cadence"].ratio, 1);
	for (const modeRecord of [
		row(null, { type: "harness_meta", tutorMode: "test" }),
		row(1, { type: "harness_state", state: { tutorMode: "test" } }),
	]) {
		const result = scoreScenario([modeRecord, text(1), text(2), text(3), text(4)]);
		assert.equal(result.practice.metrics.maxTeachStreak, 4);
		assert.equal(result.practice.checks["practice-cadence"].applicable, 0);
		assert.match(result.practice.modeDetection, /Explicit tutorMode observed: test/);
	}
	const practice = scoreScenario([row(null, { type: "harness_meta", tutorMode: "practice" }),
		text(1), text(2), text(3), text(4)]);
	assert.equal(practice.practice.checks["practice-cadence"].ratio, 0);
});

test("final harness retry and final assistant text win over abandoned attempts and streaming deltas", () => {
	const result = scoreScenario([
		text(1), ...rep(1),
		row(1, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "a".repeat(300) } }, 2),
		row(1, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Short" }] } }, 2),
		text(2, "a".repeat(100)), text(2, "b".repeat(100)),
	]);
	assert.equal(result.practice.metrics.turnsToFirstRep, null);
	assert.equal(result.practice.metrics.teachingTurns, 1);
});

test("aggregate pools density, averages first-rep turns, takes maximum streak, and preserves legacy totals", () => {
	const a = scoreScenario({ scenario: "a", events: [text(1), ...rep(1)] });
	const b = scoreScenario({ scenario: "b", events: [text(1), text(2), text(3), ...rep(3)] });
	const c = scoreScenario({ scenario: "c", events: [text(1), text(2), text(3), text(4)] });
	const report = aggregateScores([a, b, c]);
	assert.deepEqual(report.practice.metrics, { turnsToFirstRep: 2, repsPerTeachingTurn: 2 / 8,
		maxTeachStreak: 4, gradedAttempts: 0, teachingTurns: 8, presentedChallenges: 2 });
	assert.equal(report.practice.checks["practice-cadence"].ratio, 1 / 2);
	assert.equal(report.passed, a.passed + b.passed + c.passed);
	assert.equal(report.applicable, a.applicable + b.applicable + c.applicable);
	assert.equal(report.checks["practice-cadence"], undefined);
	assert.equal(report.failures.some((item) => item.check === "practice-cadence"), false);
	const markdown = renderReport(report);
	assert.match(markdown, /Practice \(separate from headline score\)/);
	assert.match(markdown, /\| Overall \| 2 \| 0.25 \| 4 \| 0 \| 8 \| 2 \| 1\/2 pass/);
	assert.match(markdown, /FAIL practice-cadence \[c\]/);
	assert.match(markdown, /N\/A practice-cadence \[a\]/);
	assert.deepEqual(JSON.parse(JSON.stringify(report)).practice, report.practice);
	assert.equal(aggregateScores([c]).practice.metrics.turnsToFirstRep, null);
	assert.equal(aggregateScores([]).practice.metrics.repsPerTeachingTurn, null);
});

