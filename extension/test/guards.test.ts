import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerPractice } from "../src/practice/index.ts";
import {
	ASK_AFTER_TEACHING, CITATION_NOTE, HIDDEN, TEACH_FIRST, fixCitations, isContinueIntent, lessonFirst, redactAnswers,
	withContinue,
} from "../src/practice/guards.ts";
import { turnReminder } from "../src/practice/inject.ts";
import { SourceStore } from "../../core/src/sources.ts";
import { ProfileStore } from "../../core/src/profile.ts";
import { StateStore } from "../../core/src/state.ts";

type Handler = (...args: any[]) => Promise<any>;
type Tool = { name: string; execute: Handler };

function fake() {
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, Handler[]>();
	const entries: any[] = [];
	const api = {
		registerTool: (tool: Tool) => tools.set(tool.name, tool),
		registerCommand: () => undefined,
		registerFlag: () => undefined,
		getFlag: () => undefined,
		on: (name: string, handler: Handler) => handlers.set(name, [...handlers.get(name) ?? [], handler]),
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		sendUserMessage: () => undefined,
		sendMessage: () => undefined,
	} as unknown as ExtensionAPI;
	const ctx = {
		sessionManager: { getBranch: () => entries },
		ui: { notify: () => undefined, setStatus: () => undefined, setWidget: () => undefined },
	} as unknown as ExtensionContext;
	const fire = async (name: string, event: any = {}) => {
		const results = [];
		for (const handler of handlers.get(name) ?? []) results.push(await handler(event, ctx));
		return results;
	};
	/** A learner message, as pi delivers it (before_agent_start, then the user message_end). */
	const learner = async (text: string) => {
		await fire("before_agent_start", { type: "before_agent_start", messageType: "user", prompt: text, systemPrompt: "" });
		const results = await fire("message_end", { type: "message_end", message: { role: "user", content: [{ type: "text", text }] } });
		assert.ok(results.every((r) => r === undefined), "learner messages are never replaced");
	};
	/** One finalized assistant message; returns the replacement (or the original). */
	const assistant = async (content: unknown[]) => {
		let message: any = { role: "assistant", content };
		for (const result of await fire("message_end", { type: "message_end", message })) {
			if (result?.message) { assert.equal(result.message.role, "assistant"); message = result.message; }
		}
		return message;
	};
	/** A model tool call through the tool_call gate, execution and tool_result, like pi's agent loop. */
	const call = async (name: string, input: Record<string, unknown>) => {
		const event = { type: "tool_call", toolCallId: "t", toolName: name, input };
		const blocked = (await fire("tool_call", event)).find((r) => r?.block);
		if (blocked) return { blocked };
		const result = await tools.get(name)!.execute("t", event.input, undefined, undefined, ctx);
		await fire("tool_result", { type: "tool_result", toolCallId: "t", toolName: name, input: event.input,
			content: result.content, details: result.details, isError: !!result.isError });
		return { result, input: event.input };
	};
	const guardEntries = (kind?: string) => entries.filter((e) => e.customType === "psi-guard" && (!kind || e.data.kind === kind));
	return { api, ctx, handlers, entries, fire, learner, assistant, call, guardEntries };
}

async function fixture(run: (f: ReturnType<typeof fake>, home: string) => Promise<void>) {
	const home = mkdtempSync(join(tmpdir(), "psi-guards-"));
	const previous = process.env.PSI_HOME;
	process.env.PSI_HOME = home;
	const f = fake();
	try {
		registerPractice(f.api, { home });
		await f.fire("session_start", { type: "session_start" });
		await run(f, home);
	} finally {
		await f.fire("session_shutdown");
		if (previous === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previous;
		rmSync(home, { recursive: true, force: true });
	}
}

const greet = {
	skill: "spanish", kind: "quickfire", level: 1, prompt: "How do you greet a server at 9 a.m.?",
	expected: "Buenos días", acceptable: ["buen día"], hints: ["Think of the time of day."],
};
const text = (t: string) => ({ type: "text", text: t });
const toolCall = (name: string, args: Record<string, unknown>) => ({ type: "toolCall", id: `c-${name}`, name, arguments: args });
const textOf = (message: any) => message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
const teaching = "A worked example first: at a café counter you open with a greeting, then the order, then thanks. "
	+ "Spanish greetings change with the time of day, and the article in front of the drink follows its grammatical gender.";

test("next steps always include Continue, dropping the last option beyond four", () => {
	const four = ["A", "B", "C", "D"].map((label) => ({ label, message: label }));
	assert.deepEqual(withContinue(four).options.map((o) => o.label), ["A", "B", "C", "Continue"]);
	assert.deepEqual(withContinue(four.slice(0, 2)).options.at(-1), { label: "Continue", message: "Continue" });
	const has = [{ label: "Continue: names", message: "go" }, { label: "Hint", message: "hint" }];
	assert.deepEqual(withContinue(has), { options: has, changed: false });
	assert.equal(withContinue([{ label: "▶ continue", message: "x" }, { label: "y", message: "y" }]).changed, false);
});

test("psi_next_steps is normalized in the transcript, at the tool gate and in its widget", async () => fixture(async (f) => {
	const options = [{ label: "I'll guess", message: "guess" }, { label: "Just show me", message: "Just show me" },
		{ label: "Hint", message: "hint" }, { label: "Skip", message: "skip" }];
	const message = await f.assistant([text("Here is the idea."), toolCall("psi_next_steps", { options })]);
	assert.deepEqual(message.content[1].arguments.options.map((o: any) => o.label), ["I'll guess", "Just show me", "Hint", "Continue"]);
	assert.equal(options.length, 4, "the original call arguments are not mutated by message_end");
	const gated = await f.call("psi_next_steps", { options: [...options] });
	assert.deepEqual(gated.result.details.widget.options.at(-1), { label: "Continue", message: "Continue" });
	const tool = await f.call("psi_next_steps", { options: [{ label: "Hint", message: "hint" }, { label: "Skip", message: "s" }] });
	assert.equal(tool.result.details.widget.options.length, 3);
	assert.ok(f.guardEntries("next-steps-continue").length >= 2);
}));

test("redaction hides accepted answers but keeps prompts, citations and learner code", () => {
	const c = { id: "c1", prompt: "What is 2 + 2?", expected: "4", acceptable: ["four"], format: "number" as const };
	const out = redactAnswers("What is 2 + 2? It is 4, i.e. FOUR [4]. Not 14 or 4.5. Step `x = 4` too.", [c], ["x = 4"]);
	assert.equal(out.text, `What is 2 + 2? It is ${HIDDEN}, i.e. ${HIDDEN} [4]. Not 14 or 4.5. Step \`x = 4\` too.`);
	assert.equal(out.count, 2);
	const words = redactAnswers("¡Buenos días! Or buen dia. Buenos diasito stays.", [{ ...greet, id: "g" }]);
	assert.equal(words.text, `¡${HIDDEN}! Or ${HIDDEN}. Buenos diasito stays.`);
	assert.equal(redactAnswers("a b", [{ id: "x", prompt: "", expected: "a" }]).count, 0, "one-letter answers are skipped");
	assert.equal(redactAnswers("print(4)", [{ id: "x", prompt: "", expected: "4", format: "code" }]).count, 0);
});

test("no spoilers: open challenge answers are hidden in text, buttons and Socratic hints until attempted",
	async () => fixture(async (f, home) => {
		await f.learner("Teach me greetings");
		const shown = await f.call("psi_challenge", greet);
		const id = shown.result.details.challengeId;
		assert.deepEqual(new StateStore(home).read().openChallenge, { skill: "spanish", id });
		const reply = await f.assistant([text("The card asks: How do you greet a server at 9 a.m.? (Answer: Buenos días.)"),
			toolCall("psi_next_steps", { options: [{ label: "Say Buenos días", message: "buen día" },
				{ label: "Continue", message: "Continue" }] })]);
		assert.equal(textOf(reply), `The card asks: How do you greet a server at 9 a.m.? (Answer: ${HIDDEN}.)`);
		assert.deepEqual(reply.content[1].arguments.options[0], { label: `Say ${HIDDEN}`, message: HIDDEN });
		const ask = await f.call("psi_ask", { question: "Which greeting fits?", kind: "predict", hint: "It starts with Buenos días" });
		assert.equal(ask.input!.hint, `It starts with ${HIDDEN}`);
		const buttons = await f.call("psi_next_steps", { options: [{ label: "Continue", message: "Buenos días" },
			{ label: "Hint", message: "hint" }] });
		assert.equal(buttons.result.details.widget.options[0].message, HIDDEN);
		assert.ok(f.guardEntries("spoiler").length >= 3);
		// The learner's own words are theirs, and feedback in the same message as the attempt is not a spoiler.
		await f.learner("My answer: buenas días");
		const feedback = await f.assistant([text("Close! The form is Buenos días because día is masculine."),
			toolCall("psi_attempt", { challengeId: id, answer: "buenas días" })]);
		assert.match(textOf(feedback), /The form is Buenos días/);
		await f.call("psi_attempt", { challengeId: id, skill: "spanish", answer: "buenas días" });
		const after = await f.assistant([text("Now you know: Buenos días.")]);
		assert.equal(textOf(after), "Now you know: Buenos días.");
	}));

test("a challenge graded outside the session (web card) stops redaction", async () => fixture(async (f, home) => {
	const shown = await f.call("psi_challenge", greet);
	const { PracticeStore } = await import("../../core/src/practice.ts");
	new PracticeStore(home).recordAttempt({ challengeId: shown.result.details.challengeId, answer: "Buenos días",
		outcome: "success", hintsUsed: 0 });
	new StateStore(home).update({ openChallenge: undefined });
	assert.equal(textOf(await f.assistant([text("Yes, Buenos días.")])), "Yes, Buenos días.");
}));

test("a challenge created in the same message hides its answer from that message's text", async () => fixture(async (f) => {
	await f.learner("Teach me greetings");
	const message = await f.assistant([text(`${teaching} Ready? Say buen día to the server.`),
		toolCall("psi_challenge", greet)]);
	assert.ok(textOf(message).includes(`Say ${HIDDEN} to the server`), textOf(message));
}));

test("a review served in the same message hides the reviewed challenge's answer", async () => fixture(async (f, home) => {
	const { PracticeStore } = await import("../../core/src/practice.ts");
	const store = new PracticeStore(home);
	const old = store.addChallenge(greet as any);
	store.recordAttempt({ skill: "spanish", challengeId: old.id, answer: "hola", outcome: "fail", hintsUsed: 0,
		at: new Date(Date.now() - 3600000).toISOString() });
	store.addChallenge({ ...greet, prompt: "Greet a server at 3 p.m.", expected: "Buenas tardes", acceptable: [],
		variantOf: old.id } as any);
	new StateStore(home).update({ activeSkill: "spanish" });
	await f.learner("Hi again");
	const message = await f.assistant([text("Warm-up first. In the afternoon you say Buenas tardes."),
		toolCall("psi_challenge", { action: "review" })]);
	assert.ok(textOf(message).includes(HIDDEN), textOf(message));
}));

test("continue intent detection", () => {
	for (const yes of ["Continue", "continue.", "Next", "go on!", "Keep going", "Just show me", "show me", "OK, continue",
		"Continue: stack greeting plus name in one café turn."]) assert.ok(isContinueIntent(yes), yes);
	for (const no of ["Teach me SQL", "Next challenge please", "I'll guess: una", "show me a quiz", "Try one myself", ""]) {
		assert.ok(!isContinueIntent(no), no);
	}
});

test("teach before testing: continue turns cannot open with a challenge", async () => fixture(async (f, home) => {
	await f.learner("Just show me");
	const blocked = await f.call("psi_challenge", greet);
	assert.deepEqual(blocked.blocked, { block: true, reason: TEACH_FIRST });
	assert.equal(f.guardEntries("teach-first").length, 1);
	await f.assistant([text("Short intro.")]);
	assert.ok((await f.call("psi_challenge", { ...greet, action: "next" })).blocked, "under 200 characters is not teaching");
	await f.assistant([text(teaching)]);
	assert.ok((await f.call("psi_challenge", greet)).result, "allowed after a teaching chunk");
	await f.learner("continue");
	await f.call("psi_lesson", { action: "show", skill: "spanish", subskillId: "greet" });
	assert.ok((await f.call("psi_challenge", greet)).blocked, "a missing lesson taught nothing");
	await f.learner("keep going");
	await f.fire("tool_call", { type: "tool_call", toolCallId: "r", toolName: "psi_run", input: { language: "python", code: "1" } });
	assert.ok(!(await f.call("psi_challenge", greet)).blocked, "a psi_run demo counts as teaching");
	await f.learner("Teach me the next step.");
	assert.ok(!(await f.call("psi_challenge", greet)).blocked, "only continue/show turns are gated");
	new ProfileStore(home).update({ tutorMode: "test" });
	await f.learner("Continue");
	assert.ok(!(await f.call("psi_challenge", greet)).blocked, "test mode serves challenges directly");
}));

test("citation markers beyond the source list are removed with one note", () => {
	const input = "Cafe [1] is masculine [3]. Both [1, 3] and [2–4] and [1][5]. Code `xs[9]` and xs[7], [8](https://a.b) stay.";
	const out = fixCitations(input, 2);
	assert.equal(out.text, "Cafe [1] is masculine. Both [1] and [2] and [1]. Code `xs[9]` and xs[7], [8](https://a.b) stay.");
	assert.deepEqual(out.removed, [3, 3, 3, 4, 5]);
	assert.deepEqual(fixCitations("Valid [1][2] and [1–2].", 2), { text: "Valid [1][2] and [1–2].", removed: [] });
	assert.equal(fixCitations("```\nx = a[5]\n```\nok [5]", 2).text, "```\nx = a[5]\n```\nok");
	assert.equal(fixCitations("[1-4] range", 3).text, "[1-3] range");
});

test("message_end removes unknown citations using the active skill's sources", async () => fixture(async (f, home) => {
	await f.call("psi_challenge", { ...greet, expected: "zzz-not-used" });
	await f.call("psi_attempt", { challengeId: new StateStore(home).read().openChallenge!.id, skill: "spanish", answer: "x" });
	const sources = new SourceStore(home);
	sources.add("spanish", { url: "https://www.rae.es/dpd/d%C3%ADa", title: "DPD: día" });
	sources.add("spanish", { url: "https://dle.rae.es/llamar", title: "DLE: llamar" });
	const valid = await f.assistant([text("Buenos días is the morning formula [1]; me llamo uses llamarse [2].")]);
	assert.equal(textOf(valid), "Buenos días is the morning formula [1]; me llamo uses llamarse [2].");
	const fixed = await f.assistant([text("Un café [9]."), toolCall("psi_next_steps", { options: [] }), text("Por favor [2][7].")]);
	assert.equal(textOf(fixed), `Un café.\nPor favor [2].\n\n${CITATION_NOTE}`);
	assert.deepEqual(f.guardEntries("citation-removed").at(-1).data, {
		kind: "citation-removed", detail: { numbers: [9, 7], sourceCount: 2, skill: "spanish" } });
}));

test("single-digit numeric answers are hidden only in answer-like phrases, never in code", () => {
	const c = { id: "c", prompt: "Compute the secant slope.", expected: "5", format: "number" as const };
	const out = redactAnswers("Take 5 steps. The slope is 5. So $9-4=5$, answer: **5**. Code `range(5)` stays.", [c]);
	assert.equal(out.text, `Take 5 steps. The slope is ${HIDDEN}. So $9-4=${HIDDEN}$, answer: **${HIDDEN}**. `
		+ "Code `range(5)` stays.");
	const choice = { id: "k", prompt: "", expected: "4", format: "choice" as const };
	assert.equal(redactAnswers("A list of 4 items; len(x) → 4.", [choice]).text, `A list of 4 items; len(x) → ${HIDDEN}.`);
	assert.equal(redactAnswers("| h | slope |\n| 1 | $5$ |", [c]).text, `| h | slope |\n| 1 | $${HIDDEN}$ |`, "table cells");
	const many = { id: "m", prompt: "", expected: "12", format: "number" as const };
	assert.equal(redactAnswers("Take 12 steps.", [many]).text, `Take ${HIDDEN} steps.`, "longer numbers stay strict");
});

test("Socratic prompts wait for teaching on continue turns", async () => fixture(async (f) => {
	await f.learner("Continue");
	await f.assistant([text("Next piece: names.")]);
	const blocked = await f.call("psi_ask", { question: "What does me llamo mean?", kind: "predict" });
	assert.deepEqual(blocked.blocked, { block: true, reason: ASK_AFTER_TEACHING });
	await f.assistant([text(teaching)]);
	assert.ok((await f.call("psi_ask", { question: "What does me llamo mean?", kind: "predict" })).result);
}));

test("a new subskill's first challenge waits for its lesson, then fails open", async () => fixture(async (f, home) => {
	const plan = { skill: "spanish", title: "Spanish", targetPerformance: "Order coffee", whyItMatters: "Travel",
		subskills: [{ id: "greet", title: "Greet", why: "First words", priority: 1, prerequisites: [], selfCorrection: "x",
			drills: ["d"], status: "active" }], resources: [], barriers: [] };
	await f.call("psi_skill_plan", { action: "create", plan });
	await f.learner("Give me a challenge");
	const first = await f.call("psi_challenge", { ...greet, subskillId: "greet" });
	assert.deepEqual(first.blocked, { block: true, reason: lessonFirst("greet") });
	assert.equal(f.guardEntries("lesson-first").length, 1);
	const { LessonStore } = await import("../../core/src/lessons.ts");
	const source = new SourceStore(home).add("spanish", { url: "https://www.rae.es/dpd/d%C3%ADa", title: "DPD: día" });
	new LessonStore(home).write("spanish", "greet", { title: "Greetings", explanation: "Buenos días before noon.",
		keyIdeas: ["Greet by time of day.", "Then give your name."], citations: [{ sourceId: source.id }] });
	await f.call("psi_lesson", { action: "show", skill: "spanish", subskillId: "greet" });
	assert.ok((await f.call("psi_challenge", { ...greet, subskillId: "greet" })).result, "allowed after the lesson");
	// Another session: not new any more once attempted; and a lesson that cannot be shown never locks practice.
	await f.fire("session_start", { type: "session_start" });
	await f.call("psi_attempt", { challengeId: new StateStore(home).read().openChallenge!.id, skill: "spanish", answer: "x" });
	assert.ok((await f.call("psi_challenge", { ...greet, subskillId: "greet" })).result, "attempted subskills are not new");
	plan.subskills.push({ ...plan.subskills[0]!, id: "order", title: "Order" });
	await f.call("psi_skill_plan", { action: "update", plan });
	assert.ok((await f.call("psi_challenge", { ...greet, subskillId: "order" })).blocked);
	assert.ok((await f.call("psi_challenge", { ...greet, subskillId: "order" })).blocked);
	assert.ok((await f.call("psi_challenge", { ...greet, subskillId: "order" })).result, "fails open after two blocks");
	new ProfileStore(home).update({ tutorMode: "test" });
	await f.fire("session_start", { type: "session_start" });
	assert.ok((await f.call("psi_challenge", { ...greet, subskillId: "order" })).result, "test mode never waits");
}));

test("skipping an already-graded challenge records nothing", async () => fixture(async (f, home) => {
	const shown = await f.call("psi_challenge", greet);
	const id = shown.result.details.challengeId;
	await f.call("psi_attempt", { challengeId: id, skill: "spanish", answer: "buenas días" });
	const skip = await f.call("psi_attempt", { challengeId: id, skill: "spanish", answer: "", outcome: "skipped" });
	assert.equal(skip.result.isError, undefined);
	assert.equal(skip.result.details.recorded, false);
	const { readAttempts } = await import("../src/practice/tools.ts");
	assert.equal(readAttempts(home, "spanish").length, 1);
}));

test("practise as you go: two teaching turns without a check make the next reminder ask for one", async () =>
	fixture(async (f, home) => {
		const remind = async () => {
			const [r] = await f.fire("context", { type: "context", messages: [{ role: "user", content: "Continue" }] });
			return r.messages[0].content as string;
		};
		await f.learner("Teach me greetings");
		const id = (await f.call("psi_challenge", greet)).result.details.challengeId;
		await f.learner("Buenos días");
		await f.call("psi_attempt", { challengeId: id, skill: "spanish", answer: "Buenos días" });
		await f.assistant([text(teaching)]);
		await f.fire("agent_end", {});
		assert.doesNotMatch(await remind(), /Practice is due/, "a turn with an answer is a check");
		for (const msg of ["Teach me the next part", "Continue"]) {
			await f.learner(msg);
			await f.assistant([text(teaching)]);
			await f.fire("agent_end", {});
			await f.fire("agent_end", {});
		}
		assert.match(await remind(), /Practice is due \(2 chunks/, "counted once per turn");
		new ProfileStore(home).update({ tutorMode: "teach" });
		assert.doesNotMatch(await remind(), /Practice is due/, "teach mode waits for three");
		new ProfileStore(home).update({ tutorMode: "practice" });
		await f.learner("Continue");
		await f.assistant([text(teaching)]);
		assert.ok((await f.call("psi_challenge", greet)).result);
		await f.fire("agent_end", {});
		assert.doesNotMatch(await remind(), /Practice is due/, "a served check resets the count");
	}));

test("a card graded in the browser stops the open-challenge warning and counts as a check", async () =>
	fixture(async (f, home) => {
		await f.learner("Teach me greetings");
		await f.call("psi_challenge", greet);
		for (const msg of ["Explain more", "Continue", "Continue"]) {
			await f.learner(msg);
			await f.assistant([text(teaching)]);
			await f.fire("agent_end", {});
		}
		// The web card's attempt route records the answer and clears state.json's openChallenge; this process still
		// held the id.
		const { PracticeStore } = await import("../../core/src/practice.ts");
		const open = new StateStore(home).read().openChallenge!;
		new PracticeStore(home).recordAttempt({ skill: open.skill, challengeId: open.id, answer: "Buenos días",
			outcome: "success", hintsUsed: 0 });
		new StateStore(home).update({ openChallenge: undefined });
		const [r] = await f.fire("context", { type: "context", messages: [{ role: "user", content: "Continue" }] });
		assert.doesNotMatch(r.messages[0].content, /is open/);
		assert.doesNotMatch(r.messages[0].content, /Practice is due/);
	}));

test("session warm-up: due reviews open the session, even on a continue turn, and retries come back as variants",
	async () => fixture(async (f, home) => {
		const { PracticeStore } = await import("../../core/src/practice.ts");
		const store = new PracticeStore(home);
		const old = store.addChallenge(greet as any);
		store.recordAttempt({ skill: "spanish", challengeId: old.id, answer: "hola", outcome: "fail", hintsUsed: 0,
			at: new Date(Date.now() - 3600000).toISOString() });
		new StateStore(home).update({ activeSkill: "spanish" });
		const [started] = await f.fire("before_agent_start", { type: "before_agent_start", messageType: "user",
			prompt: "Continue", systemPrompt: "" });
		assert.match(started.systemPrompt, /Session warm-up: 1 review\(s\) due/);
		await f.fire("message_end", { type: "message_end", message: { role: "user", content: "Continue" } });
		const [r] = await f.fire("context", { type: "context", messages: [{ role: "user", content: "Continue" }] });
		assert.match(r.messages[0].content, /Warm-up: 1 due review/);
		const review = await f.call("psi_challenge", { action: "review" });
		assert.ok(!review.blocked, "a warm-up review needs no teaching first");
		assert.equal(review.result.details.needsVariant, true);
		const variant = await f.call("psi_challenge", { ...greet, prompt: "How do you greet a server at 3 p.m.?",
			expected: "Buenas tardes", acceptable: [], variantOf: old.id });
		assert.ok(variant.result?.details.challengeId, "the variant is served on the same continue turn");
		const [after] = await f.fire("context", { type: "context", messages: [{ role: "user", content: "Continue" }] });
		assert.doesNotMatch(after.messages[0].content, /Warm-up/);
	}));

test("each model request carries a turn reminder on a copy of the latest learner message", async () => fixture(async (f) => {
	const messages = [{ role: "user", content: "Teach me", timestamp: 1 }, { role: "assistant", content: [] },
		{ role: "user", content: [{ type: "text", text: "Continue" }], timestamp: 2 }, { role: "toolResult", content: [] }];
	const [result] = await f.fire("context", { type: "context", messages });
	assert.equal(result.messages.length, 4);
	assert.equal(result.messages[0], messages[0]);
	assert.deepEqual(messages[2].content, [{ type: "text", text: "Continue" }], "the original is not mutated");
	const note = result.messages[2].content.at(-1).text;
	assert.equal(note, turnReminder({ continueIntent: true }));
	assert.match(note, /Cite \[n\]/);
	assert.match(note, /one question, placed last/);
}));

test("the turn after a graded miss teaches before a new prompt or challenge", async () => fixture(async (f) => {
	await f.learner("Teach me greetings");
	const id = (await f.call("psi_challenge", greet)).result.details.challengeId;
	await f.learner("buenas días");
	await f.call("psi_attempt", { challengeId: id, skill: "spanish", answer: "buenas días" });
	await f.learner("I'm stuck; why buenos?");
	assert.deepEqual((await f.call("psi_ask", { question: "Which ending?", kind: "why" })).blocked,
		{ block: true, reason: ASK_AFTER_TEACHING });
	assert.ok((await f.call("psi_challenge", greet)).blocked, "no new challenge before the repair");
	await f.assistant([text(teaching)]);
	assert.ok((await f.call("psi_challenge", greet)).result, "allowed once the repair taught something");
	await f.learner("Give me another one");
	assert.ok((await f.call("psi_ask", { question: "Which ending?", kind: "why" })).result, "only the next turn is gated");
}));
