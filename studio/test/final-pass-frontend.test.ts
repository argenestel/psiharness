import test from "node:test";
import assert from "node:assert/strict";

// Variable specifiers keep the untyped browser modules out of the type checker.
const paths = { chat: "../public/js/chat.js", practice: "../public/js/practice.js", widgets: "../public/js/widgets.js",
	format: "../public/js/format.js", api: "../public/js/api.js", shell: "../public/app.js" };
const { errorRuns, lastUserMessage, commandEcho } = await import(paths.chat);
const { distinctPrompts, promptPreview, promptSentences, texText, subskillStatus } = await import(paths.practice);
const { answerShape, widgetKindFor } = await import(paths.widgets);
const { parseAttemptMessage } = await import(paths.format);
const { isModuleLoadError } = await import(paths.shell);

test("challenge previews drop a pack's shared setup sentences and keep what differs", () => {
	const setup = "Use the seeded shop schema in setup (prices are integer units). Return exactly the requested columns.";
	const prompts = [`${setup} Return name, city for all customers.`, `${setup} Return each distinct city once.`,
		"Which SQL clause filters grouped results? Answer with the one keyword.", setup];
	const distinct = distinctPrompts(prompts);
	assert.equal(distinct[0], "Return name, city for all customers.");
	assert.equal(distinct[1], "Return each distinct city once.");
	assert.equal(distinct[2], prompts[2], "a prompt sharing nothing keeps every sentence");
	assert.equal(distinct[3], "Return exactly the requested columns.", "pure boilerplate falls back to its last sentence");
	assert.notEqual(promptPreview(distinct[0]), promptPreview(distinct[1]));
	// Code fences and list markers never reach the one-line preview.
	assert.deepEqual(promptSentences("Read this.\n\n```python\nprint(1)\n```\n- Base case: stop.\n- Then recurse."),
		["Read this.", "Base case: stop.", "Then recurse."]);
	assert.deepEqual(distinctPrompts(["Only one prompt here."]), ["Only one prompt here."]);
});

test("previews render inline TeX as readable text", () => {
	assert.equal(texText("\\frac{f(3)-f(2)}{3-2}"), "(f(3)-f(2))/(3-2)");
	assert.equal(texText("\\frac{\\Delta s}{\\Delta t}"), "Δs/Δt");
	assert.equal(texText("x\\to1"), "x → 1");
	assert.equal(texText("0\\le t\\le4"), "0 ≤ t ≤ 4");
	assert.equal(texText("\\int_{-1}^{1}x\\,dx"), "∫₋₁¹x dx");
	assert.equal(texText("x^2(x+1)"), "x²(x+1)");
	assert.equal(texText("\\tfrac12"), "1/2");
	assert.equal(promptPreview("Predict, then differentiate $x^4$."), "Predict, then differentiate x⁴.");
});

test("locked steps name the step numbers they wait on, with the titles kept for hover", () => {
	const plan = { subskills: [
		{ id: "a", title: "Base case", status: "active", priority: 1, prerequisites: [] },
		{ id: "b", title: "Smaller input", status: "active", priority: 2, prerequisites: ["a"] },
		{ id: "c", title: "Trace calls", status: "active", priority: 3, prerequisites: ["b", "a"] },
		{ id: "d", title: "Done", status: "solid", priority: 0, prerequisites: [] },
	] };
	assert.deepEqual(subskillStatus(plan.subskills[0], plan), { key: "next", text: "Next up" });
	assert.equal(subskillStatus(plan.subskills[1], plan).text, "After step 1");
	const both = subskillStatus(plan.subskills[2], plan);
	assert.equal(both.text, "After steps 1 and 2");
	assert.equal(both.names, "Unlocks after Smaller input and Base case");
	assert.equal(subskillStatus(plan.subskills[3], plan).text, "Solid");
});

test("short text answers get a one-line input; only written answers get a box", () => {
	assert.equal(answerShape({ kind: "predict", prompt: "What exception does `1 / 0` raise?" }), "line");
	assert.equal(answerShape({ kind: "quickfire", prompt: "Which clause filters groups?" }), "line");
	assert.equal(answerShape({ kind: "debug", prompt: "Supply the corrected product." }), "line");
	assert.equal(answerShape({ kind: "explain", prompt: "Say it back." }), "area");
	assert.equal(answerShape({ kind: "apply", prompt: "Explain why rounding overestimates." }), "area");
	assert.equal(answerShape({ kind: "boss", prompt: "Final." }), "area");
	// A saved note shows only in the activity line, never as an inline chip.
	assert.equal(widgetKindFor("psi_memory_remember", { details: { text: "Learns by doing" } }), null);
});

test("repeated identical model errors collapse into one notice with a count; recovered ones disappear", () => {
	const fail = { role: "assistant", text: "", error: "Request timed out." };
	const runs = errorRuns([{ role: "user", text: "hi" }, fail, fail, fail, fail]);
	assert.deepEqual([...runs.entries()], [[1, 0], [2, 0], [3, 0], [4, 4]]);
	assert.deepEqual([...errorRuns([{ role: "user", text: "a" }, fail, { role: "user", text: "b" }, fail]).values()], [1, 1]);
	assert.deepEqual([...errorRuns([{ role: "user", text: "a" }, fail, { role: "assistant", text: "Recovered" }]).values()], [0]);
	// Retrying the same message keeps one notice (with the running count) instead of stacking another.
	const retried = errorRuns([{ role: "user", text: "a" }, fail, fail, { role: "user", text: "a" }, fail]);
	assert.deepEqual([...retried.values()], [0, 0, 3]);
	const other = { ...fail, error: "Rate limited." };
	assert.deepEqual([...errorRuns([fail, other]).values()], [1, 1], "different errors stay separate");
	assert.equal(errorRuns([{ role: "assistant", text: "", error: "x", stopReason: "aborted" }]).size, 0);
});

test("Retry resends the learner's last message, falling back to what this tab sent", () => {
	const messages = [{ role: "user", text: "first" }, { role: "assistant", text: "ok" }, { role: "user", text: "second" },
		{ role: "assistant", text: "", error: "Request timed out." }];
	assert.equal(lastUserMessage(messages, "stale"), "second");
	assert.equal(lastUserMessage([], "typed here"), "typed here");
});

test("the card's notes to the tutor echo as the learner's words, never the challenge id", () => {
	const answered = "Answered challenge 61b1871b-8866: 1 (fail, +2 XP). Already graded and saved; don't record it again.";
	assert.equal(commandEcho(answered), "My answer: 1");
	assert.equal(commandEcho("Answered challenge c1: 42 (success, +10 XP)"), "My answer: 42");
	assert.equal(commandEcho('Lesson for challenge c1 (I missed it with "1"): Check the base case first.'),
		"What I'll try differently: Check the base case first.");
	assert.deepEqual(parseAttemptMessage(answered), { kind: "attempt", id: "61b1871b-8866", answer: "1", outcome: "fail", xp: 2 });
	assert.deepEqual(parseAttemptMessage('Lesson for challenge c1 (I missed it with "x"): y'),
		{ kind: "lesson", id: "c1", answer: "x", outcome: "fail", lesson: "y" });
});

test("api.patch sends PATCH with X-Psi and JSON", async (t) => {
	const original = globalThis.fetch;
	t.after(() => { globalThis.fetch = original; });
	const calls: [string, RequestInit][] = [];
	globalThis.fetch = async (input, options) => {
		calls.push([String(input), options ?? {}]);
		return new Response(JSON.stringify({ id: "m1", text: "edited" }), { status: 200 });
	};
	const { api } = await import(paths.api);
	assert.deepEqual(await api.patch("/api/memory/m1", { text: "edited" }), { id: "m1", text: "edited" });
	assert.equal(calls[0][0], "/api/memory/m1");
	assert.equal(calls[0][1].method, "PATCH");
	assert.equal((calls[0][1].headers as Record<string, string>)["X-Psi"], "1");
	assert.equal(calls[0][1].body, '{"text":"edited"}');
});

test("only a failed module load (server restarted) gets the reload message", () => {
	assert.equal(isModuleLoadError(new TypeError("Failed to fetch dynamically imported module: http://x/js/chat.js")), true);
	assert.equal(isModuleLoadError(new TypeError("error loading dynamically imported module")), true);
	assert.equal(isModuleLoadError(new TypeError("Importing a module script failed.")), true);
	assert.equal(isModuleLoadError(new Error("Chat not found")), false);
	assert.equal(isModuleLoadError(new TypeError("Failed to fetch")), false);
});
