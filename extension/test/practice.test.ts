import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
	const flagTypes = new Map<string, string>();
	const entries: any[] = [];
	const messages: string[] = [];
	const notifications: string[] = [];
	const statuses: (string | undefined)[] = [];
	const widgets: (string[] | undefined)[] = [];
	const api = {
		registerTool: (tool: Tool) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
		registerFlag: (name: string, options: { type: string }) => {
			registeredFlags.push(name); flagTypes.set(name, options.type);
		},
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
		notifications, statuses, widgets, fire, execute, command, flagTypes };
}

const missingCore = ["memory", "practice", "gamify"].find((module) =>
	!existsSync(new URL(`../../core/src/${module}.ts`, import.meta.url)));
const registerPractice = missingCore ? undefined : (await import("../src/practice/index.ts")).registerPractice;

async function fixture(t: test.TestContext, run: (f: ReturnType<typeof fake>, home: string) => Promise<void>) {
	if (!registerPractice) { t.skip(`Core ${missingCore}.ts is not available yet.`); return; }
	const home = mkdtempSync(join(tmpdir(), "psi-practice-extension-"));
	const previousHome = process.env.PSI_HOME;
	process.env.PSI_HOME = home;
	const f = fake();
	try { registerPractice(f.api); await run(f, home); }
	finally {
		await f.fire("session_shutdown");
		if (previousHome === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previousHome;
		rmSync(home, { recursive: true, force: true });
	}
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
	await f.execute("psi_practice_session", { action: "start", minutes: 15 });
	const injected = (await f.fire("before_agent_start", { systemPrompt: "Original system" }))[0].systemPrompt;
	assert.ok(injected.startsWith("Original system\n\n"));
	assert.match(injected, /## Learner memory/);
	assert.match(injected, /Short concrete examples/);
	assert.match(injected, /## Practice state\nActive skill: sql/);
	assert.match(injected, /\/15 minutes/);
	assert.match(injected, /psi_attempt/);
	assert.match(injected, /psi_recap/);
	assert.match(injected, /LaTeX: \$\.\.\.\$ inline and \$\$\.\.\.\$\$ display/);
	assert.match(injected, /worked example -> faded example -> independent problem/);
	assert.match(injected, /code challenges with tests/);
	assert.match(injected, /units and orders of magnitude/);
	assert.match(injected, /prediction before running code/);
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
	assert.match(f.statuses.at(-1)!, /ψ guitar/);
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

test("default export installs both the practice layer and the concept layer", async (t) => fixture(t, async () => {
	const names: string[] = [];
	const api = new Proxy({}, {
		get: (_t, key) => key === "registerTool" ? (tool: { name: string }) => names.push(tool.name) : () => undefined,
	}) as unknown as Parameters<typeof import("../src/index.ts").default>[0];
	(await import("../src/index.ts")).default(api);
	for (const name of ["psi_attempt", "psi_memory_remember", "psi_skill_plan", "psi_concept_graph", "psi_cards_add"]) {
		assert.ok(names.includes(name), name);
	}
}));

test("fresh registrations resume active skill and open challenge without session entries", async (t) => fixture(t, async (f) => {
	await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	const challenge = await f.execute("psi_challenge", draft({ skill: undefined }));
	const second = fake();
	registerPractice!(second.api);
	try {
		assert.equal(second.entries.length, 0);
		for (const startSession of [false, true]) {
			if (startSession) await second.fire("session_start");
			const prompt = (await second.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
			assert.match(prompt, /Active skill: sql/);
			assert.match(prompt, /Next subskill: select: Select/);
			assert.ok(prompt.includes(challenge.details.challengeId));
			assert.match(prompt, /"kind":"quickfire","format":"text","prompt":"What is 2 \+ 2\?"/);
			assert.match(prompt, /do not search files/);
		}
		const attempt = await second.execute("psi_attempt", { challengeId: challenge.details.challengeId, answer: "4" });
		assert.equal(attempt.details.outcome, "success");
		const third = fake();
		registerPractice!(third.api);
		try {
			const prompt = (await third.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
			assert.match(prompt, /Active skill: sql/);
			assert.match(prompt, /OPEN challenge: none/);
		} finally { await third.fire("session_shutdown"); }
	} finally { await second.fire("session_shutdown"); }
}));

test("skill selection and session start persist, and session entries take precedence", async (t) => fixture(t, async (f, home) => {
	const { StateStore } = await import("../../core/src/state.ts");
	const saved = new StateStore(home);
	await f.command("skill", "Physics");
	assert.equal(saved.read().activeSkill, "physics");
	await f.execute("psi_practice_session", { action: "start", skill: "sql" });
	assert.equal(saved.read().activeSkill, "sql");
	await f.execute("psi_practice_session", { action: "stop" });
	await f.execute("psi_challenge", draft());
	saved.update({ activeSkill: "physics", openChallenge: undefined });
	await f.fire("session_start");
	const prompt = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.match(prompt, /Active skill: sql/);
	assert.match(prompt, /What is 2/);
}));

test("challenge validation rejects invalid choices and incomplete code without persisting", async (t) => fixture(t, async (f, home) => {
	const { PracticeStore } = await import("../../core/src/practice.ts");
	for (const overrides of [
		{ format: "choice" }, { format: "choice", choices: ["1", "2"] },
		{ format: "choice", choices: ["4"] }, { format: "choice", choices: ["4", "4"] },
		{ format: "choice", choices: ["4", " "] }, { format: "choice", choices: [4, "4"] },
		{ format: "code", language: "python" }, { format: "code", tests: "assert True" },
		{ format: "code", language: "ruby", tests: "assert true" },
		{ format: "code", language: "python", tests: " " },
	]) {
		const rejected = await f.execute("psi_challenge", draft(overrides));
		assert.ok(rejected.details.errors?.length, JSON.stringify(overrides));
	}
	assert.equal(new PracticeStore(home).listChallenges("sql").length, 0);
	const accepted = await f.execute("psi_challenge", draft({ format: "choice", choices: ["3", "4"] }));
	assert.deepEqual(accepted.details.widget.choices, ["3", "4"]);
}));

test("challenge widgets carry browser fields while content hides answers and code internals", async (t) => fixture(t, async (f) => {
	const text = await f.execute("psi_challenge", draft({ expected: "PRIVATE_ANSWER", acceptable: ["ALTERNATE"] }));
	assert.deepEqual(text.details.widget, {
		type: "challenge", skill: "sql", id: text.details.challengeId, kind: "quickfire", level: 1,
		format: "text", prompt: "What is 2 + 2?", choices: undefined, unit: undefined,
		language: undefined, starterCode: undefined, hintsCount: 2,
	});
	assert.equal(text.content[0].text, "The challenge card is shown to the learner; wait for their answer");
	assert.doesNotMatch(JSON.stringify(text), /PRIVATE_ANSWER|ALTERNATE|expected/);
	for (const language of ["python", "javascript", "sql"]) {
		const code = await f.execute("psi_challenge", draft({
			format: "code", language, setup: "PRIVATE_SETUP", tests: "PRIVATE_TESTS", starterCode: "# start",
			expected: "PRIVATE_EXPECTED", unit: "m/s",
		}));
		assert.equal(code.details.widget.setup, "PRIVATE_SETUP");
		assert.equal(code.details.widget.tests, "PRIVATE_TESTS");
		assert.equal(code.details.widget.language, language);
		assert.equal(code.details.widget.starterCode, "# start");
		assert.equal(code.details.widget.unit, "m/s");
		assert.doesNotMatch(code.content[0].text, /PRIVATE_|setup|tests|expected/);
	}
}));

test("code attempts require run outcomes and return attempt widgets", async (t) => fixture(t, async (f) => {
	const c = await f.execute("psi_challenge", draft({ format: "code", language: "javascript", tests: "assert(ok)" }));
	const params = { challengeId: c.details.challengeId, answer: "4" };
	assert.match((await f.execute("psi_attempt", params)).details.errors[0], /code.*explicit outcome/);
	assert.equal((await f.execute("psi_progress_report", {})).details.skills[0].attempts, 0);
	const attempt = await f.execute("psi_attempt", { ...params, outcome: "fail" });
	assert.equal(attempt.details.outcome, "fail");
	assert.deepEqual(attempt.details.widget, {
		type: "attempt", outcome: "fail", xp: attempt.details.xp, level: attempt.details.level,
		levelBar: attempt.details.levelBar, leveledUp: attempt.details.leveledUp,
		badges: attempt.details.badges, streak: attempt.details.streak,
	});
	assert.ok(attempt.details.widget.xp > 0);
}));


test("before-agent fallback reads state written after registration", async (t) => fixture(t, async (f) => {
	const waiting = fake();
	registerPractice!(waiting.api);
	try {
		await f.command("skill", "Physics");
		const c = await f.execute("psi_challenge", draft({ skill: undefined }));
		const prompt = (await waiting.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
		assert.match(prompt, /Active skill: physics/);
		assert.ok(prompt.includes(c.details.challengeId));
		await waiting.execute("psi_hint", { challengeId: c.details.challengeId, n: 1 });
		await waiting.execute("psi_memory_remember", { kind: "goal", text: "Learn motion" });
		const recalled = await waiting.execute("psi_memory_recall", {});
		assert.equal(recalled.details.items[0].skill, "physics");
	} finally { await waiting.fire("session_shutdown"); }
}));

test("plans refuse accidental replacement and merge updates without losing progress", async (t) => fixture(t, async (f, home) => {
	const created = await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	assert.equal(created.details.plan.title, "SQL");
	const file = join(home, "skills/sql/plan.json");
	const before = readFileSync(file, "utf8");
	const refused = await f.execute("psi_skill_plan", { action: "create", plan: plan({ title: "Replacement" }) });
	assert.match(refused.content[0].text, /already exists.*get.*update.*do not create/);
	assert.equal(readFileSync(file, "utf8"), before);
	const added = { ...plan().subskills[0], id: "joins", title: "Joins", status: "locked" };
	await f.execute("psi_skill_plan", { action: "update", plan: { skill: "sql", subskills: [added] } });
	const merged = await f.execute("psi_skill_plan", { action: "update", overwrite: true,
		plan: { skill: "sql", title: "Updated", subskills: [{ id: "select", status: "solid" }] } });
	assert.deepEqual(merged.details.plan.subskills.map((s: any) => [s.id, s.status]),
		[["select", "active"], ["joins", "locked"]]);
	const removed = await f.execute("psi_skill_plan", { action: "update", plan: { skill: "sql" },
		removeSubskillIds: ["joins"] });
	assert.equal(removed.details.plan.subskills.length, 1);
	const overwritten = await f.execute("psi_skill_plan", { action: "create", overwrite: true,
		plan: plan({ title: "Start over" }) });
	assert.equal(overwritten.details.overwritten, true);
	assert.match(overwritten.content[0].text, /overwritten.*explicit start-over/);
	assert.equal(JSON.parse(readFileSync(file, "utf8")).title, "Start over");
}));

test("next selects the next subskill, then other priorities, then latest still-missed challenges", async (t) => fixture(t, async (f, home) => {
	await f.execute("psi_skill_plan", { action: "create", plan: plan({ subskills: [
		{ ...plan().subskills[0], priority: 2 }, { ...plan().subskills[0], id: "later", priority: 3 },
		{ ...plan().subskills[0], id: "middle", priority: 1, prerequisites: ["select"] },
	] }) });
	const later = await f.execute("psi_challenge", draft({ subskillId: "later" }));
	const middle = await f.execute("psi_challenge", draft({ subskillId: "middle" }));
	const first = await f.execute("psi_challenge", draft({ subskillId: "select" }));
	const next = () => f.execute("psi_challenge", { action: "next" });
	const grade = (id: string, answer: string) => f.execute("psi_attempt", { challengeId: id, answer });
	assert.equal((await next()).details.challengeId, first.details.challengeId);
	const { StateStore } = await import("../../core/src/state.ts");
	assert.equal(new StateStore(home).read().openChallenge?.id, first.details.challengeId);
	await grade(first.details.challengeId, "wrong");
	assert.equal((await next()).details.challengeId, middle.details.challengeId);
	await grade(middle.details.challengeId, "wrong");
	assert.equal((await next()).details.challengeId, later.details.challengeId);
	await grade(later.details.challengeId, "4");
	const { PracticeStore } = await import("../../core/src/practice.ts");
	const store = new PracticeStore(home);
	store.recordAttempt({ challengeId: middle.details.challengeId, answer: "wrong", outcome: "fail",
		hintsUsed: 0, at: "2099-01-01T00:00:00Z" });
	assert.equal((await next()).details.challengeId, middle.details.challengeId);
	store.recordAttempt({ challengeId: middle.details.challengeId, answer: "4", outcome: "success",
		hintsUsed: 0, at: "2099-01-02T00:00:00Z" });
	assert.equal((await next()).details.challengeId, first.details.challengeId);
	await grade(first.details.challengeId, "4");
	assert.match((await next()).content[0].text, /No challenges remain.*action.*create/);
}));

test("next widgets match create and never leak expected answers into model text", async (t) => fixture(t, async (f) => {
	for (const language of [undefined, "sql", "python", "javascript"]) {
		const created = await f.execute("psi_challenge", draft({ expected: "SECRET_ROWS",
			...(language ? { format: "code", language, tests: "PRIVATE_TESTS", setup: "PRIVATE_SETUP" } : {}) }));
		const next = await f.execute("psi_challenge", { action: "next", skill: "sql" });
		assert.deepEqual(next.details.widget, created.details.widget);
		assert.doesNotMatch(JSON.stringify(next.content), /SECRET_ROWS|expected|PRIVATE_/);
		assert.equal(next.details.widget.expected, language === "sql" ? "SECRET_ROWS" : undefined);
		await f.execute("psi_attempt", { challengeId: next.details.challengeId, answer: "SECRET_ROWS", outcome: "success" });
	}
}));

test("saved-plan injection counts ready challenges and preserves instructions within budget", async (t) => fixture(t, async (f, home) => {
	await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	const first = await f.execute("psi_challenge", draft());
	await f.execute("psi_attempt", { challengeId: first.details.challengeId, answer: "4" });
	await f.execute("psi_challenge", draft({ prompt: "Long prompt ".repeat(1000) }));
	const { MemoryStore } = await import("../../core/src/memory.ts");
	new MemoryStore(home).setName("Long learner name ".repeat(300));
	const text = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.ok(text.includes("SQL has a saved plan (1 steps, next: Select) and 2 ready challenges (1 not tried). "
		+ "Do NOT create a new plan; use psi_challenge action next to serve ready challenges before writing new ones."));
	assert.ok(text.includes("Skill files are optional reference: read at most one SKILL.md only when you need a "
		+ "technique you don't know; start practising immediately."));
	assert.ok(text.length - "Base\n\n".length <= 2500);
}));

test("practice prompts start sessions and serve ready challenges without replanning", async (t) => fixture(t, async (f) => {
	await f.command("skill", "SQL");
	await f.command("practice");
	assert.match(f.messages.at(-1)!, /First call psi_practice_session with action start/);
	assert.match(f.messages.at(-1)!, /No plan exists.*psi_skill_plan create/);
	await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	await f.command("practice");
	assert.match(f.messages.at(-1)!, /saved plan exists.*no planning step/);
	assert.match(f.messages.at(-1)!, /psi_challenge with action "next"/);
	assert.doesNotMatch(f.messages.at(-1)!, /psi_skill_plan create/);
	await f.execute("psi_practice_session", { action: "start" });
	await f.command("practice");
	assert.doesNotMatch(f.messages.at(-1)!, /First call.*start/);
}));

test("string psi-skill flag selects the exact imported slug", async (t) => fixture(t, async (f, home) => {
	assert.equal(f.flagTypes.get("psi-skill"), "string");
	f.flags.set("psi-skill", "python-foundations");
	await f.fire("session_start");
	const { StateStore } = await import("../../core/src/state.ts");
	assert.equal(new StateStore(home).read().activeSkill, "python-foundations");
	const text = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	assert.match(text, /Active skill: python-foundations/);
	assert.match(text, /No plan exists yet/);
	assert.doesNotMatch(text, /Do NOT create a new plan/);
}));
