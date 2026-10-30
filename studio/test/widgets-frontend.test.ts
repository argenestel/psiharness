import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Variable specifiers keep browser-only JS outside the TS project's no-allowJs boundary.
const codelabPath = "../public/js/codelab.js";
const widgetsPath = "../public/js/widgets.js";
const { compareRows, withTimeout, runCode } = await import(codelabPath);
const { formatAnswer, widgetKindFor, renderToolWidget } = await import(widgetsPath);

test("SQL row comparison preserves types, multiplicity and optional ordering", () => {
	assert.equal(compareRows([[1, "one"], [2, null]], [[2, null], [1, "one"]]), true);
	assert.equal(compareRows([[1], [2]], [[2], [1]], { ordered: true }), false);
	assert.equal(compareRows([[1], [2]], [[1], [2]], { ordered: true }), true);
	assert.equal(compareRows([[1]], [[1], [1]]), false);
	assert.equal(compareRows([[1], [1]], [[1], [2]]), false);
	assert.equal(compareRows([[1]], [["1"]]), false);
	assert.equal(compareRows([], []), true);
});

test("deadline resolves fast work and preserves ordinary failures", async () => {
	assert.equal(await withTimeout(Promise.resolve("done"), 100), "done");
	await assert.rejects(withTimeout(Promise.reject(new Error("failed")), 100), /failed/);
});

test("deadline rejects stalled work and calls timeout cleanup exactly once", async () => {
	let calls = 0;
	await assert.rejects(withTimeout(new Promise(() => {}), 5, () => { calls++; }), /timed out/);
	assert.equal(calls, 1);
	await assert.rejects(withTimeout(new Promise(() => {}), 5, () => { throw new Error("cleanup"); }), /timed out/);
});

test("answers use compact stable displays", () => {
	assert.equal(formatAnswer("  hello  "), "hello");
	assert.equal(formatAnswer([" one ", 2]), "one, 2");
	assert.equal(formatAnswer({ a: 1 }), '{"a":1}');
	assert.equal(formatAnswer(2), "2");
	assert.equal(formatAnswer(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER));
	assert.equal(formatAnswer(0.1 + 0.2), "0.3");
	assert.equal(formatAnswer(null), "");
});

test("dispatch rejects unknown, empty, erroneous, and mismatched tool results without a DOM", () => {
	const challenge = { details: { widget: { type: "challenge", skill: "sql", id: "c" } } };
	assert.equal(widgetKindFor("unknown", challenge), null);
	assert.equal(renderToolWidget("unknown", {}, challenge, {}), null);
	assert.equal(widgetKindFor("psi_challenge", {}), null);
	assert.equal(renderToolWidget("psi_challenge", {}, {}, {}), null);
	assert.equal(widgetKindFor("psi_challenge", challenge), "challenge");
	assert.equal(widgetKindFor("psi_challenge", { ...challenge, isError: true }), null);
	assert.equal(widgetKindFor("psi_attempt", challenge), null);
});

test("dispatch supports the extension's plain details and requested widget details", () => {
	assert.equal(widgetKindFor("psi_attempt", { details: { outcome: "fail", xp: 5 } }), "attempt");
	assert.equal(widgetKindFor("psi_skill_plan", { details: { plan: { subskills: [] } } }), "plan");
	assert.equal(widgetKindFor("psi_memory_remember", { details: { text: "Learns by doing" } }), "memory");
	assert.equal(widgetKindFor("psi_progress_report", { details: { skills: [] } }), "progress");
	assert.equal(widgetKindFor("psi_concept_graph", { details: { mermaid: "graph TD" } }), "graph");
	assert.equal(widgetKindFor("psi_storyboard", { content: [{ type: "text", text: "/artifacts/sql/a.html" }] }), "artifact");
	assert.equal(widgetKindFor("psi_explorable", { details: { path: "javascript:alert(1)" } }), null);
	assert.equal(widgetKindFor("psi_explorable", { details: { path: "/artifacts/../secret" } }), null);
});

test("runner gracefully resolves unsupported languages and a missing browser", async () => {
	const unsupported = await runCode({ language: "ruby" });
	assert.equal(unsupported.ok, false);
	assert.match(unsupported.error, /Unsupported/);
	const javascript = await runCode({ language: "javascript", code: "1+1" });
	assert.equal(javascript.ok, false);
	assert.match(javascript.error, /browser/);
});


test("JavaScript worker shares setup scope, captures output, and strips network APIs", async () => {
	const source = await readFile(new URL("../public/js/runners/js-worker.js", import.meta.url), "utf8");
	const replies: { ok: boolean; output: string; error: string }[] = [];
	const self: Record<string, any> = {
		postMessage: (value: { ok: boolean; output: string; error: string }) => replies.push(value),
		fetch() {}, XMLHttpRequest() {}, WebSocket() {}, importScripts() {}, Worker() {},
	};
	runInNewContext(source, { self, performance });
	for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "Worker"]) {
		assert.equal(self[name], undefined);
	}
	await self.onmessage({ data: { id: 1, setup: "const value = 42;", code: "console.log(value);",
		tests: "if (value !== 42) throw new Error('wrong');" } });
	assert.equal(replies[0].ok, true);
	assert.equal(replies[0].output, "42");
	await self.onmessage({ data: { id: 2, code: "console.log('trying');", tests: "console.assert(false, 'try again');" } });
	assert.equal(replies[1].ok, false);
	assert.equal(replies[1].output, "trying");
	assert.match(replies[1].error, /try again/);
});
