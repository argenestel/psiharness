import test from "node:test";
import assert from "node:assert/strict";
import { scoreScenario } from "../score.ts";

type RecordData = Record<string, unknown>;
const pack = {
	challenges: [{ id: "c1", subskillId: "greet", prompt: "Greet the guest.", expected: "Buenos días" }],
	sources: [{ id: "s1" }, { id: "s2" }],
	plan: { subskills: [{ id: "greet" }] },
};
const explanation = "A polite morning greeting helps the customer begin a friendly conversation with the server.";
const options = [{ label: "Siguiente", message: "Continue" }, { label: "Hint", message: "I'm stuck" }];

function row(turn: number | null, record: RecordData, at = 100, attempt = 1): RecordData {
	return { turn, attempt, at, record };
}

function sent(turn: number, kind: string): RecordData {
	return row(turn, { type: "harness_turn_sent", kind, message: "Script text", sentAt: 100 });
}

function text(turn: number, content: string): RecordData {
	return row(turn, { type: "message_end", message: {
		role: "assistant", content: [{ type: "text", text: content }], stopReason: "stop",
	} }, 120);
}

let id = 0;
function tool(turn: number, name: string, args: RecordData = {}): RecordData {
	return row(turn, { type: "tool_execution_start", toolCallId: `call-${++id}`, toolName: name, args }, 130);
}

function settled(turn: number): RecordData {
	return row(turn, { type: "harness_turn_settled", status: "settled", settledAt: 150, aborted: false }, 150);
}

function score(events: RecordData[]) { return scoreScenario(events, pack); }

test("metadata and startup records never create learner turns", () => {
	const result = score([
		row(null, { type: "harness_meta", scenarioId: "demo" }),
		row(null, { type: "extension_ui_request", method: "setStatus" }),
		sent(1, "teach"), text(1, explanation + " [1]"),
		tool(1, "psi_next_steps", { options }), settled(1), row(null, { type: "harness_exit", code: 0 }),
	]);
	assert.equal(result.health.turns, 1);
	assert.equal(result.checks.settled.passed, 1);
});

test("kind determines continuation and empty continuation cannot pass", () => {
	const empty = score([sent(1, "continue"), settled(1)]);
	assert.equal(empty.checks.continueTeaching.failures.length, 1);
	const question = score([sent(1, "show"), text(1, "What should we do?"), settled(1)]);
	assert.equal(question.checks.continueTeaching.failures.length, 1);
});

test("continuation orders teaching and questions inside the same assistant block", () => {
	const pass = score([sent(1, "continue"), text(1, explanation + " What do you predict?"), settled(1)]);
	assert.equal(pass.checks.continueTeaching.passed, 1);
	const fail = score([sent(1, "continue"), text(1, "What do you predict? " + explanation), settled(1)]);
	assert.equal(fail.checks.continueTeaching.failures.length, 1);
	const challenge = score([
		sent(1, "show"), tool(1, "psi_challenge", { id: "c1" }), text(1, explanation), settled(1),
	]);
	assert.equal(challenge.checks.continueTeaching.failures.length, 1);
});

test("citation validity is turn-wide and every numbered marker must be in range", () => {
	const pass = score([sent(1, "teach"), text(1, explanation + " See [1]."), settled(1)]);
	assert.equal(pass.checks.citations.passed, 1);
	const fail = score([sent(1, "stuck"), text(1, explanation + " [1] [99]"), settled(1)]);
	assert.equal(fail.checks.citations.failures.length, 1);
	const skipped = score([sent(1, "wrong_guess"), text(1, explanation), settled(1)]);
	assert.equal(skipped.checks.citations.applicable, 0);
});

test("spoilers are checked on state-only turns and buttons after grading", () => {
	const previous = [sent(1, "teach"), settled(1), row(1, { type: "harness_state", challengeId: "c1" })];
	const stateOnly = score([
		...previous, sent(2, "stuck"), text(2, "The answer is Buenos días."), settled(2),
	]);
	assert.equal(stateOnly.checks.spoilers.failures.length, 1);
	const buttons = score([
		...previous, sent(2, "correct_answer"), tool(2, "psi_attempt", { id: "c1" }),
		tool(2, "psi_next_steps", { options: [
			{ label: "Continue", message: "Continue" }, { label: "Buenos días", message: "Use that greeting" },
		] }), settled(2),
	]);
	assert.equal(buttons.checks.spoilers.failures.length, 1);
});

test("repair follows the scripted wrong_guess kind even without a recorded grade", () => {
	const result = score([
		sent(1, "wrong_guess"), text(1, "Let's examine that."), settled(1),
		sent(2, "stuck"), tool(2, "psi_challenge", { id: "c1" }), settled(2),
	]);
	assert.equal(result.checks.wrongGuessTeaching.failures.length, 1);
});

test("attempt id falls back to the previous open challenge across turns", () => {
	const result = score([
		sent(1, "teach"), settled(1), row(1, { type: "harness_state", challengeId: "c1" }),
		sent(2, "wrong_guess"), tool(2, "psi_attempt"), settled(2),
		row(2, { type: "harness_state", challengeId: "c1" }),
		sent(3, "correct_answer"), tool(3, "psi_attempt"), settled(3),
	]);
	assert.equal(result.checks.attemptOnce.failures.length, 1);
});

test("latency uses the first thinking or tool-call delta and sentAt", () => {
	const result = score([
		sent(1, "teach"),
		row(1, { type: "message_update", assistantMessageEvent: { type: "toolcall_start" } }, 105),
		row(1, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hi" } }, 120),
		row(1, { type: "agent_settled", aborted: false }, 150), settled(1),
	]);
	assert.equal(result.latency.ttft.medianMs, 5);
	assert.equal(result.latency.settle.medianMs, 50);
});
