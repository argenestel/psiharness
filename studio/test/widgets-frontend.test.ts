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
	// Saved notes show only in the turn's activity line, never as a duplicate inline chip.
	assert.equal(widgetKindFor("psi_memory_remember", { details: { text: "Learns by doing" } }), null);
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

const trailPath = "../public/js/trail.js";
const { trailSummary, trailCounts, markLabel, outcomeWord } = await import(trailPath);
const { runSummary, looksLikeCode } = await import(codelabPath);
const { kindPhrase, keyHelp } = await import(widgetsPath);

test("trail summary counts only recognised outcomes in plain words", () => {
	assert.equal(trailSummary([]), "No attempts yet");
	assert.equal(trailSummary([{ outcome: "success" }]), "1 attempt: 1 solved");
	const attempts = [
		...Array(8).fill({ outcome: "success" }), ...Array(3).fill({ outcome: "fail" }), { outcome: "skipped" },
		{ outcome: "pending" }, null,
	];
	assert.equal(trailSummary(attempts), "12 attempts: 8 solved, 3 missed, 1 skipped");
	assert.equal(trailSummary([{ outcome: "partial" }, { outcome: "fail" }]), "2 attempts: 1 partly right, 1 missed");
	assert.deepEqual(trailCounts(attempts), { total: 12, success: 8, partial: 0, fail: 3, skipped: 1 });
	assert.equal(outcomeWord("fail"), "missed");
	assert.equal(outcomeWord("pending"), "");
});

test("mark labels name the attempt, outcome, XP, time and the lesson for a miss", () => {
	const now = Date.parse("2026-11-01T12:00:00Z");
	assert.equal(markLabel({ outcome: "fail", xp: 3, at: "2026-11-01T10:00:00Z", lesson: " Check the base case. " }, 3, now),
		"Attempt 4, missed, +3 XP, 2 h ago. Lesson: Check the base case.");
	assert.equal(markLabel({ outcome: "success", at: "2026-11-01T11:59:30Z" }, 0, now), "Attempt 1, solved, just now.");
	assert.equal(markLabel({ outcome: "skipped" }, 1, now), "Attempt 2, skipped.");
});

test("challenge kinds read as plain phrases with format-aware keyboard help", () => {
	assert.equal(kindPhrase("quickfire"), "Quick question");
	assert.equal(kindPhrase("debug"), "Find the bug");
	assert.equal(kindPhrase("boss"), "Boss challenge");
	assert.equal(kindPhrase("predict", { format: "choice", prompt: "What does `print(len('psi'))` print?" }), "Predict the output");
	assert.equal(kindPhrase("predict", { format: "choice", prompt: "What happens to the tangent?" }), "Predict what happens");
	assert.equal(kindPhrase("unknown"), "Challenge");
	assert.equal(keyHelp("code", { hints: true, mac: true }), "Cmd+Enter runs your code, H shows a hint");
	assert.equal(keyHelp("text"), "Enter checks, Shift+Enter adds a line");
	assert.equal(keyHelp("text", { short: true }), "Enter checks your answer");
});

test("run summaries list each check without repeating assertion messages", () => {
	const run = runSummary({ ok: false, output: "hi", ms: 4, tests: [
		{ label: "4 should be even", ok: true },
		{ label: "5 should be odd", ok: false, message: "AssertionError: 5 should be odd" },
		{ label: "is_even(0) is True", ok: false, message: "NameError: name 'is_even' is not defined" },
		{ label: "later", ok: false, skipped: true },
	] }, { language: "python", hasTests: true });
	assert.equal(run.headline, "1 of 4 checks passed");
	assert.deepEqual(run.rows.map((r: { state: string }) => r.state), ["pass", "fail", "fail", "skipped"]);
	assert.equal(run.rows[1].message, "");
	assert.equal(run.rows[2].message, "NameError: name 'is_even' is not defined");
	assert.equal(run.rows[2].code, true);
	assert.equal(run.rows[0].code, false);
	assert.equal(runSummary({ ok: true, tests: [{ label: "a", ok: true }, { label: "b", ok: true }] }).headline,
		"All 2 checks passed");
	const sql = runSummary({ ok: false, error: "The result rows did not match the expected rows." }, { language: "sql", hasTests: true });
	assert.equal(sql.rows[0].label, "Your rows don't match the expected rows yet");
	const offline = runSummary({ ok: false, system: true, error: "Couldn't load Python from the CDN. Check your connection and run again." });
	assert.equal(offline.system, true);
	assert.equal(offline.rows.length, 0);
	assert.match(offline.headline, /Check your connection/);
	assert.equal(looksLikeCode("total == 10"), true);
	assert.equal(looksLikeCode("zero is divisible by two"), false);
});

const sourcesPath = "../public/js/sources.js";
const { verdictWords, kindWords, rankSteps, resolveCitation } = await import(sourcesPath);
const { normalizeOptions, comboWords, ranIn } = await import(widgetsPath);

test("verdicts read as plain words with ink/pencil marks", () => {
	const two = [{ sourceId: "a" }, { sourceId: "b" }, { sourceId: "a" }];
	assert.deepEqual(verdictWords("supported", two), { words: "Supported by 2 sources", mark: "check", count: 2 });
	assert.equal(verdictWords("supported", [{ sourceId: "a" }]).words, "Supported by 1 source");
	assert.equal(verdictWords("supported", []).words, "Couldn't confirm from the sources");
	assert.equal(verdictWords("contradicted", two).words, "Sources disagree");
	assert.equal(verdictWords("unclear", two).mark, "query");
});

test("sources: kinds in words, 5-step trust, and numbered lookup", () => {
	assert.equal(kindWords("official-docs"), "Official documentation");
	assert.equal(kindWords("weird"), "Reference");
	assert.deepEqual([0, 1, 20, 21, 98, 100, Number.NaN].map(rankSteps), [0, 1, 1, 2, 5, 5, 0]);
	assert.equal(resolveCitation([{ n: 2, title: "b" }, { n: 1, title: "a" }], 1).title, "a");
	assert.equal(resolveCitation([{ title: "a" }, { title: "b" }], 2).title, "b");
	assert.equal(resolveCitation([{ n: 1 }], 3), undefined);
});

test("next steps normalize to 1–4 distinct options; combo and run timing read plainly", () => {
	assert.deepEqual(normalizeOptions(["Continue", { label: "I'm stuck" }, { label: "continue" }, { label: "" }]),
		[{ label: "Continue", message: "Continue" }, { label: "I'm stuck", message: "I'm stuck" }]);
	assert.equal(normalizeOptions(["a", "b", "c", "d", "e"]).length, 4);
	assert.equal(comboWords(1), null);
	assert.deepEqual(comboWords(2), { text: "2 in a row", ticks: 2, bonus: "" });
	assert.deepEqual(comboWords(3, 1.2), { text: "3 in a row", ticks: 3, bonus: "×1.2 XP" });
	assert.equal(comboWords(6).bonus, "×1.5 XP");
	assert.equal(ranIn(120), "ran in 120 ms");
	assert.equal(ranIn(1450), "ran in 1.4 s");
	assert.equal(ranIn(undefined), "");
});

test("teach-first widgets dispatch on details.widget.type", () => {
	const w = (widget: object) => ({ details: { widget } });
	assert.equal(widgetKindFor("psi_lesson", w({ type: "lesson", title: "T", explanation: "E" })), "lesson");
	assert.equal(widgetKindFor("psi_verify", w({ type: "verification", claim: "c" })), "verification");
	assert.equal(widgetKindFor("psi_run", w({ type: "run", code: "print(1)" })), "run");
	assert.equal(widgetKindFor("psi_next_steps", w({ type: "next_steps", options: [] })), null);
	assert.equal(widgetKindFor("psi_next_steps", w({ type: "next_steps", options: [{ label: "Go" }] })), "next_steps");
	assert.equal(widgetKindFor("psi_ask", w({ type: "socratic", question: " " })), null);
	assert.equal(widgetKindFor("psi_ask", w({ type: "socratic", question: "Why?" })), "socratic");
	assert.equal(widgetKindFor("psi_sources", w({ type: "sources", items: [] })), "sources");
});
