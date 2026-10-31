import test from "node:test";
import assert from "node:assert/strict";

// The browser modules guard every DOM access, so their pure helpers import cleanly in Node.
const pathsModule = "../public/js/paths.js";
const modelsModule = "../public/js/models.js";
const paths = await import(pathsModule);
const models = await import(modelsModule);

const node = (id: string, status?: string, extra: Record<string, unknown> = {}) =>
	({ id, kind: id.split(":")[0], title: id.split(/[:/]/).pop(), status, ...extra });
const byId = new Map([
	["subskill:sql/select", node("subskill:sql/select", "solid")],
	["subskill:sql/order", node("subskill:sql/order", "solid")],
	["subskill:sql/joins", node("subskill:sql/joins", "next")],
	["concept:ft/orth", node("concept:ft/orth", "mastered")],
	["subskill:sql/sub", node("subskill:sql/sub", "locked")],
]);

test("path progress counts solid and mastered steps and finds the first unfinished one", () => {
	const path = { id: "p1", title: "Joins", steps: ["subskill:sql/select", "subskill:sql/joins", "concept:ft/orth",
		"subskill:sql/sub", "missing:x"] };
	assert.deepEqual(paths.pathProgress(path, byId),
		{ done: 2, total: 5, nextId: "subskill:sql/joins", percent: 40, label: "2 of 5 steps done" });
	assert.equal(paths.pathProgress({ steps: [] }).label, "No steps yet");
	assert.equal(paths.pathProgress({ steps: ["subskill:sql/select"] }, byId).label, "All 1 step done");
	assert.equal(paths.pathProgress({ steps: ["subskill:sql/select"] }, byId).nextId, undefined);
	assert.equal(paths.pathProgress({ steps: ["subskill:sql/sub", "x"] }, byId).label, "0 of 2 steps done");
});

test("reorder, remove and add return new arrays and never duplicate a step", () => {
	const steps = ["a", "b", "c", "d"];
	assert.deepEqual(paths.moveStep(steps, 0, 2), ["b", "c", "a", "d"]);
	assert.deepEqual(paths.moveStep(steps, 3, 0), ["d", "a", "b", "c"]);
	assert.deepEqual(paths.moveStep(steps, 1, 99), ["a", "c", "d", "b"]);
	assert.deepEqual(paths.moveStep(steps, 9, 0), steps);
	assert.deepEqual(steps, ["a", "b", "c", "d"], "input is not mutated");
	assert.deepEqual(paths.removeStep(steps, 1), ["a", "c", "d"]);
	assert.deepEqual(paths.addStep(steps, "e"), ["a", "b", "c", "d", "e"]);
	assert.deepEqual(paths.addStep(steps, "b"), steps);
	assert.deepEqual(paths.addStep(steps, "e", 1), ["a", "e", "b", "c", "d"]);
	assert.deepEqual(paths.addStep(undefined, "a"), ["a"]);
});

test("node search ranks title prefixes first, requires every term and skips notes and excluded ids", () => {
	const nodes = [
		{ id: "subskill:sql/joins", kind: "subskill", title: "Inner and outer joins" },
		{ id: "skill:sql", kind: "skill", title: "SQL lab", summary: "Write joins and aggregates" },
		{ id: "concept:ft/join", kind: "concept", title: "Joining signals" },
		{ id: "note:1", kind: "note", title: "Joins confuse me" },
		{ id: "subskill:sql/group", kind: "subskill", title: "Grouping", tags: ["aggregates"] },
	];
	assert.deepEqual(paths.searchNodes(nodes, "join").map((n: { id: string }) => n.id),
		["concept:ft/join", "subskill:sql/joins", "skill:sql"]);
	assert.deepEqual(paths.searchNodes(nodes, "outer join").map((n: { id: string }) => n.id), ["subskill:sql/joins"]);
	assert.deepEqual(paths.searchNodes(nodes, "aggregates").map((n: { id: string }) => n.id),
		["skill:sql", "subskill:sql/group"]);
	assert.deepEqual(paths.searchNodes(nodes, "join", { exclude: ["concept:ft/join"], limit: 1 })
		.map((n: { id: string }) => n.id), ["subskill:sql/joins"]);
	assert.equal(paths.searchNodes(nodes, "confuse").length, 0);
	assert.equal(paths.searchNodes(nodes, "confuse", { notes: true }).length, 1);
	assert.deepEqual(paths.searchNodes(nodes, "   "), []);
});

test("steps describe kind and status in words and link to their node", () => {
	assert.equal(paths.kindLabel({ kind: "subskill" }, "SQL lab"), "Part of SQL lab");
	assert.equal(paths.kindLabel({ kind: "concept" }, "Fourier transform"), "Concept in Fourier transform");
	assert.equal(paths.kindLabel({ kind: "skill" }), "Skill");
	assert.equal(paths.kindLabel(undefined), "Missing from your graph");
	assert.equal(paths.statusLabel({ status: "solid" }), "Done");
	assert.equal(paths.statusLabel({ status: "locked" }), "Locked");
	assert.equal(paths.statusLabel({}), "Not started");
	assert.equal(paths.statusLabel(undefined), "Removed");
	assert.equal(paths.stepHref({ id: "skill:sql", href: "#/skills/sql" }), "#/skills/sql");
	assert.equal(paths.stepHref({ id: "concept:ft/orth" }), "#/graph/concept%3Aft%2Forth");
});

test("continue and graph links name the next unfinished step and carry the path overlay", () => {
	const path = { id: "path 1", title: "Joins", steps: ["subskill:sql/select", "subskill:sql/joins"] };
	assert.equal(paths.continuePrompt(path, byId), "Continue my learning path Joins: next step joins");
	assert.equal(paths.graphHash(path, byId), "#/graph/subskill%3Asql%2Fjoins?path=path%201");
	const done = { id: "p2", title: "Done", steps: ["subskill:sql/select"] };
	assert.match(paths.continuePrompt(done, byId), /every step is done/);
	assert.equal(paths.graphHash(done, byId), "#/graph/subskill%3Asql%2Fselect?path=p2");
	assert.equal(paths.graphHash({ id: "p3", steps: [] }), "#/graph?path=p3");
	assert.deepEqual(paths.chatContext("subskill:sql-lab/joins"), { skill: "sql-lab" });
	assert.deepEqual(paths.chatContext("concept:fourier/orth"), { topic: "fourier" });
	assert.deepEqual(paths.chatContext("note:abc"), {});
	assert.equal(paths.newChatHash("/path new Do SQL", { skill: "sql" }), "#/new?prompt=%2Fpath+new+Do+SQL&skill=sql");
});

test("model names, context sizes, grouping and search", () => {
	assert.equal(models.shortModelName("xai/grok-4.6"), "grok-4.6");
	assert.equal(models.shortModelName("fireworks/accounts/fireworks/models/kimi-k3"), "kimi-k3");
	assert.equal(models.shortModelName(""), "");
	assert.equal(models.contextLabel(262144), "262K context");
	assert.equal(models.contextLabel(1_000_000), "1M context");
	assert.equal(models.contextLabel(1_048_576), "1M context");
	assert.equal(models.contextLabel(2_500_000), "2.5M context");
	assert.equal(models.contextLabel("128K"), "128K context");
	assert.equal(models.contextLabel(undefined), "");

	const list = models.normalizeModels({ default: "xai/grok-4.6", models: [
		{ id: "anthropic/claude-opus-5-5", provider: "anthropic", name: "claude-opus-5-5" },
		{ id: "xai/grok-4.6" },
		{ id: "anthropic/claude-haiku-5", provider: "anthropic", name: "claude-haiku-5" },
		{ bad: true },
	] });
	assert.equal(list.default, "xai/grok-4.6");
	assert.deepEqual(list.models[1], { id: "xai/grok-4.6", provider: "xai", name: "grok-4.6" });
	assert.equal(list.models.length, 3);
	const groups = models.groupModels(list.models, "xai/grok-4.6");
	assert.deepEqual(groups.map((g: { provider: string }) => g.provider), ["xai", "anthropic"]);
	assert.equal(groups[1].models.length, 2);
	const providers = (items: { provider: string }[]) => items.map((g) => g.provider);
	assert.deepEqual(providers(models.groupModels(list.models)), ["anthropic", "xai"]);
	assert.deepEqual(models.filterModels(list.models, "anthropic haiku").map((m: { id: string }) => m.id),
		["anthropic/claude-haiku-5"]);
	assert.equal(models.filterModels(list.models, "GROK").length, 1);
	assert.equal(models.filterModels(list.models, "").length, 3);
	assert.deepEqual(models.normalizeModels(null), { default: "", models: [] });
});
