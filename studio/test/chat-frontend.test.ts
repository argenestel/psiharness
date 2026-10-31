import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Dynamic paths keep these dependency-free browser modules outside TypeScript's source graph.
const markdownPath = "../public/js/markdown.js";
const chatPath = "../public/js/chat.js";
const apiPath = "../public/js/api.js";
let parseMarkdown: (text: string) => any;
let parseInline: (text: string) => any;
let safeLink: (text: string) => any;
let languageLabel: (language?: string) => string;
let reduceRecord: (state: any, record: any) => any;
let chat: Record<string, any>;
before(async () => {
	({ parseMarkdown, parseInline, safeLink, languageLabel } = await import(markdownPath));
	chat = await import(chatPath);
	({ reduceRecord } = chat);
});

test("HTML and attribute payloads remain literal text in the AST", async () => {
	for (const source of ['<script>alert(1)</script>', '<img src=x onerror="alert(1)">',
		'\" onmouseover=\"alert(1)', '<a href="javascript:alert(1)">x</a>']) {
		const [block] = parseMarkdown(source);
		assert.deepEqual(block.inline, [{ type: "text", text: source }]);
	}
	const code = await readFile(new URL("../public/js/markdown.js", import.meta.url), "utf8");
	assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("all four math delimiters preserve unevaluated formulas without KaTeX", () => {
	for (const source of ["$x^2$", "$$x^2$$", "\\(x^2\\)", "\\[x^2\\]"]) {
		const tokens = parseInline(source);
		assert.equal(tokens[0].type, "math");
		assert.equal(tokens[0].text, "x^2");
	}
	assert.equal(parseMarkdown("$$\nx+y\n$$")[0].text.trim(), "x+y");
	assert.equal(parseMarkdown("\\[\nx+y\n\\]")[0].text.trim(), "x+y");
	assert.equal(typeof globalThis.window, "undefined");
	assert.deepEqual(parseInline("$partial"), [{ type: "text", text: "$partial" }]);
});

test("fences retain language and unfinished streaming code", () => {
	const [partial] = parseMarkdown('```python\nprint("<img>")');
	assert.equal(partial.language, "python");
	assert.equal(partial.text, 'print("<img>")');
	assert.equal(partial.closed, false);
	assert.equal(parseMarkdown("```sql\nSELECT 1\n```")[0].closed, true);
	assert.equal(parseMarkdown("~~~js\nlet x = 1;\n~~~")[0].language, "js");
});

test("links allow only absolute HTTP(S), with unsafe destinations kept as text", () => {
	for (const url of ["javascript:alert", "data:text/html,x", "vbscript:x", "//example.com", "java\nscript:x"]) {
		assert.equal(safeLink(url), undefined);
		assert.equal(parseInline(`[click](${url})`)[0].type, "text");
	}
	for (const url of ["https://example.com/", "http://example.com/path", 'https://example.com/\"onmouseover=\"x']) {
		assert.equal(parseInline(`[click](${url})`)[0].type, "link");
	}
});

test("headings, emphasis, lists, tables and quotes have structural AST nodes", () => {
	assert.equal(parseMarkdown("# Title")[0].level, 1);
	assert.deepEqual(parseInline("**bold** *italic* `code`").filter((t: { type: string }) => t.type !== "text")
		.map((t: { type: string }) => t.type), ["strong", "em", "code"]);
	assert.equal(parseMarkdown("- a\n- b")[0].items.length, 2);
	assert.equal(parseMarkdown("1. a\n2. b")[0].ordered, true);
	assert.equal(parseMarkdown("> quote")[0].type, "quote");
	assert.equal(parseMarkdown("a | b\n--- | ---\nc | d")[0].rows.length, 2);
});

test("reducer reconstructs deltas, final messages, tools and settled lifecycle immutably", () => {
	const initial = { messages: [], tools: [], busy: false };
	const records = [
		{ type: "agent_start" },
		{ type: "message_start", message: { role: "user", content: "Teach me" } },
		{ type: "message_end", message: { role: "user", content: "Teach me" } },
		{ type: "message_start", message: { role: "assistant", content: [] } },
		{ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Consider" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Hello " } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "learner" } },
		{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello learner!" }] } },
		{ type: "tool_execution_start", toolCallId: "t1", toolName: "psi_skill_plan", args: { skill: "math" } },
		{ type: "tool_execution_end", toolCallId: "t1", toolName: "psi_skill_plan", result: { ok: true }, isError: false },
		{ type: "agent_end" }, { type: "agent_settled" },
	];
	let state = initial;
	for (const [index, payload] of records.entries()) {
		const previous = JSON.stringify(state);
		const next = reduceRecord(state, { seq: index + 1, payload });
		assert.equal(JSON.stringify(state), previous);
		state = next;
		if (index === 6) assert.equal((state.messages[1] as { text: string }).text, "Hello learner");
		if (index === 10) assert.equal(state.busy, true);
	}
	assert.equal(state.busy, false);
	assert.equal((state.messages[1] as { text: string }).text, "Hello learner!");
	assert.equal((state.tools[0] as { done: boolean }).done, true);
	assert.deepEqual((state.tools[0] as { args: unknown }).args, { skill: "math" });
	assert.equal(reduceRecord(state, { seq: 1, payload: { type: "agent_start" } }), state);
	assert.equal(reduceRecord(undefined, { type: "agent_start" }).busy, true);
});

test("API sends JSON and X-Psi and propagates server error messages", async (t) => {
	const original = globalThis.fetch;
	t.after(() => { globalThis.fetch = original; });
	const calls: RequestInit[] = [];
	globalThis.fetch = async (_input, options) => {
		calls.push(options ?? {});
		return new Response(JSON.stringify({ message: "Server says no" }), { status: calls.length === 3 ? 400 : 200 });
	};
	const { api } = await import(apiPath);
	await api.get("/api/state"); await api.post("/api/chat", { skill: "math" });
	await assert.rejects(api.del("/api/chat/x"), /Server says no/);
	for (const call of calls) assert.equal((call.headers as Record<string, string>)["X-Psi"], "1");
	assert.equal(calls[1].body, '{"skill":"math"}');
});

test("SSE reconnect uses latest seq, filters duplicates and closes", async (t) => {
	const original = globalThis.EventSource;
	const instances: FakeSource[] = [];
	class FakeSource {
		url: string; closed = false;
		onmessage?: (event: { data: string; lastEventId: string }) => void;
		onerror?: (event: object) => void;
		constructor(url: string) { this.url = url; instances.push(this); }
		close() { this.closed = true; }
	}
	globalThis.EventSource = FakeSource as unknown as typeof EventSource;
	t.after(() => { globalThis.EventSource = original; });
	const { openEvents } = await import(apiPath);
	const received: unknown[] = [];
	const close = openEvents("a/b", { since: 0, onRecord: (record: unknown) => received.push(record) });
	t.after(close);
	instances[0].onmessage?.({ data: '{"seq":4,"payload":{"type":"agent_start"}}', lastEventId: "4" });
	instances[0].onmessage?.({ data: '{"seq":4}', lastEventId: "4" });
	assert.equal(received.length, 1);
	instances[0].onerror?.({});
	await new Promise((resolve) => setTimeout(resolve, 1100));
	assert.equal(instances[1].url, "/api/chat/a%2Fb/events?since=4");
	close(); assert.equal(instances[1].closed, true);
});

test("reducer honors block endings, HUD clears, wrapped events, and handled prompts", () => {
	let state = reduceRecord(undefined, { type: "message_start", message: { role: "assistant", content: [] } });
	for (const update of [
		{ type: "text_delta", contentIndex: 0, delta: "draft" },
		{ type: "text_end", contentIndex: 0, content: "corrected" },
		{ type: "thinking_delta", contentIndex: 1, delta: "private" },
		{ type: "thinking_end", contentIndex: 1, content: "completed reasoning" },
		{ type: "text_delta", contentIndex: 2, delta: "second block" },
	]) state = reduceRecord(state, { event: { type: "message_update", assistantMessageEvent: update } });
	assert.equal(state.messages[0].text, "corrected\nsecond block");
	assert.equal(state.messages[0].thinking, "completed reasoning");
	state = reduceRecord(state, { type: "extension_ui_request", method: "setStatus", statusKey: "s", statusText: "Working" });
	assert.equal(state.hud["setStatus:s"], "Working");
	state = reduceRecord(state, { type: "extension_ui_request", method: "setStatus", statusKey: "s" });
	assert.equal(state.hud["setStatus:s"], "");
	state = reduceRecord(state, { type: "response", command: "prompt", success: true, data: { disposition: "handled" } });
	assert.equal(state.busy, false);
});

const tool = (name: string, args: object = {}, extra: object = {}) => ({ id: name + JSON.stringify(args), name, args,
	done: true, isError: false, result: { content: [], details: {} }, ...extra });

test("tool activity collapses into one plain sentence without middle dots", () => {
	const { summarizeTools } = chat;
	assert.equal(summarizeTools([]), "");
	assert.equal(summarizeTools([tool("psi_skill_plan", { action: "create" }),
		tool("psi_memory_remember", { text: "a" }), tool("psi_memory_remember", { text: "b" })]),
	"Planned your skill and saved 2 notes about you");
	assert.equal(summarizeTools([tool("read"), tool("read"), tool("psi_practice_session", { action: "start" }),
		tool("psi_memory_remember")]), "Read the teaching notes, started a practice session and saved a note about you");
	// The challenge sheet and attempt result speak for themselves.
	assert.equal(summarizeTools([tool("psi_challenge"), tool("psi_attempt")]), "");
	assert.equal(summarizeTools([tool("psi_skill_plan", { action: "next" })]), "Picked your next subskill");
	assert.equal(summarizeTools([tool("read"), tool("psi_memory_remember"), tool("psi_skill_plan", { action: "get" }),
		tool("psi_practice_session", { action: "status" }), tool("psi_memory_recall")]),
	"Read the teaching notes, saved a note about you and 3 more steps");
	assert.equal(summarizeTools([tool("mystery_tool")]), "Used mystery_tool");
	assert.equal(summarizeTools([tool("psi_skill_plan", { action: "create" }), tool("psi_challenge", {}, { done: false })]),
		"Writing a challenge…");
	assert.equal(summarizeTools([tool("psi_recap"), tool("psi_challenge", {}, { result: { details: { errors: ["x"] } } })]),
		"Saved a recap of this session. One step didn't work");
	assert.equal(summarizeTools([tool("psi_hint", {}, { isError: true }), tool("psi_attempt", {}, { isError: true })]),
		"2 steps didn't work");
	for (const name of ["psi_skill_plan", "psi_memory_remember", "read", "psi_progress_report", "x"]) {
		assert.doesNotMatch(summarizeTools([tool(name)]), /·|→/);
	}
});

test("slash suggestions match the first word only", () => {
	const { matchCommands } = chat;
	assert.deepEqual(matchCommands("/pr").map((c: { name: string }) => c.name), ["practice", "progress"]);
	assert.ok(matchCommands("/").length > 10);
	assert.deepEqual(matchCommands("/skill python"), []);
	assert.deepEqual(matchCommands("skill"), []);
	assert.ok(matchCommands("/sk").every((c: { description: string }) => c.description.length > 0));
});

test("expanded command templates echo as the command the learner typed", () => {
	const { commandEcho } = chat;
	assert.equal(commandEcho('Help me learn "python loops". Active skill slug: python-loops.\nFollow Josh'),
		"/skill python loops");
	assert.equal(commandEcho('Help me learn "entropy" (topic: entropy). First diagnose'), "/learn entropy");
	assert.equal(commandEcho('Practice session started for py; focus: "next subskill";\nplanned'), "/practice");
	assert.equal(commandEcho('Practice session started for py; focus: "slicing";\nplanned'), "/practice slicing");
	assert.equal(commandEcho('Active skill: py. Create one harder boss challenge mixing solid subskills; wait. Request: ""'),
		"/boss");
	assert.equal(commandEcho("What does len do?"), undefined);
});

test("empty-chat starters are concrete and follow the skill plan", () => {
	const { starterPrompts } = chat;
	assert.equal(starterPrompts().length, 3);
	const prompts = starterPrompts({ title: "Python foundations", subskills: [
		{ title: "Loops", priority: 2, status: "active" }, { title: "Variables", priority: 1, status: "solid" },
		{ title: "Strings", priority: 1, status: "active" }] });
	assert.equal(prompts.length, 3);
	assert.match(prompts[0], /“Strings”/);
	assert.match(prompts[1], /Python foundations/);
});

test("turns group consecutive assistant messages with their tools", () => {
	const { groupTurns } = chat;
	const messages = [{ role: "user" }, { role: "assistant" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }];
	const groups = groupTurns(messages, [{ id: "a", turn: 1 }, { id: "b", turn: 2 }, { id: "c", turn: 4 }]);
	assert.deepEqual(groups.map((g: { role: string; messages: number[] }) => [g.role, g.messages]),
		[["user", [0]], ["assistant", [1, 2]], ["user", [3]], ["assistant", [4]]]);
	assert.deepEqual(groups[1].tools.map((t: { id: string }) => t.id), ["a", "b"]);
	assert.deepEqual(groups[3].tools.map((t: { id: string }) => t.id), ["c"]);
	const orphan = groupTurns([{ role: "user" }], [{ id: "x", turn: -1 }]);
	assert.equal(orphan.at(-1).role, "assistant");
	assert.equal(orphan.at(-1).tools[0].id, "x");
});

test("errors are specific, and tool details never show answer keys", () => {
	const { sendErrorText, toolDetail } = chat;
	assert.equal(sendErrorText(new TypeError("Failed to fetch")),
		"Couldn't reach the tutor. Check that psi web is running, then retry.");
	assert.match(sendErrorText(new Error("Chat not found.")), /Chat not found\. Retry/);
	const detail = toolDetail({ args: { prompt: "6*7?", expected: "42", acceptable: ["42"], hints: ["six sevens"] },
		result: { content: [{ type: "text", text: "ok" }] } });
	assert.match(detail, /6\*7/);
	assert.doesNotMatch(detail, /expected|acceptable|"42"|sevens/);
	const read = toolDetail({ name: "read", args: { path: "/home/x/skills/practice-loop/SKILL.md" },
		result: { content: [{ type: "text", text: "long file" }] } });
	assert.equal(read, "path: practice-loop/SKILL.md");
	assert.equal(languageLabel("py"), "Python");
	assert.equal(languageLabel(""), "Code");
});
