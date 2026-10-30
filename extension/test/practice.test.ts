import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Handler = (...args: any[]) => Promise<any>;
type Tool = { name: string; execute: Handler; renderCall?: (...args: any[]) => { render(width: number): string[] } };

function fake() {
	const tools = new Map<string, Tool>();
	const commands = new Map<string, { handler: Handler }>();
	const handlers = new Map<string, Handler[]>();
	const flags = new Map<string, string | boolean>();
	const registeredFlags: string[] = [];
	const entries: any[] = [];
	const messages: string[] = [];
	const notifications: string[] = [];
	const statuses: (string | undefined)[] = [];
	const widgets: (string[] | undefined)[] = [];
	const api = {
		registerTool: (tool: Tool) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
		registerFlag: (name: string) => registeredFlags.push(name),
		getFlag: (name: string) => flags.get(name),
		on: (name: string, handler: Handler) => handlers.set(name, [...handlers.get(name) ?? [], handler]),
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		sendUserMessage: (message: string) => messages.push(message),
		sendMessage: (message: { content: string }) => messages.push(message.content),
	} as unknown as ExtensionAPI;
	const ctx = {
		sessionManager: { getBranch: () => entries },
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (_key: string, text: string | undefined) => statuses.push(text),
			setWidget: (_key: string, lines: string[] | undefined) => widgets.push(lines),
		},
	} as unknown as ExtensionContext;
	const fire = async (name: string, event: unknown = {}) => {
		const results = [];
		for (const handler of handlers.get(name) ?? []) results.push(await handler(event, ctx));
		return results;
	};
	const execute = (name: string, params: unknown) => tools.get(name)!.execute("test", params, undefined, undefined, ctx);
	const command = (name: string, args = "") => commands.get(name)!.handler(args, ctx);
	return { api, ctx, tools, commands, handlers, flags, registeredFlags, entries, messages,
		notifications, statuses, widgets, fire, execute, command };
}

const missingCore = ["memory", "practice", "gamify"].find((module) =>
	!existsSync(new URL(`../../core/src/${module}.ts`, import.meta.url)));
const registerPractice = missingCore ? undefined : (await import("../src/practice/index.ts")).registerPractice;

async function fixture(t: test.TestContext, run: (f: ReturnType<typeof fake>, home: string) => Promise<void>) {
	if (!registerPractice) { t.skip(`Core ${missingCore}.ts is not available yet.`); return; }
	const home = mkdtempSync(join(tmpdir(), "psi-practice-extension-"));
	const f = fake();
	try { registerPractice(f.api, { home }); await run(f, home); }
	finally { await f.fire("session_shutdown"); rmSync(home, { recursive: true, force: true }); }
}

const draft = (overrides = {}) => ({
	skill: "sql", kind: "quickfire", level: 1, prompt: "What is 2 + 2?", expected: "4",
	hints: ["Count two pairs.", "Add one pair at a time."], ...overrides,
});
const plan = (overrides = {}) => ({
	skill: "sql", title: "SQL", targetPerformance: "Write a join", whyItMatters: "Query data",
	subskills: [{ id: "select", title: "Select", why: "Read data", priority: 1, prerequisites: [],
		selfCorrection: "Check the selected columns", drills: ["Select a column"], status: "active" }],
	resources: [], barriers: [], ...overrides,
});

test("registers every practice tool, command, lifecycle handler, and skill flag", async (t) => fixture(t, async (f) => {
	assert.deepEqual([...f.tools.keys()].sort(), ["psi_memory_remember", "psi_memory_recall", "psi_memory_forget",
		"psi_recap", "psi_skill_plan", "psi_challenge", "psi_attempt", "psi_hint", "psi_practice_session",
		"psi_progress_report"].sort());
	assert.deepEqual([...f.commands.keys()].sort(), ["skill", "practice", "challenge", "boss", "quest", "hint",
		"remember", "memory", "forget", "recap", "hours", "streak"].sort());
	assert.deepEqual(f.registeredFlags, ["psi-skill"]);
	assert.ok(f.handlers.has("before_agent_start"));
	assert.ok(f.handlers.has("session_start"));
}));

test("auto-grading overrides model grades and keeps answers private", async (t) => fixture(t, async (f) => {
	const c = await f.execute("psi_challenge", draft());
	assert.ok(c.details.challengeId);
	assert.ok(!JSON.stringify(c).includes('"expected"'));
	const call = f.tools.get("psi_challenge")!.renderCall!(draft(), {}, {});
	assert.equal(call.render(80).join("\n"), "ψ Practice challenge");
	const a = await f.execute("psi_attempt", {
		skill: "sql", challengeId: c.details.challengeId, answer: "4", outcome: "fail",
	});
	assert.equal(a.details.outcome, "success");
	assert.ok(a.details.xp > 0);
	const report = await f.execute("psi_progress_report", { skill: "sql" });
	assert.equal(report.details.skills[0].successes, 1);
}));

test("failed attempts earn XP, with extra XP for a recorded lesson", async (t) => fixture(t, async (f) => {
	const c = await f.execute("psi_challenge", draft());
	const base = { skill: "sql", challengeId: c.details.challengeId, answer: "9" };
	const failed = await f.execute("psi_attempt", base);
	const learned = await f.execute("psi_attempt", { ...base, lesson: "Count both pairs next time." });
	assert.equal(failed.details.outcome, "fail");
	assert.ok(failed.details.xp > 0);
	assert.ok(learned.details.xp > failed.details.xp);
	assert.match(failed.details.guidance, /what they will try differently/);
}));

test("open challenges require an honest explicit grade before recording", async (t) => fixture(t, async (f) => {
	const c = await f.execute("psi_challenge", draft({ expected: undefined, kind: "explain" }));
	const p = { skill: "sql", challengeId: c.details.challengeId, answer: "My explanation" };
	assert.match((await f.execute("psi_attempt", p)).details.errors[0], /explicit outcome/);
	assert.equal((await f.execute("psi_progress_report", {})).details.skills[0].attempts, 0);
	assert.equal((await f.execute("psi_attempt", { ...p, outcome: "partial" })).details.outcome, "partial");
}));

test("remember writes memory without a model call", async (t) => fixture(t, async (f, home) => {
	await f.command("remember", "I learn best from short concrete examples.");
	assert.equal(f.messages.length, 0);
	const { MemoryStore } = await import("../../core/src/memory.ts");
	const item = new MemoryStore(home).read().items[0];
	assert.equal(item.source, "learner");
	assert.match(item.text, /short concrete examples/);
	assert.match(f.notifications[0], /Remembered/);
}));

test("injection appends bounded memory, state, and tutor guidance", async (t) => fixture(t, async (f, home) => {
	await f.command("skill", "SQL");
	await f.command("remember", "Short concrete examples help me learn.");
	await f.command("practice", "joins 15");
	const injected = (await f.fire("before_agent_start", { systemPrompt: "Original system" }))[0].systemPrompt;
	assert.ok(injected.startsWith("Original system\n\n"));
	assert.match(injected, /## Learner memory/);
	assert.match(injected, /Short concrete examples/);
	assert.match(injected, /## Practice state\nActive skill: sql/);
	assert.match(injected, /\/15 minutes/);
	assert.match(injected, /psi_attempt/);
	assert.match(injected, /psi_recap/);
	assert.ok(injected.length - "Original system\n\n".length <= 2500);
	const { MemoryStore } = await import("../../core/src/memory.ts");
	new MemoryStore(home).setName("Long learner name ".repeat(300));
	const bounded = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.ok(bounded.length - "Base\n\n".length <= 2500);
	assert.match(bounded, /## Practice state/);
	assert.match(bounded, /End sessions with psi_practice_session stop and psi_recap/);
}));

test("session restores skill, honors flags, and welcomes the learner", async (t) => fixture(t, async (f, home) => {
	const { MemoryStore } = await import("../../core/src/memory.ts");
	const memory = new MemoryStore(home);
	memory.setName("Ada");
	memory.addRecap({ summary: "Practiced selects", next: "Try joins", wins: [], struggles: [], minutes: 10 });
	await f.command("skill", "SQL");
	await f.fire("session_start");
	assert.match(f.statuses.at(-1)!, /ψ sql/);
	assert.match(f.notifications.at(-1)!, /Welcome back Ada — last time: Practiced selects. Next: Try joins/);
	f.flags.set("psi-skill", "guitar");
	await f.fire("session_start");
	assert.match(f.statuses.at(-1)!, /ψ guitar/);
	f.flags.clear(); f.entries.length = 0;
	await f.fire("session_start");
	assert.equal(f.statuses.at(-1), undefined);
}));

test("plans default to 20 hours and reject invalid graphs", async (t) => fixture(t, async (f) => {
	const valid = await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	assert.equal(valid.details.plan.hoursGoal, 20);
	const next = await f.execute("psi_skill_plan", { action: "next" });
	assert.equal(next.details.nextSubskill.id, "select");
	assert.deepEqual(next.details.drills, ["Select a column"]);
	const bad = plan({ subskills: [
		{ ...plan().subskills[0], id: "not Kebab", priority: 4, prerequisites: ["missing"] },
		{ ...plan().subskills[0], id: "loop", prerequisites: ["loop"] },
	] });
	const invalid = await f.execute("psi_skill_plan", { action: "update", plan: bad });
	assert.match(invalid.content[0].text, /kebab-case/);
	assert.match(invalid.content[0].text, /priority/);
	assert.match(invalid.content[0].text, /Unknown prerequisite/);
	assert.match(invalid.content[0].text, /cycle/);
	const saved = await f.execute("psi_skill_plan", { action: "get" });
	assert.equal(saved.details.plan.subskills[0].id, "select");
}));

test("hints clamp indices; stopping clears the widget", async (t) => fixture(t, async (f) => {
	await f.execute("psi_practice_session", { action: "start", skill: "sql", minutes: 12 });
	const c = await f.execute("psi_challenge", draft());
	assert.match(f.widgets.at(-1)!.join("\n"), /2 \+ 2/);
	await f.command("hint");
	assert.match(f.notifications.at(-1)!, /Hint 1\/2/);
	const hint = await f.execute("psi_hint", { skill: "sql", challengeId: c.details.challengeId, n: 99 });
	assert.equal(hint.details.n, 2);
	assert.equal(hint.details.clamped, true);
	await f.execute("psi_attempt", { skill: "sql", challengeId: c.details.challengeId, answer: "4" });
	const report = await f.execute("psi_progress_report", { skill: "sql" });
	assert.ok(report.details.skills[0].xp > 0);
	const stop = await f.execute("psi_practice_session", { action: "stop", skill: "sql" });
	assert.equal(stop.details.active, false);
	assert.equal(f.widgets.at(-1), undefined);
}));

test("default export installs both the practice layer and the concept layer", async () => {
	const names: string[] = [];
	const api = new Proxy({}, {
		get: (_t, key) => key === "registerTool" ? (tool: { name: string }) => names.push(tool.name) : () => undefined,
	}) as unknown as Parameters<typeof import("../src/index.ts").default>[0];
	(await import("../src/index.ts")).default(api);
	for (const name of ["psi_attempt", "psi_memory_remember", "psi_skill_plan", "psi_concept_graph", "psi_cards_add"]) {
		assert.ok(names.includes(name), name);
	}
});
