import test from "node:test";
import assert from "node:assert/strict";
import { countQuestions, renderReport, scoreScenario } from "../score.ts";

type AnyRecord = Record<string, unknown>;

const pack = {
	sources: [{ id: "s1", title: "Source" }],
	challenges: [{ id: "c1", subskillId: "loops", prompt: "Name the color?", expected: "blue" }],
};

function wrap(turn: number, at: number, record: AnyRecord, attempt = 0): AnyRecord {
	return { turn, attempt, at, record };
}

function sent(turn: number, at: number, kind: string, attempt = 0): AnyRecord {
	return wrap(turn, at, { type: "harness_turn_sent", kind, sentAt: at }, attempt);
}

function assistant(turn: number, at: number, text: string, attempt = 0): AnyRecord {
	return wrap(turn, at, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } }, attempt);
}

function user(turn: number, at: number, text: string, attempt = 0): AnyRecord {
	return wrap(turn, at, { type: "message_end", message: { role: "user", content: text } }, attempt);
}

function state(turn: number, at: number, attempt = 0): AnyRecord {
	return wrap(turn, at, { type: "harness_state", state: { openChallenge: { skill: "demo", id: "c1" } } }, attempt);
}

function tool(turn: number, at: number, toolName: string, args: AnyRecord, result: AnyRecord, id: string, attempt = 0): AnyRecord[] {
	return [
		wrap(turn, at, { type: "tool_execution_start", toolCallId: id, toolName, args }, attempt),
		wrap(turn, at + 1, { type: "tool_execution_end", toolCallId: id, toolName, args, result, isError: false }, attempt),
	];
}

function settled(turn: number, at: number, attempt = 0): AnyRecord[] {
	return [
		...tool(turn, at, "psi_next_steps", { options: [
			{ label: "Continue", message: "Continue" },
			{ label: "Try another", message: "Try another" },
		] }, { details: { widget: { type: "next_steps", options: [
			{ label: "Continue", message: "Continue" },
			{ label: "Try another", message: "Try another" },
		] } } }, `next-${turn}`, attempt),
		wrap(turn, at + 2, { type: "agent_settled" }, attempt),
	];
}

function goodScenario(): AnyRecord[] {
	return [
		sent(1, 0, "teach"),
		...tool(1, 2, "psi_practice_session", { action: "start" }, { active: true }, "session"),
		assistant(1, 4, "Loops repeat a block while a condition remains true, so each iteration updates state and eventually reaches a stopping condition. [1]"),
		...tool(1, 6, "psi_lesson", { action: "write", subskillId: "loops" }, { details: { subskillId: "loops" } }, "lesson"),
		...tool(1, 8, "psi_challenge", { action: "next" }, { details: { challengeId: "c1", widget: { id: "c1", prompt: "Name the color?" } } }, "challenge"),
		...settled(1, 10),
		sent(2, 20, "answer"),
		state(2, 20),
		user(2, 21, "My answer is blue."),
		...tool(2, 23, "psi_attempt", { challengeId: "c1", answer: "blue", outcome: "success" }, { details: { outcome: "success" } }, "attempt"),
		...settled(2, 25),
	];
}

test("scores the passing contract, uses last attempt, and reports latency", () => {
	const result = scoreScenario(goodScenario(), pack);
	assert.equal(result.checks.teachFirst.ratio, 1);
	assert.equal(result.checks.questionCount.ratio, 1);
	assert.equal(result.checks.settled.ratio, 1);
	assert.equal(result.checks.citations.ratio, 1);
	assert.equal(result.checks.spoilers.ratio, 1);
	assert.equal(result.checks.attemptOnce.ratio, 1);
	assert.equal(result.health.missingSettled, 0);
	assert.equal(result.latency.ttft.medianMs, 2.5);
	assert.equal(result.latency.settle.p90Ms, 12);
	assert.deepEqual(result.latency.turns.map((turn) => turn.attemptCount), [0, 1]);
	assert.ok(result.latency.turns.every((turn) => turn.toolCount > 0));
	assert.match(renderReport(result), /slowest 5/);
});

test("countQuestions excludes code, inline code, and quoted questions, then adds psi_ask", () => {
	assert.equal(countQuestions("Use `why?` and ```js\nwhat?\n```\n> quoted?\nOne real question?"), 1);
	assert.equal(countQuestions("Explain this?", 1), 2);
	assert.equal(countQuestions("| name | Austin? | price ≥ 8? |\n|---|---|---|\n| Ana | yes | yes |"), 0, "table labels");
	assert.equal(countQuestions("- Friend: **¿Cómo te llamas?**\n**¿Podrías** traer un café?\nWhat will you say?"), 1,
		"¿…? marks a Spanish example, not a question to the learner");
});

test("teach-first fails when the first challenge has no same-subskill lesson", () => {
	const events = goodScenario().filter((event) => !(event.record as AnyRecord)?.toolName || (event.record as AnyRecord).toolName !== "psi_lesson");
	const result = scoreScenario(events, pack);
	assert.equal(result.checks.teachFirst.passed, 0);
	assert.equal(result.checks.teachFirst.failures.length, 1);
});

test("question count fails for two prose questions while settled remains independent", () => {
	const events = goodScenario();
	events.splice(events.findIndex((event) => (event.record as AnyRecord)?.type === "message_end"
		&& ((event.record as AnyRecord).message as AnyRecord)?.role === "assistant"), 1,
		assistant(1, 4, "First question? Second question?"));
	const result = scoreScenario(events, pack);
	assert.equal(result.checks.questionCount.passed, 1);
	assert.equal(result.checks.questionCount.applicable, 2);
});

test("settled, continue teaching, and citation checks each expose evidence", () => {
	const events = goodScenario();
	const explanation = events.findIndex((event) => (event.record as AnyRecord)?.type === "message_end"
		&& ((event.record as AnyRecord).message as AnyRecord)?.role === "assistant");
	events.splice(explanation, 1, assistant(1, 4, "What next?"));
	const nextStart = events.findIndex((event) => (event.record as AnyRecord)?.toolName === "psi_next_steps");
	events.splice(nextStart, 4, sent(1, 10, "continue"), assistant(1, 11, "What should we do next?"));
	const result = scoreScenario(events, pack);
	assert.equal(result.checks.settled.passed, 1);
	assert.equal(result.checks.continueTeaching.passed, 0);
	assert.equal(result.checks.citations.passed, 0);
	assert.ok(result.checks.continueTeaching.failures[0].turn === "1");
});

test("spoilers catch normalized expected answers in pre-attempt text and buttons", () => {
	const events = goodScenario();
	const challengeIndex = events.findIndex((event) => (event.record as AnyRecord)?.toolName === "psi_challenge");
	events.splice(challengeIndex, 2,
		...tool(1, 8, "psi_challenge", { action: "next" }, { details: { challengeId: "c1", widget: { id: "c1" } } }, "challenge"),
		assistant(1, 9, "The answer is blue."),
	);
	const result = scoreScenario(events, pack);
	assert.equal(result.checks.spoilers.passed, 0);
});

test("attempt uniqueness fails duplicate challenge attempts in one scripted session", () => {
	const events = goodScenario();
	const insertion = events.findIndex((event) => (event.record as AnyRecord)?.type === "agent_settled"
		&& (event.turn as number) === 2);
	events.splice(insertion, 0, ...tool(2, 27, "psi_attempt", { challengeId: "c1", answer: "blue" }, { details: { outcome: "success" } }, "attempt-2"));
	const result = scoreScenario(events, pack);
	assert.equal(result.checks.attemptOnce.passed, 1);
	assert.equal(result.checks.attemptOnce.failures.length, 1);
});

test("wrong_guess requires teaching before a question on the next turn", () => {
	const events = goodScenario();
	const attemptEnd = events.findIndex((event) => (event.record as AnyRecord)?.toolCallId === "attempt"
		&& (event.record as AnyRecord)?.type === "tool_execution_end");
	(events[attemptEnd].record as AnyRecord).result = { details: { outcome: "wrong_guess" } };
	const nextSent = events.findIndex((event) => (event.record as AnyRecord)?.type === "harness_turn_sent" && event.turn === 2);
	events.splice(nextSent, 0, sent(3, 30, "challenge"), assistant(3, 31, "Try this question?"), ...tool(3, 33, "psi_challenge", { action: "next" }, { details: { challengeId: "c1" } }, "challenge-3"), ...settled(3, 35));
	const result = scoreScenario(events, pack);
	assert.equal(result.checks.wrongGuessTeaching.passed, 0);
});

