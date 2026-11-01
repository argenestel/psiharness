import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Load dependencies before registering tests; skip only when core is unavailable.
let extension: typeof import("../src/index.ts").registerConceptLayer | undefined;
let missingCore: string | undefined;
try {
	await import("../../core/src/index.ts");
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
	missingCore = `Core store is not available yet: ${String(error)}`;
}
if (!missingCore) extension = (await import("../src/index.ts")).registerConceptLayer;
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
		cwd: process.env.PSI_HOME ?? process.cwd(),
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
	const previousExec = process.env.PSI_CODE_EXEC;
	process.env.PSI_CODE_EXEC = "1";
	process.env.PSI_HOME = home;
	try { const f = fake(); extension(f.api); await run(f); }
	finally {
		if (previous === undefined) delete process.env.PSI_HOME; else process.env.PSI_HOME = previous;
		if (previousExec === undefined) delete process.env.PSI_CODE_EXEC; else process.env.PSI_CODE_EXEC = previousExec;
		rmSync(home, { recursive: true, force: true });
	}
}

test("registers all tools, commands, and session flags", async (t) => fixture(t, async (f) => {
	assert.deepEqual([...f.tools.keys()].sort(), [
		"psi_concept_graph", "psi_lesson_plan", "psi_cards_add", "psi_review_next", "psi_review_grade", "psi_mastery",
		"psi_storyboard", "psi_explorable", "psi_note",
		...(process.env.PSI_CODE_EXEC === "1" ? ["psi_manim", "psi_crew"] : []),
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

test("--psi-tutor=true arrives as a string and still enables tutor mode", async (t) => {
	const { flagEnabled } = await import("../src/tutor.ts");
	for (const value of [true, "true", "1", "TRUE", " yes "]) assert.equal(flagEnabled(value), true, String(value));
	for (const value of [false, "false", "0", "", undefined, "nope"]) assert.equal(flagEnabled(value), false, String(value));
	await fixture(t, async (f) => {
		f.flags.set("psi-tutor", "true");
		await f.fire("session_start");
		const result = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0];
		assert.match(result.systemPrompt, /Tutor mode: on/);
	});
	await fixture(t, async (f) => {
		f.flags.set("psi-tutor", "false");
		await f.fire("session_start");
		assert.equal((await f.fire("before_agent_start", { systemPrompt: "Base" }))[0], undefined);
	});
});

test("psi_note writes notes.md and the tutor injection reads it", async (t) => fixture(t, async (f) => {
	const saved = await f.execute("psi_note", { topic: "algebra", note: "Thinks dot product\nis a vector." });
	assert.equal(saved.details.saved, true);
	const notes = readFileSync(join(process.env.PSI_HOME!, "topics", "algebra", "notes.md"), "utf8");
	assert.match(notes, /^- \d{4}-.* Thinks dot product is a vector\.\n$/);
	assert.equal(saved.details.notes, 1);
	assert.ok((await f.execute("psi_note", { topic: "algebra", note: "   " })).details.errors);
	await f.commands.get("learn")!.handler("algebra", f.ctx);
	const prompt = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.match(prompt, /Thinks dot product is a vector/);
}));

test("psi_lesson_plan validates targetId before saving the plan", async (t) => fixture(t, async (f) => {
	await f.execute("psi_concept_graph", { topic: "algebra", title: "Algebra", bigIdea: "See structure", concepts: [concept] });
	const plan = { topic: "algebra", goal: "Understand vectors", learnerLevel: "curious", lessons: [
		{ conceptId: "vectors", objective: "Predict scaling", beats: [], visuals: [], checks: [], status: "planned" },
	], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
	const bad = await f.execute("psi_lesson_plan", { topic: "algebra", plan, targetId: "missing" });
	assert.deepEqual(bad.details.errors, ["Unknown concept: missing"]);
	assert.equal(existsSync(join(process.env.PSI_HOME!, "topics", "algebra", "plan.json")), false);
}));

test("psi_storyboard forwards speech and autoplay to the HTML player", async (t) => fixture(t, async (f) => {
	const sb = { id: "talk", title: "Talk", topic: "algebra", style: "plain", scenes: [
		{ id: "one", narration: "Listen.", durationSec: 2, elements: [] },
	] };
	const quiet = readFileSync((await f.execute("psi_storyboard", { storyboard: sb })).details.path, "utf8");
	assert.match(quiet, /"autoplay":false/);
	const spoken = readFileSync((await f.execute("psi_storyboard", { storyboard: sb, speech: true, autoplay: true }))
		.details.path, "utf8");
	assert.match(spoken, /"autoplay":true/);
	assert.match(spoken, /"speech":true/);
}));

test("psi_manim with storyboardId and render returns the .py source alongside render results", async (t) => {
	if (process.platform === "win32") return;
	const bin = mkdtempSync(join(tmpdir(), "psi-ext-manim-"));
	const previous = process.env.PATH;
	try {
		writeFileSync(join(bin, "manim"), `#!${process.execPath}\nimport fs from "node:fs"; import path from "node:path";\n`
			+ 'const a = process.argv.slice(2); if (!a.includes("--media_dir")) process.exit(0);\n'
			+ 'const m = a[a.indexOf("--media_dir") + 1]; fs.mkdirSync(m, { recursive: true });\n'
			+ 'fs.writeFileSync(path.join(m, "Talk.mp4"), "v");\n');
		chmodSync(join(bin, "manim"), 0o755);
		process.env.PATH = bin;
		await fixture(t, async (f) => {
			await f.execute("psi_storyboard", { storyboard: { id: "talk", title: "Talk", topic: "algebra", style: "plain",
				scenes: [{ id: "one", narration: "Listen.", durationSec: 1, elements: [] }] } });
			const result = await f.execute("psi_manim", { topic: "algebra", storyboardId: "talk", render: true, runner: "local" });
			assert.equal(result.details.ok, true, result.details.log);
			assert.match(result.details.source, /talk\.py$/);
			assert.equal(result.details.outputs[0], result.details.source);
			assert.match(result.details.outputs[1], /artifacts\/talk\.mp4$/);
			assert.match(result.details.media[0], /media\/Talk\.mp4$/);
			assert.equal(readFileSync(result.details.outputs[1], "utf8"), "v");
		});
	} finally {
		process.env.PATH = previous;
		rmSync(bin, { recursive: true, force: true });
	}
});

test("/studio dials the configured bind host instead of assuming localhost", async () => {
	const { studioHost } = await import("../src/commands.ts");
	assert.deepEqual(studioHost({}), { bind: "127.0.0.1", dial: "127.0.0.1" });
	assert.deepEqual(studioHost({ PSI_STUDIO_HOST: "0.0.0.0" }), { bind: "0.0.0.0", dial: "127.0.0.1" });
	assert.deepEqual(studioHost({ PSI_STUDIO_HOST: "::" }), { bind: "::", dial: "::1" });
	assert.deepEqual(studioHost({ HOST: "0.0.0.0" }), { bind: "127.0.0.1", dial: "127.0.0.1" });
	assert.deepEqual(studioHost({ PSI_STUDIO_HOST: "192.168.1.5", HOST: "x" }), { bind: "192.168.1.5", dial: "192.168.1.5" });
});

test("psi_manim publishes CamelCase scene videos under kebab-case artifact names", async (t) => {
	if (process.platform === "win32") return;
	const bin = mkdtempSync(join(tmpdir(), "psi-ext-manim-"));
	const previous = process.env.PATH;
	try {
		writeFileSync(join(bin, "manim"), `#!${process.execPath}\nimport fs from "node:fs"; import path from "node:path";\n`
			+ 'const a = process.argv.slice(2); if (!a.includes("--media_dir")) process.exit(0);\n'
			+ 'const m = a[a.indexOf("--media_dir") + 1]; fs.mkdirSync(m, { recursive: true });\n'
			+ 'fs.writeFileSync(path.join(m, a.at(-1) + ".mp4"), "v");\n');
		chmodSync(join(bin, "manim"), 0o755);
		process.env.PATH = bin;
		await fixture(t, async (f) => {
			const result = await f.execute("psi_manim", { topic: "algebra", runner: "local",
				code: "from manim import *\nclass ProjectionAlongTheRoad(Scene):\n    pass\n" });
			assert.equal(result.details.ok, true, result.details.log);
			assert.match(result.details.outputs[0], /artifacts\/projection-along-the-road\.mp4$/);
		});
	} finally {
		process.env.PATH = previous;
		rmSync(bin, { recursive: true, force: true });
	}
});

test("execution tools register only with exact PSI_CODE_EXEC opt-in and web policy names are registered", async () => {
	const { default: install } = await import("../src/index.ts");
	const { webToolNames } = await import("../src/tool-policy.ts");
	const home = mkdtempSync(join(tmpdir(), "psi-gates-"));
	const before = { home: process.env.PSI_HOME, exec: process.env.PSI_CODE_EXEC };
	try {
		process.env.PSI_HOME = home;
		for (const enabled of [undefined, "0", "true", "1"]) {
			if (enabled === undefined) delete process.env.PSI_CODE_EXEC; else process.env.PSI_CODE_EXEC = enabled;
			const f = fake();
			install(f.api);
			for (const name of ["psi_run", "psi_manim", "psi_crew"]) assert.equal(f.tools.has(name), enabled === "1");
			assert.deepEqual(webToolNames(), [...f.tools.keys()].sort());
		}
	} finally {
		if (before.home === undefined) delete process.env.PSI_HOME; else process.env.PSI_HOME = before.home;
		if (before.exec === undefined) delete process.env.PSI_CODE_EXEC; else process.env.PSI_CODE_EXEC = before.exec;
		rmSync(home, { recursive: true, force: true });
	}
});

test("web read hook allows canonical data files and blocks traversal and symlink escapes", async () => {
	const { symlinkSync } = await import("node:fs");
	const { default: install } = await import("../src/index.ts");
	const home = mkdtempSync(join(tmpdir(), "psi-read-"));
	const root = join(home, "data");
	const { mkdirSync } = await import("node:fs");
	mkdirSync(root);
	writeFileSync(join(root, "allowed"), "ok");
	writeFileSync(join(home, "secret"), "secret");
	symlinkSync(join(home, "secret"), join(root, "escape"));
	const previous = { root: process.env.PSI_WEB_READ_ROOT, home: process.env.PSI_HOME };
	try {
		process.env.PSI_HOME = process.env.PSI_WEB_READ_ROOT = root;
		const f = fake();
		install(f.api);
		for (const path of ["../secret", join(home, "secret"), "escape", "missing", undefined]) {
			const results = await f.fire("tool_call", { toolName: "read", input: { path } });
			assert.ok(results.some((result) => result?.block));
		}
		const relativeEvent = { toolName: "read", input: { path: "allowed" } };
		assert.ok((await f.fire("tool_call", relativeEvent)).every((result) => !result?.block));
		assert.equal(relativeEvent.input.path, join(root, "allowed"));
		const event = { toolName: "read", input: { path: join(root, "allowed") } };
		assert.ok((await f.fire("tool_call", event)).every((result) => !result?.block));
		assert.equal(event.input.path, join(root, "allowed"));
		assert.ok((await f.fire("tool_call", { toolName: "psi_note", input: {} })).every((r) => !r?.block));
		// The tutor may read psi's bundled skills, but not the rest of the repository.
		const skill = fileURLToPath(new URL("../../skills/teach-first/SKILL.md", import.meta.url));
		assert.ok((await f.fire("tool_call", { toolName: "read", input: { path: skill } })).every((r) => !r?.block));
		const outside = fileURLToPath(new URL("../../package.json", import.meta.url));
		assert.ok((await f.fire("tool_call", { toolName: "read", input: { path: outside } })).some((r) => r?.block));
	} finally {
		if (previous.root === undefined) delete process.env.PSI_WEB_READ_ROOT;
		else process.env.PSI_WEB_READ_ROOT = previous.root;
		if (previous.home === undefined) delete process.env.PSI_HOME; else process.env.PSI_HOME = previous.home;
		rmSync(home, { recursive: true, force: true });
	}
});
