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
