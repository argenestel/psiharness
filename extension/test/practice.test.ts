import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
		"psi_ask", "psi_next_steps", ...(process.env.PSI_CODE_EXEC === "1" ? ["psi_run"] : []),
		"psi_progress_report", "psi_path", "psi_lesson", "psi_sources", "psi_fetch", "psi_search", "psi_verify"].sort());
	assert.deepEqual([...f.commands.keys()].sort(), ["skill", "practice", "challenge", "boss", "quest", "hint",
		"remember", "memory", "forget", "recap", "hours", "streak", "path", "mode", "verify", "sources"].sort());
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
	assert.equal(a.details.source, "checked");
	assert.equal(a.details.verified, true);
	assert.ok(a.details.xp > 0);
	const report = await f.execute("psi_progress_report", { skill: "sql" });
	assert.equal(report.details.skills[0].successes, 1);
}));

test("failed attempts earn XP, with extra XP for a recorded lesson", async (t) => fixture(t, async (f) => {
	const c = await f.execute("psi_challenge", draft());
	const base = { skill: "sql", challengeId: c.details.challengeId, answer: "9" };
	const failed = await f.execute("psi_attempt", base);
	const other = await f.execute("psi_challenge", draft());
	const learned = await f.execute("psi_attempt", { ...base, challengeId: other.details.challengeId,
		lesson: "Count both pairs next time." });
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
	assert.match(injected, /TEACH FIRST/);
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
	assert.match(text.content[0].text, /^The challenge card is shown to the learner; wait for their answer\./);
	// The model needs the real id so it never guesses one for psi_attempt.
	assert.ok(text.content[0].text.includes(`Challenge id: ${text.details.challengeId}`));
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
	assert.equal(attempt.details.source, "tutor");
	assert.equal(attempt.details.verified, false);
	assert.deepEqual(attempt.details.widget, {
		type: "attempt", combo: 0, comboBonus: 1, comboDisplayOnly: true, outcome: "fail", xp: attempt.details.xp,
		level: attempt.details.level,
		levelBar: attempt.details.levelBar, leveledUp: attempt.details.leveledUp,
		badges: attempt.details.badges, streak: attempt.details.streak,
	});
	assert.ok(attempt.details.widget.xp > 0);
}));

test("attempt resolution falls back to a unique challenge and reports ambiguity",
	async (t) => fixture(t, async (f, home) => {
	const duplicateId = "duplicate-id";
	for (const skill of ["sql", "other-skill"]) {
		const directory = join(home, "skills", skill);
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "challenges.json"), JSON.stringify([{
			id: duplicateId, skill, kind: "quickfire", level: 1, prompt: "Same id", expected: "4", hints: [],
			createdAt: new Date().toISOString(),
		}]));
	}
	const ambiguous = await f.execute("psi_attempt", { challengeId: duplicateId, answer: "4" });
	assert.match(ambiguous.details.errors[0], /several skills/);
	const unique = { id: "unique-id", skill: "sql", kind: "quickfire", level: 1, prompt: "Unique",
		expected: "4", hints: [], createdAt: new Date().toISOString() };
	writeFileSync(join(home, "skills/sql/challenges.json"), JSON.stringify([
		JSON.parse(readFileSync(join(home, "skills/sql/challenges.json"), "utf8"))[0], unique,
	]));
	const fallback = await f.execute("psi_attempt", { challengeId: unique.id, answer: "4" });
	assert.equal(fallback.details.outcome, "success");
	assert.equal(fallback.details.source, "checked");
	assert.equal(fallback.details.verified, true);
	const unknown = await f.execute("psi_attempt", { skill: "missing-skill", challengeId: unique.id, answer: "4" });
	assert.match(unknown.details.errors[0], /valid skill/);
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

test("next reports reasons, honors subskill focus, and delays immediate retries", async (t) => fixture(t, async (f, home) => {
	await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	const first = await f.execute("psi_challenge", draft({ subskillId: "select" }));
	const next = () => f.execute("psi_challenge", { action: "next", subskillId: "select" });
	const selected = await next();
	assert.equal(selected.details.challengeId, first.details.challengeId);
	assert.equal(selected.details.reason, "new");
	for (const key of ["expected", "acceptable", "answer", "rubric"]) {
		assert.equal(Object.hasOwn(selected.details.widget, key), false);
	}
	const { StateStore } = await import("../../core/src/state.ts");
	assert.equal(new StateStore(home).read().openChallenge?.id, first.details.challengeId);
	await f.execute("psi_attempt", { challengeId: first.details.challengeId, answer: "wrong" });
	assert.match((await next()).content[0].text, /No challenges remain/);
	const { PracticeStore } = await import("../../core/src/practice.ts");
	const store = new PracticeStore(home);
	for (let i = 0; i < 2; i++) {
		const c = store.addChallenge({ skill: "sql", subskillId: "select", kind: "apply", level: 1, prompt: "Other" });
		store.recordAttempt({ skill: "sql", challengeId: c.id, answer: "", outcome: "success", hintsUsed: 0 });
	}
	assert.equal((await next()).details.reason, "retry");
	assert.equal((await next()).details.challengeId, first.details.challengeId);
}));

test("next widgets match create and never leak expected answers into model text", async (t) => fixture(t, async (f) => {
	for (const language of [undefined, "sql", "python", "javascript"]) {
		const created = await f.execute("psi_challenge", draft({ expected: "SECRET_ROWS",
			...(language ? { format: "code", language, tests: "PRIVATE_TESTS", setup: "PRIVATE_SETUP" } : {}) }));
		const next = await f.execute("psi_challenge", { action: "next", skill: "sql" });
		assert.deepEqual(next.details.widget, created.details.widget);
		assert.equal(next.details.reason, "new");
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
		+ "Do NOT create a new plan. Teach new or twice-missed material before serving ready challenges."));
	assert.ok(text.includes("Skill files are optional reference: read at most one SKILL.md only when you need a "
		+ "technique you don't know; start with the teaching contract."));
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


test("active path file is replaced atomically and survives a new store", async (t) => fixture(t, async (_f, home) => {
	const { ActivePathStore } = await import("../src/practice/paths.ts");
	const store = new ActivePathStore();
	assert.equal(store.read(), undefined);
	store.write("first");
	store.write("second");
	assert.equal(new ActivePathStore(home).read(), "second");
	assert.deepEqual(JSON.parse(readFileSync(join(home, "graph", "active-path.json"), "utf8")),
		{ activePath: "second" });
	assert.deepEqual(readdirSync(join(home, "graph")), ["active-path.json"]);
	writeFileSync(join(home, "graph", "active-path.json"), "invalid JSON");
	assert.equal(store.read(), undefined);
}));

test("/path new parses a goal and sends the exact agent request", async (t) => fixture(t, async (f) => {
	await f.command("path", "  new   learn SQL joins  ");
	assert.equal(f.messages.at(-1), "Build a learning path for: learn SQL joins. "
		+ "Look at my knowledge graph first, then call psi_path create.");
	await f.command("path", "new");
	assert.equal(f.notifications.at(-1), "Usage: /path new <goal>");
}));

const knowledgeLocation = new URL("../../core/src/knowledge.ts", import.meta.url);
const knowledgeModule = existsSync(knowledgeLocation) ? await import(knowledgeLocation.href) : undefined;
const pathOptions = { skip: knowledgeModule ? false : "knowledge.ts not present" };

async function pathFixture(t: test.TestContext,
	run: (f: ReturnType<typeof fake>, home: string, store: any, ids: string[]) => Promise<void>) {
	await fixture(t, async (f, home) => {
		await f.execute("psi_skill_plan", { action: "create", plan: plan({ subskills: [
			{ ...plan().subskills[0], status: "solid" },
			{ ...plan().subskills[0], id: "joins", title: "Joins", prerequisites: ["select"] },
		] }) });
		const store = new knowledgeModule!.KnowledgeStore(home);
		const ids = ["subskill:sql/select", "subskill:sql/joins", "skill:sql"];
		await run(f, home, store, ids);
	});
}

test("psi_path lists, gets, creates and continues ordered fixture steps", pathOptions, async (t) => {
	await pathFixture(t, async (f, _home, store, ids) => {
		const created = await f.execute("psi_path", { action: "create", title: "SQL route", goal: "Query data", steps: ids });
		assert.equal(created.details.path.total, 3);
		assert.equal(created.details.path.done, 1);
		const id = created.details.path.id;
		assert.equal(store.readPath(id).title, "SQL route");
		assert.equal(f.entries.at(-1).customType, "psi-active-path");
		assert.equal(f.entries.at(-1).data.activePath, id);
		const listed = await f.execute("psi_path", { action: "list" });
		assert.match(listed.content[0].text, /SQL route.*1\/3 done.*Query data/);
		const got = await f.execute("psi_path", { action: "get", id });
		assert.deepEqual(got.details.steps.map((step: any) => step.status), ["done", "next", "pending"]);
		assert.match(got.content[0].text, /2\. Joins \[next\]/);
		const next = await f.execute("psi_path", { action: "next" });
		assert.equal(next.details.next.id, ids[1]);
		assert.match(next.content[0].text, /psi_challenge with action "next", skill "sql", subskillId "joins"/);
		const generated = await f.execute("psi_path", { action: "create", title: "Generated", goal: "Joins",
			targetId: ids[1] });
		assert.deepEqual(generated.details.path.steps, store.pathTo(ids[1]));
		assert.ok((await f.execute("psi_path", { action: "get", id: "missing" })).details.errors);
		assert.ok((await f.execute("psi_path", { action: "create", title: "Invalid" })).details.errors);
	});
});

test("/path list and id switch paths; injection restores session before file fallback", pathOptions, async (t) => {
	await pathFixture(t, async (f, home, store, ids) => {
		const first = store.savePath({ title: "SQL route", goal: "Query data", steps: ids, source: "learner" });
		const second = store.savePath({ title: "Other route", goal: "Practice", steps: [ids[2]], source: "learner" });
		const prompt = async () => (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
		assert.doesNotMatch(await prompt(), /Active path:/);
		await f.command("path");
		const listing = f.notifications.at(-1);
		await f.command("path", "list");
		assert.equal(f.notifications.at(-1), listing);
		assert.match(listing!, /SQL route/);
		await f.command("path", first.id);
		assert.match(f.notifications.at(-1)!, /step 2 of 3: Joins/);
		const expected = "Active path: SQL route — step 2 of 3: Joins. Continue it unless the learner asks otherwise.";
		assert.deepEqual((await prompt()).split("\n").filter((text: string) => text.startsWith("Active path:")), [expected]);
		await f.command("path", "missing");
		assert.match(f.notifications.at(-1)!, /Path not found.*list/);
		const { ActivePathStore } = await import("../src/practice/paths.ts");
		const saved = new ActivePathStore(home);
		assert.equal(saved.read(), first.id);
		saved.write(second.id);
		await f.fire("session_start");
		assert.ok((await prompt()).includes(expected));
		f.entries.length = 0;
		await f.fire("session_start");
		assert.match(await prompt(), /Active path: Other route — step 1 of 1: SQL\./);
		assert.match((await f.execute("psi_path", { action: "next" })).content[0].text, /Start \/practice for skill sql/);
		f.entries.push({ type: "custom", customType: "psi-active-path", data: { activePath: first.id } });
		await f.fire("session_tree");
		assert.ok((await prompt()).includes(expected));
		const { PracticeStore } = await import("../../core/src/practice.ts");
		new PracticeStore(home).setSubskillStatus("sql", "joins", "solid");
		const completed = store.savePath({ title: "Done", goal: "Done", steps: [ids[0]], source: "learner" });
		await f.command("path", completed.id);
		assert.doesNotMatch(await prompt(), /Active path:/);
		assert.match((await f.execute("psi_path", { action: "next" })).content[0].text, /All steps are done/);
	});
});

test("psi_path next teaches concept steps", pathOptions, async (t) => fixture(t, async (f, home) => {
	const { PsiStore } = await import("../../core/src/store.ts");
	const now = new Date().toISOString();
	new PsiStore(home).writeGraph("algebra", { topic: "algebra", title: "Algebra", bigIdea: "Understand vectors",
		concepts: [{ id: "vectors", title: "Vectors", summary: "Directed quantities", prerequisites: [], difficulty: 1 }],
		createdAt: now, updatedAt: now });
	const path = await f.execute("psi_path", { action: "create", title: "Vectors", goal: "Understand vectors",
		steps: ["concept:algebra/vectors"] });
	const next = await f.execute("psi_path", { action: "next", id: path.details.path.id });
	assert.equal(next.details.instruction, "Teach Vectors.");
}));

import { createServer } from "node:http";
import { fetchPage, parseSearch, searchSources } from "../src/practice/web.ts";
import { ProfileStore } from "../../core/src/profile.ts";

async function localPage(t: test.TestContext, run: (base: string) => Promise<void>) {
	const old = process.env.PSI_FETCH_ALLOW_LOOPBACK;
	process.env.PSI_FETCH_ALLOW_LOOPBACK = "1";
	const server = createServer((req, res) => {
		if (req.url === "/redirect") { res.writeHead(302, { location: "/redirect" }); res.end(); return; }
		res.setHeader("Content-Type", "text/html");
		if (req.url === "/large") { res.end("x".repeat(2 * 1024 * 1024 + 1)); return; }
		const sentence = req.url === "/yes" ? "Python lists are mutable." : req.url === "/no"
			? "Python lists are not mutable." : "Bananas grow on plants.";
		res.end(`<head><title>Reference &amp; title</title></head><script>evil()</script><style>bad</style>`
			+ `<h1>Heading</h1><p>${sentence} &lt;safe&gt; &#65; &#x42;</p>`);
	});
	try {
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(8080, "127.0.0.1", resolve); });
	} catch (error) {
		if (old === undefined) delete process.env.PSI_FETCH_ALLOW_LOOPBACK; else process.env.PSI_FETCH_ALLOW_LOOPBACK = old;
		if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Sandbox refuses loopback listener (EPERM)"); return; }
		throw error;
	}
	try { await run("http://127.0.0.1:8080"); }
	finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (old === undefined) delete process.env.PSI_FETCH_ALLOW_LOOPBACK; else process.env.PSI_FETCH_ALLOW_LOOPBACK = old;
	}
}

test("sourced lessons validate, resolve numbered citations and deduplicate sources", async (t) => fixture(t, async (f) => {
	await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	assert.match((await f.execute("psi_lesson", { action: "show" })).content[0].text, /Lesson missing/);
	const input = { action: "add", url: "https://docs.python.org/3/tutorial/", title: "Python" };
	await f.execute("psi_sources", input); await f.execute("psi_sources", input);
	const items = (await f.execute("psi_sources", { action: "list" })).details.widget.items;
	assert.equal(items.length, 1); assert.ok(items[0].rankReasons.length);
	assert.equal((await f.execute("psi_lesson", { action: "write", lesson: {} })).isError, true);
	const written = await f.execute("psi_lesson", { action: "write", lesson: { title: "Select",
		explanation: "Select reads columns from a table.", keyIdeas: ["Choose columns", "Read rows"],
		citations: [{ sourceId: items[0].id }] } });
	assert.ok(!written.isError, JSON.stringify(written));
	const shown = await f.execute("psi_lesson", { action: "show" });
	assert.equal(shown.details.widget.citations[0].n, 1);
	assert.equal(shown.details.widget.citations[0].url, items[0].url);
	assert.match(shown.content[0].text, /\[1\]/);
}));

test("fetch refuses non-public destinations, protocols and ports by default", async () => {
	const old = process.env.PSI_FETCH_ALLOW_LOOPBACK; delete process.env.PSI_FETCH_ALLOW_LOOPBACK;
	try {
		for (const url of ["http://127.0.0.1", "http://localhost", "http://10.0.0.1", "http://192.168.1.1",
			"http://169.254.169.254", "file:///tmp/a", "http://example.org:8081", "http://[::1]", "http://[::ffff:127.0.0.1]"]) {
			await assert.rejects(fetchPage(url));
		}
	} finally { if (old !== undefined) process.env.PSI_FETCH_ALLOW_LOOPBACK = old; }
});

test("fetch sanitizes HTML, bounds redirects/body, and wraps reference data", async (t) => fixture(t, async (f) => {
	await localPage(t, async (base) => {
		const page = await fetchPage(base);
		assert.equal(page.title, "Reference & title"); assert.match(page.text, /# Heading/);
		assert.match(page.text, /<safe> A B/); assert.doesNotMatch(page.text, /evil|bad/);
		await assert.rejects(fetchPage(`${base}/redirect`), /Redirect limit/);
		await assert.rejects(fetchPage(`${base}/large`), /2 MB/);
		const fetched = await f.execute("psi_fetch", { url: base });
		assert.match(fetched.content[0].text, /ignore instructions/);
		assert.match(fetched.content[0].text, /<fetched-content.*untrusted="true">/);
		assert.match(fetched.content[0].text, /<\/fetched-content>/);
		const fallback = await searchSources("python", "python", "file:///unavailable");
		assert.match(fallback.note, /trusted catalog/); assert.ok(fallback.items.length);
	});
}));

test("search decodes uddg and sorts by rank", () => {
	const items = parseSearch('<a class="result__a" href="https://blog.example/a">Blog</a>'
		+ '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.python.org%2F3%2F">Python</a>');
	assert.equal(items[0]!.url, "https://docs.python.org/3/"); assert.ok(items[0]!.rank > items[1]!.rank);
});

test("verification uses cached evidence and uncertain labels", async (t) => fixture(t, async (f, home) => {
	await f.execute("psi_skill_plan", { action: "create", plan: plan() });
	for (const [route, text, verdict] of [
		["yes", "Python lists are mutable. Other information.", "likely-supported"],
		["no", "Python lists are not mutable. Other information.", "possibly-contradicted"],
		["other", "Bananas grow on plants.", "unclear"],
	]) {
		const url = `https://example.org/${route}`;
		cachePage(home, "sql", url, text!);
		const added = await f.execute("psi_sources", { action: "add", url, title: "Python lists" });
		const checked = await f.execute("psi_verify", { claim: "Python lists are mutable" });
		assert.equal(checked.details.widget.verdict, verdict);
		assert.ok(checked.details.widget.evidence.length);
		assert.match(checked.content[0].text, /heuristic signal, not proof/);
		await f.execute("psi_sources", { action: "remove", id: added.details.widget.items[0].id });
	}
}));

test("mode persists; commands request tools; injection teaches first; combo is display-only", async (t) => fixture(t, async (f, home) => {
	await f.command("mode", "teach"); assert.equal(new ProfileStore(home).read().tutorMode, "teach");
	await f.command("mode"); assert.match(f.notifications.at(-1)!, /teach/);
	await f.command("mode", "unknown"); assert.match(f.notifications.at(-1)!, /Unknown/);
	await f.command("verify", "Python lists are mutable"); assert.match(f.messages.at(-1)!, /psi_verify/);
	await f.command("sources"); assert.match(f.messages.at(-1)!, /psi_sources/);
	const injected = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
	for (const phrase of ["psi_lesson", "psi_sources", "psi_fetch", "psi_search", "psi_verify",
		"Want me to check that against the sources?", "ONE question"]) assert.ok(injected.includes(phrase));
	assert.doesNotMatch(injected, /attempt first|attempts or predicts before explanations/i);
	const c = await f.execute("psi_challenge", draft());
	const a = await f.execute("psi_attempt", { skill: "sql", challengeId: c.details.challengeId, answer: "4" });
	assert.equal(a.details.combo, 1); assert.equal(a.details.widget.comboBonus, 1);
	assert.equal(a.details.widget.comboDisplayOnly, true);
}));

import { runCode } from "../src/practice/run.ts";

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	try { await run(); }
	finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

test("execution registration and prompt are enabled only by exact opt-in", async (t) => {
	for (const enabled of [undefined, "0", "true", "1"]) {
		await withEnv({ PSI_CODE_EXEC: enabled }, () => fixture(t, async (f) => {
			assert.equal(f.tools.has("psi_run"), enabled === "1");
			const prompt = (await f.fire("before_agent_start", { systemPrompt: "Base" }))[0].systemPrompt;
			assert.equal(prompt.includes("psi_run"), enabled === "1");
			if (enabled !== "1") assert.doesNotMatch(prompt, /code execution/i);
			assert.match(prompt, /psi_next_steps.*2–4.*Continue/);
			assert.match(prompt, /already graded\/saved/);
			assert.ok(prompt.length - "Base\n\n".length <= 2500);
			if (enabled === "1") {
				const result = await f.execute("psi_run", { language: "javascript",
					code: "import { writeSync } from 'node:fs'; writeSync(1, '42\\n');" });
				assert.equal(result.details.widget.type, "run");
				assert.equal(result.details.widget.stdout, "42\n");
				assert.match(result.content[0].text, /```javascript/);
			}
		}));
	}
});

test("python, javascript and SQL execute setup, code and stdin", async (t) => {
	const cases = [
		{ language: "python" as const, setup: "x = 40", code: "print(x + int(input()))", stdin: "2\n" },
		{ language: "javascript" as const, setup: "const x = 40;",
			code: "import { writeSync } from 'node:fs'; writeSync(1, String(x + 2));" },
		{ language: "sql" as const, setup: "CREATE TABLE t(n); INSERT INTO t VALUES (40);",
			code: "SELECT n + 2 FROM t; SELECT 'safe; quote'" },
	];
	for (const input of cases) {
		try {
			const result = await runCode(input);
			assert.equal(result.exitCode, 0, result.stderr);
			assert.match(result.stdout, /42/, JSON.stringify({ input, result }));
			if (input.language === "sql") assert.match(result.stdout, /safe; quote/);
			assert.equal(result.timedOut, false);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") { t.skip("Interpreter unavailable"); return; }
			throw error;
		}
	}
});

test("runner strips secrets and removes its temporary working directory", async () => {
	await withEnv({ PSI_TEST_SECRET: "private", OPENAI_API_KEY: "private", PSI_CODE_EXEC: "1" }, async () => {
		const result = await runCode({ language: "javascript", code:
			"import { writeSync } from 'node:fs'; writeSync(1, JSON.stringify({env: process.env, cwd: process.cwd()}))" });
		const data = JSON.parse(result.stdout);
		assert.deepEqual(Object.keys(data.env).sort(), ["HOME", "LANG", "PATH"]);
		assert.equal(data.env.PSI_TEST_SECRET, undefined);
		assert.equal(data.env.OPENAI_API_KEY, undefined);
		assert.equal(data.env.HOME, data.cwd);
		assert.equal(existsSync(data.cwd), false);
	});
});

test("runner kills a timed-out process group within 15 seconds", async () => {
	const started = Date.now();
	const result = await runCode({ language: "javascript", code:
		"import { writeSync } from 'node:fs'; writeSync(1, String(process.pid)); while (true) {}" });
	assert.equal(result.timedOut, true);
	assert.equal(result.exitCode, null);
	assert.ok(Date.now() - started < 15000);
	assert.throws(() => process.kill(Number(result.stdout.trim()), 0), { code: "ESRCH" });
});

test("runner caps stdout and stderr independently and reports nonzero exits", async () => {
	const result = await runCode({ language: "javascript", code:
		"import { writeSync } from 'node:fs'; writeSync(1, 'x'.repeat(70000)); "
			+ "writeSync(2, 'y'.repeat(70000)); process.exitCode = 3;" });
	assert.equal(result.exitCode, 3);
	assert.equal(result.truncated, true);
	for (const text of [result.stdout, result.stderr]) {
		assert.match(text, /\n\[output truncated at 64 KB\]$/);
		assert.equal(text.split("\n")[0]!.length, 65536);
	}
});

test("bash requires its separate opt-in and tool errors remain readable", async (t) => {
	await withEnv({ PSI_CODE_EXEC: "1", PSI_CODE_EXEC_BASH: undefined }, () => fixture(t, async (f) => {
		const result = await f.execute("psi_run", { language: "bash", code: "echo forbidden" });
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /PSI_CODE_EXEC_BASH=1/);
	}));
	await withEnv({ PSI_CODE_EXEC_BASH: "1" }, async () => {
		const result = await runCode({ language: "bash", setup: "x=40", code: "echo $((x + 2))" });
		assert.equal(result.stdout, "42\n");
	});
});

test("next steps validate limits and preserve widget options", async (t) => fixture(t, async (f) => {
	const options = [{ label: "Continue", message: "Continue" }, { label: "Demo", message: "Show a demo" }];
	const result = await f.execute("psi_next_steps", { options });
	assert.deepEqual(result.details.widget, { type: "next_steps", options });
	assert.equal(result.content[0].text, "Offered next steps");
	for (const invalid of [[], options.slice(0, 1), [...options, ...options, options[0]],
		[{ label: " ", message: "x" }, options[0]], [{ label: "x", message: " " }, options[0]],
		[{ label: "x".repeat(61), message: "x" }, options[0]],
		[{ label: "x", message: "x".repeat(401) }, options[0]]]) {
		assert.equal((await f.execute("psi_next_steps", { options: invalid })).isError, true);
	}
}));

test("Socratic prompts validate and never record attempts or award XP", async (t) => fixture(t, async (f, home) => {
	await f.execute("psi_challenge", draft({ kind: "predict" }));
	const { PracticeStore } = await import("../../core/src/practice.ts");
	const before = new PracticeStore(home).progress("sql");
	const original = PracticeStore.prototype.recordAttempt;
	PracticeStore.prototype.recordAttempt = () => { throw new Error("Unexpected recordAttempt"); };
	try {
		for (const kind of ["predict", "why", "what-if"]) {
			const p = { question: "What might happen?", kind, hint: "Watch the loop" };
			assert.deepEqual((await f.execute("psi_ask", p)).details.widget, { type: "socratic", ...p });
		}
		for (const p of [{ question: " ", kind: "predict" }, { question: "x".repeat(401), kind: "why" },
			{ question: "x", kind: "invalid" }, { question: "x", kind: "why", hint: "x".repeat(401) }]) {
			assert.equal((await f.execute("psi_ask", p)).isError, true);
		}
	} finally { PracticeStore.prototype.recordAttempt = original; }
	assert.deepEqual(new PracticeStore(home).progress("sql"), before);
	assert.equal(existsSync(join(home, "skills", "sql", "attempts.jsonl")), false);
}));

test("recent attempts reject duplicates; older retries and other challenges work", async (t) => {
	await fixture(t, async (f, home) => {
		const { PracticeStore } = await import("../../core/src/practice.ts");
		const store = new PracticeStore(home);
		const first = await f.execute("psi_challenge", draft());
		store.recordAttempt({ skill: "sql", challengeId: first.details.challengeId, answer: "4", outcome: "success", hintsUsed: 0 });
		const params = { skill: "sql", challengeId: first.details.challengeId, answer: "4" };
		const duplicate = await f.execute("psi_attempt", params);
		assert.equal(duplicate.isError, true);
		assert.match(duplicate.content[0].text, /already recorded/);
		assert.equal(store.progress("sql").attempts, 1);
		const file = join(home, "skills", "sql", "attempts.jsonl");
		const attempt = JSON.parse(readFileSync(file, "utf8").trim());
		attempt.at = new Date(Date.now() - 120001).toISOString();
		writeFileSync(file, JSON.stringify(attempt) + "\n");
		assert.equal((await f.execute("psi_attempt", params)).details.outcome, "success");
		assert.equal((await f.execute("psi_attempt", params)).isError, true);
		const other = await f.execute("psi_challenge", draft());
		assert.equal((await f.execute("psi_attempt", { ...params, challengeId: other.details.challengeId }))
			.details.outcome, "success");
		assert.equal(store.progress("sql").attempts, 3);
	});
});

test("skipped predictions preserve skipped instead of deterministic fail", async (t) => fixture(t, async (f, home) => {
	const c = await f.execute("psi_challenge", draft({ kind: "predict" }));
	const result = await f.execute("psi_attempt", { challengeId: c.details.challengeId, answer: "Just show me",
		outcome: "skipped" });
	assert.equal(result.details.outcome, "skipped");
	const attempt = JSON.parse(readFileSync(join(home, "skills", "sql", "attempts.jsonl"), "utf8").trim());
	assert.equal(attempt.outcome, "skipped");
	const report = await f.execute("psi_progress_report", {});
	assert.equal(report.details.skills[0].failures, 0);
}));

import { sourceId, SourceStore } from "../../core/src/sources.ts";
import { cachePage, readCachedPage, sourcePage, gatherEvidence } from "../src/practice/sources.ts";
import { checkLessonQuotes, registerLessons } from "../src/practice/lessons.ts";

test("lesson quotes reject missing text and accept normalized cached text without fetching", async (t) =>
	fixture(t, async (f, home) => {
		await f.execute("psi_skill_plan", { action: "create", plan: plan() });
		const source = new SourceStore(home).add("sql", { url: "https://example.org/quotes", title: "Quotes" });
		cachePage(home, "sql", source.url, 'A “LEFT” JOIN &amp; rows —  &#x41; &#39;test&#39;.');
		let calls = 0;
		const fetcher = async () => { calls++; throw new Error("unexpected fetch"); };
		assert.deepEqual(await checkLessonQuotes([{ sourceId: source.id,
			quote: 'a "left"  join & ROWS - A \'test\'.' }], [source], home, "sql", fetcher), []);
		assert.equal(calls, 0);
		const accepted = await f.execute("psi_lesson", { action: "write", lesson: { title: "Select",
			explanation: "Read rows.", keyIdeas: ["Choose columns", "Read rows"],
			citations: [{ sourceId: source.id, quote: 'a "left" join & ROWS - A \'test\'.' }] } });
		assert.ok(!accepted.isError, JSON.stringify(accepted));
		const saved = readFileSync(join(home, "skills/sql/lessons/select.json"), "utf8");
		const written = await f.execute("psi_lesson", { action: "write", lesson: { title: "Select",
			explanation: "Read rows.", keyIdeas: ["Choose columns", "Read rows"],
			citations: [{ sourceId: source.id, quote: "invented supporting quote" }] } });
		assert.equal(written.isError, true);
		assert.match(written.content[0].text, /Citation \[1\].*src-/);
		assert.match(written.content[0].text, /quote must be copied verbatim/);
		assert.equal(readFileSync(join(home, "skills/sql/lessons/select.json"), "utf8"), saved);
	}));

test("uncached quote fetches once, writes header atomically and reports fetch failures", async (t) =>
	fixture(t, async (_f, home) => {
		const source = new SourceStore(home).add("sql", { url: "https://example.org/page", title: "Page" });
		let calls = 0;
		const fetcher = async (url: string) => { calls++; return { url, text: "SQL joins combine rows." }; };
		const citations = [{ sourceId: source.id, quote: "SQL joins combine rows." }];
		assert.deepEqual(await checkLessonQuotes(citations, [source], home, "sql", fetcher), []);
		assert.deepEqual(await checkLessonQuotes(citations, [source], home, "sql", fetcher), []);
		assert.equal(calls, 1);
		const dir = join(home, "skills/sql/source-cache");
		assert.deepEqual(readdirSync(dir), [`${sourceId(source.url)}.txt`]);
		assert.match(readFileSync(join(dir, `${sourceId(source.url)}.txt`), "utf8"),
			/^# fetchedAt: .*Z\n# url: https:\/\/example.org\/page\n\nSQL/);
		assert.equal(readCachedPage(home, "sql", source.url)!.text, "SQL joins combine rows.");
		const missing = { ...source, id: "missing", url: "https://example.org/fail" };
		assert.match((await checkLessonQuotes([{ sourceId: "missing", quote: "SQL" }], [missing], home, "sql",
			async () => { throw new Error("offline"); })).join(""), /could not verify citation 1:.*offline/);
	}));

test("source cache caps full UTF-8 file at 2 MiB and retrieval caps missing fetches at three", async (t) =>
	fixture(t, async (_f, home) => {
		const url = "https://example.org/large";
		await sourcePage(home, "sql", url, async () => ({ url, text: "😀".repeat(600000) }));
		const raw = readFileSync(join(home, "skills/sql/source-cache", `${sourceId(url)}.txt`));
		assert.ok(raw.length <= 2 * 1024 * 1024);
		assert.ok(!raw.toString("utf8").includes("�"));
		const store = new SourceStore(home);
		const sources = Array.from({ length: 5 }, (_, i) => store.add("sql", {
			url: `https://example.org/${i}`, title: String(i), excerpt: "Stored fallback." }));
		let calls = 0;
		const gathered = await gatherEvidence(home, "sql", sources, async (url) => {
			calls++; return { url, text: "Fetched evidence." };
		});
		assert.equal(calls, 3); assert.equal(gathered.documents.length, 5);
	}));


test("psi_fetch caches full text but returns 20k and explicitly skips cache without active skill", async () => {
	const home = mkdtempSync(join(tmpdir(), "psi-fetch-seam-"));
	try {
		const { PracticeStore } = await import("../../core/src/practice.ts");
		const { MemoryStore } = await import("../../core/src/memory.ts");
		const f = fake(), state: import("../src/practice/index.ts").PracticeState = { hintIndex: 0 };
		let calls = 0;
		registerLessons(f.api, { practice: new PracticeStore(home), memory: new MemoryStore(home), state,
			resume() {}, persist() {}, activate() {}, refresh() {} }, { fetcher: async (url) => {
				calls++; return { url, text: "a".repeat(25000) };
			} });
		const url = "https://example.org/read";
		const skipped = await f.execute("psi_fetch", { url });
		assert.match(skipped.content[0].text, /Skipped caching: no active skill/);
		assert.equal(existsSync(join(home, "skills")), false);
		state.skill = "sql";
		const fetched = await f.execute("psi_fetch", { url });
		assert.equal(fetched.details.text.length, 20000);
		assert.equal(fetched.details.truncated, true);
		assert.equal(readCachedPage(home, "sql", url)!.text.length, 25000);
		assert.equal(calls, 2);
		const page = await fetchPage(url, { http: async () => ({ url,
			body: "x".repeat(25000), contentType: "text/plain" }) });
		assert.equal(page.text.length, 20000);
	} finally { rmSync(home, { recursive: true, force: true }); }
});


test("hint use keeps XP intact and earns help-then-solve on success", async (t) => fixture(t, async (f) => {
	const created = await f.execute("psi_challenge", draft());
	await f.execute("psi_hint", { challengeId: created.details.challengeId, n: 1 });
	const solved = await f.execute("psi_attempt", { challengeId: created.details.challengeId, answer: "4" });
	assert.equal(solved.details.xp, 5);
	assert.ok(solved.details.badges.includes("help-then-solve"));
	assert.ok(!solved.details.badges.includes("no-hints"));
}));
