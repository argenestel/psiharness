import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Load dependencies before registering tests; skip only when core is unavailable.
let extension: typeof import("../src/index.ts").default | undefined;
let missingCore: string | undefined;
try {
	await import("../../core/src/index.ts");
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
	missingCore = `Core store is not available yet: ${String(error)}`;
}
if (!missingCore) extension = (await import("../src/index.ts")).default;
async function load(t: { skip: (reason: string) => void }) {
	if (missingCore) t.skip(missingCore);
	return extension;
}

type Tool = { execute: (...args: any[]) => Promise<any> };
type Handler = (event: any, ctx: any) => Promise<any>;
function fake() {
	const tools = new Map<string, Tool>();
	const commands = new Map<string, { handler: Handler }>();
	const handlers = new Map<string, Handler[]>();
	const entries: any[] = [];
	const flags = new Map<string, string | boolean>();
	const messages: string[] = [];
	const notifications: string[] = [];
	const statuses: string[] = [];
	const widgets: unknown[] = [];
	const api = {
		registerTool: (tool: Tool & { name: string }) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
		registerFlag: (name: string, options: { default?: boolean | string }) => {
			if (options.default !== undefined) flags.set(name, options.default);
		},
		getFlag: (name: string) => flags.get(name),
		on: (event: string, handler: Handler) => handlers.set(event, [...handlers.get(event) ?? [], handler]),
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		sendUserMessage: (message: string) => messages.push(message),
		sendMessage: (message: { content: string }) => messages.push(message.content),
	} as unknown as ExtensionAPI;
	const ctx = {
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (_key: string, text: string) => statuses.push(text),
			setWidget: (_key: string, text: unknown) => widgets.push(text),
		},
		sessionManager: { getBranch: () => entries, getEntries: () => entries },
	} as unknown as ExtensionContext;
	const fire = async (event: string, value: unknown = {}) => {
		const results = [];
		for (const handler of handlers.get(event) ?? []) results.push(await handler(value, ctx));
		return results;
	};
	const execute = (name: string, params: unknown) => tools.get(name)!.execute("test", params, undefined, undefined, ctx);
	return { api, ctx, tools, commands, handlers, entries, flags, messages, statuses, widgets, fire, execute };
}

async function fixture(t: Parameters<typeof load>[0], run: (f: ReturnType<typeof fake>) => Promise<void>) {
	const extension = await load(t);
	if (!extension) return;
	const home = mkdtempSync(join(tmpdir(), "psi-extension-"));
	const previous = process.env.PSI_HOME;
	process.env.PSI_HOME = home;
	try { const f = fake(); extension(f.api); await run(f); }
	finally {
		if (previous === undefined) delete process.env.PSI_HOME; else process.env.PSI_HOME = previous;
		rmSync(home, { recursive: true, force: true });
	}
}

test("registers all tools, commands, and session flags", async (t) => fixture(t, async (f) => {
	assert.deepEqual([...f.tools.keys()].sort(), [
		"psi_concept_graph", "psi_lesson_plan", "psi_cards_add", "psi_review_next", "psi_review_grade", "psi_mastery",
		"psi_storyboard", "psi_explorable", "psi_manim", "psi_crew", "psi_note",
	].sort());
	assert.deepEqual([...f.commands.keys()].sort(), [
		"learn", "map", "lesson", "quiz", "review", "visualize", "explore", "crew", "studio", "progress", "tutor",
	].sort());
	assert.ok(f.handlers.has("session_start"));
	assert.ok(f.handlers.has("before_agent_start"));
}));

test("tutor prompt appends context, restores state, and switches off", async (t) => fixture(t, async (f) => {
	await f.fire("session_start");
	assert.equal((await f.fire("before_agent_start", { systemPrompt: "Original system" }))[0], undefined);
	await f.commands.get("learn")!.handler("Linear Algebra", f.ctx);
	assert.match(f.messages[0], /diagnose my prior knowledge/);
	await f.execute("psi_note", { note: "Confuses vectors with points." });
	await f.fire("session_start");
	const result = (await f.fire("before_agent_start", { systemPrompt: "Original system" }))[0];
	assert.ok(result.systemPrompt.startsWith("Original system\n\n"));
	assert.match(result.systemPrompt, /Active topic: linear-algebra/);
	assert.match(result.systemPrompt, /Confuses vectors with points/);
	assert.match(result.systemPrompt, /Due-card count: 0/);
	assert.match(result.systemPrompt, /Never fake mastery/);
	await f.commands.get("tutor")!.handler("off", f.ctx);
	await f.fire("session_start");
	assert.equal((await f.fire("before_agent_start", { systemPrompt: "Original system" }))[0], undefined);
	assert.equal(f.widgets.at(-1), undefined);
}));

test("flags start tutoring and a fresh session clears old topic", async (t) => fixture(t, async (f) => {
	f.flags.set("psi-topic", "Probability");
	await f.fire("session_start");
	const prompt = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.match(prompt, /Active topic: probability/);
	f.flags.delete("psi-topic");
	f.entries.length = 0;
	await f.fire("session_start");
	assert.equal((await f.fire("before_agent_start", { systemPrompt: "Base" }))[0], undefined);
}));

const concept = { id: "vectors", title: "Vectors", summary: "Directed quantities", prerequisites: [], difficulty: 1 };

test("invalid graphs return errors without saving; valid graph supports lessons", async (t) => fixture(t, async (f) => {
	const invalid = await f.execute("psi_concept_graph", {
		topic: "algebra", title: "Algebra", bigIdea: "See structure", concepts: [{ ...concept, prerequisites: ["missing"] }],
	});
	assert.ok(invalid.details.errors.length > 0);
	const result = await f.execute("psi_concept_graph", {
		topic: "algebra", title: "Algebra", bigIdea: "See structure", concepts: [concept],
	});
	assert.match(result.details.mermaid, /vectors/);
	await f.commands.get("learn")!.handler("algebra", f.ctx);
	await f.commands.get("lesson")!.handler("", f.ctx);
	assert.match(f.messages.at(-1)!, /vectors/);
	const prompt = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.match(prompt, /Current lesson: vectors/);
	assert.equal((await f.execute("psi_lesson_plan", {})).details.frontier[0].id, "vectors");
}));

test("cards add and grade round-trip through real FSRS and mastery storage", async (t) => fixture(t, async (f) => {
	const added = await f.execute("psi_cards_add", { topic: "algebra", cards: [
		{ conceptId: "vectors", kind: "recall", prompt: "What is a vector?", answer: "A directed quantity." },
		{ conceptId: "vectors", kind: "predict", prompt: "What does scaling do?", answer: "Changes magnitude." },
	] });
	assert.equal(added.details.cards.length, 2);
	const card = (await f.execute("psi_review_next", { topic: "algebra" })).details.card;
	assert.equal(card.id, added.details.cards[0].id);
	const graded = await f.execute("psi_review_grade", { topic: "algebra", cardId: card.id, rating: 3 });
	assert.equal(graded.details.card.fsrs.reps, 1);
	assert.equal(graded.details.masteryChange.after.attempts, 1);
	assert.equal(graded.details.masteryChange.after.correct, 1);
	assert.ok(graded.details.masteryChange.after.pKnown < 0.95);
	assert.equal(graded.details.next.id, added.details.cards[1].id);
	assert.equal(graded.details.remaining, 1);
	await assert.rejects(f.execute("psi_review_grade", { topic: "algebra", cardId: card.id, rating: 5 }), /1–4/);
	await f.commands.get("learn")!.handler("algebra", f.ctx);
	assert.equal(f.statuses.at(-1), "ψ algebra · 0/0 mastered · 1 due");
}));

test("tool output truncates large results", async (t) => fixture(t, async () => {
	const { toolResult } = await import("../src/tools.ts");
	const result = toolResult({ output: "x".repeat(40000) });
	assert.equal((result.details as { truncated: boolean }).truncated, true);
	assert.ok(result.content[0].text.length < 17000);
}));


test("render tools return validation errors or saved absolute HTML paths", async (t) => fixture(t, async (f) => {
	const sb = { id: "vectors", title: "Vectors", topic: "algebra", style: "3b1b", scenes: [
		{ id: "hook", narration: "Predict where the arrow goes.", durationSec: 3, elements: [
			{ id: "arrow", kind: "vector", props: { x: 200, y: 300, dx: 100, dy: 50 } },
		] },
	] };
	const invalid = await f.execute("psi_storyboard", { storyboard: { ...sb, style: "unknown" } });
	assert.ok(invalid.details.errors.length);
	const rendered = await f.execute("psi_storyboard", { storyboard: sb });
	assert.equal(isAbsolute(rendered.details.path), true);
	assert.match(readFileSync(rendered.details.path, "utf8"), /<html/);
	assert.match(rendered.content[0].text, /\/studio/);
	const spec = { id: "plot", title: "Scale a line", topic: "algebra", style: "3b1b",
		template: "function-plot", params: { fn: "a*x", domain: [-5, 5] },
		sliders: [{ name: "a", label: "Scale", min: -2, max: 2, step: 0.1, value: 1 }],
		prompts: ["Predict what changing scale does."],
	};
	const explorable = await f.execute("psi_explorable", { spec });
	assert.equal(isAbsolute(explorable.details.path), true);
	assert.match(readFileSync(explorable.details.path, "utf8"), /<html/);
	const manim = await f.execute("psi_manim", { topic: "algebra", storyboardId: "vectors" });
	assert.equal(isAbsolute(manim.details.outputs[0]), true);
	assert.match(readFileSync(manim.details.outputs[0], "utf8"), /psi_manim/);
}));

test("lesson plan and learner notes persist through the shared store", async (t) => fixture(t, async (f) => {
	await f.execute("psi_concept_graph", {
		topic: "algebra", title: "Algebra", bigIdea: "See structure", concepts: [concept],
	});
	const plan = { topic: "algebra", goal: "Understand vectors", learnerLevel: "curious", lessons: [
		{ conceptId: "vectors", objective: "Predict scaling", beats: [], visuals: [], checks: [], status: "planned" },
	], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
	const result = await f.execute("psi_lesson_plan", { plan, targetId: "vectors" });
	assert.equal(result.details.plan.lessons[0].objective, "Predict scaling");
	assert.deepEqual(result.details.path, ["vectors"]);
	const invalid = await f.execute("psi_lesson_plan", {
		plan: { ...plan, lessons: [{ ...plan.lessons[0], conceptId: "missing" }] },
	});
	assert.ok(invalid.details.errors.length);
	await f.execute("psi_note", { topic: "algebra", note: "Uses geometric reasoning." });
	await f.execute("psi_note", { topic: "algebra", note: "Needs a concrete example." });
	await f.commands.get("learn")!.handler("algebra", f.ctx);
	const prompt = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.match(prompt, /Uses geometric reasoning/);
	assert.match(prompt, /Needs a concrete example/);
}));
