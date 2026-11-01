import test from "node:test";
import assert from "node:assert/strict";

// Import the real browser exports; startup is guarded, so Node needs no DOM or shared UI modules.
const shellModule = "../public/app.js";
const { parseRoute, barPercent, formatBars } = await import(shellModule);

test("shell routes home, chats, skills, memory and the concept index", () => {
	assert.deepEqual(parseRoute("#/"), { route: "home", params: {} });
	assert.deepEqual(parseRoute(""), { route: "home", params: {} });
	assert.deepEqual(parseRoute("#/chat/chat%201"), { route: "chat", params: { chatId: "chat 1" } });
	assert.deepEqual(parseRoute("#/skills/mental-math"), { route: "skill", params: { skill: "mental-math" } });
	assert.deepEqual(parseRoute("#/memory"), { route: "memory", params: {} });
	assert.deepEqual(parseRoute("#/you"), { route: "you", params: {} });
	assert.deepEqual(parseRoute("#/topics"), { route: "topics", params: {} });
});

test("new chat queries preserve encoded commands, punctuation and Unicode", () => {
	const prompt = "/learn ∫ x² dx? + # & recursion/trees\nnext";
	assert.deepEqual(parseRoute(`#/new?skill=sql%20joins&topic=linear-algebra&prompt=${encodeURIComponent(prompt)}`),
		{ route: "new", params: { skill: "sql joins", topic: "linear-algebra", prompt } });
	assert.deepEqual(parseRoute("#/new?skill=&topic=&prompt="),
		{ route: "new", params: { skill: "", topic: "", prompt: "" } });
	assert.deepEqual(parseRoute("#/new?prompt=%2Fskill+Python"),
		{ route: "new", params: { skill: "", topic: "", prompt: "/skill Python" } });
});

test("existing concept routes retain every studio view", () => {
	for (const view of ["map", "lessons", "gallery", "review", "progress"]) {
		assert.deepEqual(parseRoute(`#/linear%20algebra/${view}`),
			{ route: "topic", params: { topic: "linear algebra", view } });
	}
	assert.deepEqual(parseRoute("#/probability"), { route: "topic", params: { topic: "probability", view: "map" } });
	assert.deepEqual(parseRoute("#/%ZZ/map"), { route: "home", params: {} });
});

test("bar percent rounds and clamps invalid, negative and oversized values", () => {
	assert.equal(barPercent(1, 3), 33);
	assert.equal(barPercent(2, 3), 67);
	assert.equal(barPercent(-5, 20), 0);
	assert.equal(barPercent(40, 20), 100);
	for (const n of [NaN, Infinity, -Infinity]) assert.equal(barPercent(n, 20), 0);
	for (const total of [0, -1, Infinity, NaN]) assert.equal(barPercent(1, total), 0);
});

test("hours and XP formatting uses the core level boundaries", () => {
	assert.deepEqual(formatBars(), { level: 1, levelPercent: 0, hours: "0/20", hoursPercent: 0 });
	assert.deepEqual(formatBars({ xp: 75, minutesLogged: 75 }),
		{ level: 2, levelPercent: 25, hours: "1.3/20", hoursPercent: 6 });
	assert.deepEqual(formatBars({ xp: 150, minutesLogged: 1500 }),
		{ level: 3, levelPercent: 0, hours: "25/20", hoursPercent: 100 });
	assert.deepEqual(formatBars({ xp: -30, minutesLogged: -60 }), formatBars());
	assert.deepEqual(formatBars({ xp: NaN, minutesLogged: Infinity }), formatBars());
});

const { sortChats, benchRoute, layoutRoute, conceptStatus } = await import(shellModule);
// Module paths in variables keep tsc from resolving the untyped browser modules.
const benchModule = "../public/js/bench.js", homeModule = "../public/js/home.js", uiModule = "../public/js/ui.js";
const { firstSentence, nextSubskill, trailAttempts, trailCaption } = await import(benchModule);
const { pickHeroChallenge, heroSkillOrder, latestRecap, SAMPLE_CHALLENGE } = await import(homeModule);
const { eventName, formatLevel, streakLabel, hoursLabel, emit, on } = await import(uiModule);

test("chats sort newest first with unparseable dates last and ties stable", () => {
	const chats = [{ id: "a", updatedAt: "2026-01-01T00:00:00Z" }, { id: "b", updatedAt: "nope" },
		{ id: "c", updatedAt: "2026-03-01T00:00:00Z" }, { id: "d", updatedAt: "2026-01-01T00:00:00Z" }];
	assert.deepEqual(sortChats(chats).map((c: { id: string }) => c.id), ["c", "a", "d", "b"]);
	assert.deepEqual(sortChats(undefined), []);
});

test("the bench belongs to home and chat routes; new chats use the chat layout", () => {
	assert.deepEqual(["home", "chat", "new", "skill", "memory", "topic"].map(benchRoute), [true, true, true, false, false, false]);
	assert.equal(layoutRoute("new"), "chat");
	assert.equal(layoutRoute("memory"), "memory");
});

test("concept status follows mastery, attempts and the frontier", () => {
	const mastery = { a: { pKnown: 0.97 }, b: { pKnown: 0.4, attempts: 2 } };
	const ready = new Set(["c"]);
	assert.deepEqual(["a", "b", "c", "d"].map((id) => conceptStatus({ id }, mastery, ready)),
		["mastered", "learning", "frontier", "locked"]);
});

test("first sentence keeps one sentence and clips long ones on a word boundary", () => {
	assert.equal(firstSentence("Solve 18 of 20. Then explain."), "Solve 18 of 20.");
	assert.equal(firstSentence("  No full stop here  "), "No full stop here");
	assert.equal(firstSentence(""), "");
	assert.equal(firstSentence(undefined), "");
	const long = firstSentence("word ".repeat(60), 40);
	assert.ok(long.length <= 40 && long.endsWith("…") && !long.includes("  "));
	assert.equal(firstSentence("Use 3.14 as pi. Next."), "Use 3.14 as pi.");
});

test("next subskill is the lowest priority unlocked one that is not solid", () => {
	const plan = { subskills: [
		{ id: "a", title: "A", priority: 1, prerequisites: [], status: "solid" },
		{ id: "c", title: "C", priority: 3, prerequisites: ["a"], status: "todo" },
		{ id: "b", title: "B", priority: 2, prerequisites: ["a"], status: "active" },
		{ id: "d", title: "D", priority: 1, prerequisites: ["b"], status: "todo" },
	] };
	assert.equal(nextSubskill(plan)?.id, "b");
	assert.equal(nextSubskill({ subskills: [{ id: "x", status: "solid", prerequisites: [] }] }), undefined);
	assert.equal(nextSubskill(null), undefined);
});

test("trail attempts flip newest-first API order and keep only drawn fields", () => {
	const api = [{ id: "2", outcome: "fail", at: "t2", xp: 4, lesson: "carry", answer: "x" }, { id: "1", outcome: "success", at: "t1", xp: "12" }, null];
	assert.deepEqual(trailAttempts(api), [{ outcome: "success", at: "t1", xp: 12 }, { outcome: "fail", at: "t2", xp: 4, lesson: "carry" }]);
	assert.deepEqual(trailAttempts({ error: "x" }), []);
	assert.equal(trailCaption(trailAttempts(api)), "2 attempts, 1 missed");
	assert.equal(trailCaption([{ outcome: "success" }]), "1 attempt");
	assert.equal(trailCaption([]), "");
});

test("home hero picks a quick unattempted problem, preferring choice then number", () => {
	const list = [{ id: "code", format: "code" }, { id: "done", format: "choice", attempted: true },
		{ id: "text", format: "text" }, { id: "num", format: "number" }, { id: "pick", format: "choice" }];
	assert.equal(pickHeroChallenge(list)?.id, "pick");
	assert.equal(pickHeroChallenge(list.slice(0, 4))?.id, "num");
	assert.equal(pickHeroChallenge([{ id: "code", format: "code" }]), null);
	assert.equal(pickHeroChallenge(undefined), null);
	assert.deepEqual(heroSkillOrder(["a", "b", "c"], "b"), ["b", "a", "c"]);
	assert.deepEqual(heroSkillOrder([{ skill: "a" }, "b"], "zzz"), ["a", "b"]);
	assert.equal(latestRecap([{ date: "2026-01-01" }, { date: "2026-02-01", id: "new" }, {}])?.id, "new");
	assert.equal(latestRecap(undefined), undefined);
	assert.equal(SAMPLE_CHALLENGE.type, "challenge");
	assert.ok(SAMPLE_CHALLENGE.choices.includes("3"));
});

test("ui helpers name levels, streaks and hours in plain words", () => {
	assert.equal(eventName("attempt"), "psi:attempt");
	assert.equal(eventName("psi:status"), "psi:status");
	assert.deepEqual(
		(({ label, toNextLabel, level }) => ({ label, toNextLabel, level }))(formatLevel(60)),
		{ label: "Level 2", toNextLabel: "90 XP to level 3", level: 2 });
	assert.equal(streakLabel(3), "3-day streak");
	assert.equal(streakLabel(0), "");
	assert.equal(streakLabel(NaN), "");
	assert.equal(hoursLabel(90), "1.5 of 20 hours");
	assert.equal(hoursLabel(-5), "0 of 20 hours");
	assert.equal(hoursLabel(undefined, 10), "0 of 10 hours");
	emit("psi:attempt", {});
	assert.equal(typeof on("psi:attempt", () => {}), "function");
});
