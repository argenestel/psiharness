import test from "node:test";
import assert from "node:assert/strict";
import { challengeSignal, holdsDelta } from "../src/agent.ts";

const chatPath = "../public/js/chat.js";
const { reduceRecord } = await import(chatPath) as { reduceRecord: (state: any, record: any) => any };

const shown = { type: "tool_execution_end", toolName: "psi_challenge", isError: false,
	result: { content: [], details: { challengeId: "c1" } } };
const attempted = { type: "tool_execution_end", toolName: "psi_attempt", isError: false,
	result: { content: [], details: { attempt: { id: "a1" } } } };

test("a shown challenge opens and a recorded attempt closes; rejected calls change nothing", () => {
	assert.equal(challengeSignal(shown), "open");
	assert.equal(challengeSignal(attempted), "close");
	assert.equal(challengeSignal({ ...shown, isError: true }), undefined);
	assert.equal(challengeSignal({ ...attempted, result: { details: { recorded: false } } }), undefined);
	assert.equal(challengeSignal({ ...attempted, result: { details: { errors: ["code requires an outcome"] } } }), undefined);
	// Replayed history carries tool results as messages.
	assert.equal(challengeSignal({ type: "message_end",
		message: { role: "toolResult", toolName: "psi_challenge", details: { challengeId: "c1" } } }), "open");
	assert.equal(challengeSignal({ type: "message_end", message: { role: "assistant", content: [] } }), undefined);
});

test("text and thinking deltas are held only while holding; tool-call ends always pass", () => {
	const delta = { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "The answer is 42" } };
	const think = { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "42" } };
	const tool = { type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "t" } } };
	assert.equal(holdsDelta(delta, true), true);
	assert.equal(holdsDelta(think, true), true);
	assert.equal(holdsDelta(tool, true), false);
	assert.equal(holdsDelta(delta, false), false);
	assert.equal(holdsDelta({ type: "message_end", message: {} }, true), false);
});

test("with deltas held, the chat still renders the final redacted message", () => {
	let state = reduceRecord(undefined, { type: "message_start", message: { role: "assistant", content: [] } });
	state = reduceRecord(state, { type: "message_update",
		assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { type: "toolCall", id: "t", name: "psi_hint" } } });
	state = reduceRecord(state, { type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "Try it: what is 6 × 7? [answer hidden]" }] } });
	const last = state.messages.at(-1);
	assert.equal(last.done, true);
	assert.equal(last.text, "Try it: what is 6 × 7? [answer hidden]");
});
