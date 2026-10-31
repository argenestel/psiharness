import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KnowledgeStore, neighborhood, knowledgePathTo } from "../src/knowledge.ts";
import { PracticeStore } from "../src/practice.ts";
import { PsiStore } from "../src/store.ts";
import { MemoryStore } from "../src/memory.ts";
import type { KnowledgeGraph, KnowledgeNode, SkillPlan } from "../src/types.ts";

const skill = "python-foundations";
const topic = "fourier-transform";
const skillId = `skill:${skill}`;
const root = `subskill:${skill}/syntax-types`;
const read = (file: URL): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

function fixture(t: { after(fn: () => void): void }) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-knowledge-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const practice = new PracticeStore(home);
	const topics = new PsiStore(home);
	const memory = new MemoryStore(home);
	// Reproduce CLI import-skill's normalized plan/challenges layout and import's recursive topic copy.
	const plan = read(new URL("../../examples/skills/python-foundations/plan.json", import.meta.url)) as SkillPlan;
	practice.writePlan(plan);
	const challenges = read(new URL("../../examples/skills/python-foundations/challenges.json", import.meta.url));
	fs.writeFileSync(path.join(home, "skills", skill, "challenges.json"), JSON.stringify(challenges));
	fs.cpSync(new URL("../../examples/topics/fourier-transform", import.meta.url), topics.topicDir(topic),
		{ recursive: true });
	const note = memory.remember({ kind: "struggle", text: "Recursion is tricky: use a recursive base case." });
	const own = practice.listChallenges(skill, { subskillId: "syntax-types" });
	practice.recordAttempt({ challengeId: own[0].id, answer: "solution", outcome: "success", hintsUsed: 0,
		at: "2026-01-01T12:00:00Z" });
	practice.recordAttempt({ challengeId: own[1].id, answer: "retry", outcome: "fail", hintsUsed: 1,
		at: "2026-01-01T12:01:00Z" });
	return { home, practice, topics, memory, note, store: new KnowledgeStore(home) };
}

const edgeKey = (edge: { from: string; to: string; kind: string }) => JSON.stringify([edge.from, edge.to, edge.kind]);
const owner = (id: string) => id.replace(/^(subskill|skill):/, "skill:")
	.replace(/^(concept|topic):/, "topic:").split("/")[0];

function assertSorted(graph: KnowledgeGraph) {
	assert.deepEqual(graph.nodes.map((n) => n.id), graph.nodes.map((n) => n.id).sort());
	const keys = graph.edges.map((e) => [e.from, e.to, e.kind].join("\0"));
	assert.deepEqual(keys, [...keys].sort());
}

test("example packs derive nodes, statuses, progress, routes and note edges", (t) => {
	const { store, practice, note, topics } = fixture(t);
	let graph = store.build();
	assert.deepEqual(new Set(graph.nodes.map((n) => n.kind)), new Set(["skill", "subskill", "topic", "concept", "note"]));
	assert.equal(graph.nodes.find((n) => n.id === skillId)?.status, "practising");
	assert.equal(graph.nodes.find((n) => n.id === skillId)?.href, "#/skills/python-foundations");
	assert.equal(graph.nodes.find((n) => n.id === `topic:${topic}`)?.href, "#/fourier-transform/map");
	const next = practice.nextSubskill(practice.readPlan(skill)!);
	assert.equal(graph.nodes.find((n) => n.id === `subskill:${skill}/${next!.id}`)?.status, "next");
	assert.equal(graph.nodes.find((n) => n.id === root)?.progress,
		1 / practice.listChallenges(skill, { subskillId: "syntax-types" }).length);
	assert.ok(graph.edges.some((e) => e.kind === "about" && e.from === `note:${note.id}`));
	assert.ok(graph.edges.some((e) => e.kind === "contains"));
	assert.ok(graph.edges.some((e) => e.kind === "prerequisite"));
	practice.setSubskillStatus(skill, "syntax-types", "practicing");
	assert.equal(store.build().nodes.find((n) => n.id === root)?.status, "practising");
	const concept = topics.readGraph(topic)!.concepts.find((c) => !c.prerequisites.length)!;
	topics.writeLearner(topic, { topic, mastery: { [concept.id]: {
		conceptId: concept.id, pKnown: 0.97, attempts: 5, correct: 5,
	} }, notes: [], updatedAt: "2026-01-01T00:00:00Z" });
	graph = store.build();
	assert.equal(graph.nodes.find((n) => n.id === `concept:${topic}/${concept.id}`)?.status, "mastered");
	assert.equal(graph.nodes.find((n) => n.id === `concept:${topic}/${concept.id}`)?.progress, 0.97);
	assertSorted(graph);
});

test("related edges cross owners, are unique and have at most three neighbors", (t) => {
	const { store, topics, memory } = fixture(t);
	// The unrelated example packs need not reach the similarity threshold. Add an explicit cross-topic match.
	const graph = topics.readGraph(topic)!;
	graph.concepts.push({ id: "recursion", title: "Use a recursive base case",
		summary: "Recursion makes nested data and self-similar problems easier to express when the base case is explicit.",
		prerequisites: [], difficulty: 1 });
	topics.writeGraph(topic, graph);
	const note = memory.remember({ kind: "insight", text: "A useful bridge", skill, topic });
	const derived = store.build();
	const related = derived.edges.filter((e) => e.kind === "related");
	assert.ok(related.length > 0);
	const degrees = new Map<string, number>();
	const pairs = new Set<string>();
	for (const edge of related) {
		assert.notEqual(owner(edge.from), owner(edge.to));
		assert.ok(edge.weight! >= 0.25 && edge.weight! <= 1);
		const key = JSON.stringify([edge.from, edge.to].sort());
		assert.ok(!pairs.has(key));
		pairs.add(key);
		for (const id of [edge.from, edge.to]) degrees.set(id, (degrees.get(id) ?? 0) + 1);
	}
	assert.ok([...degrees.values()].every((degree) => degree <= 3));
	assert.deepEqual(derived.edges.filter((e) => e.kind === "about" && e.from === `note:${note.id}`)
		.map((e) => e.to).sort(), [skillId, `topic:${topic}`].sort());
});

test("learner links validate, canonicalize, persist and remove undirected pairs", (t) => {
	const { home, store } = fixture(t);
	assert.deepEqual(store.listLinks(), []);
	const target = `topic:${topic}`;
	const link = store.addLink(skillId, target);
	assert.deepEqual(store.addLink(target, skillId), link);
	assert.deepEqual(new KnowledgeStore(home).listLinks(), [link]);
	assert.ok(fs.existsSync(path.join(home, "graph", "links.json")));
	assert.ok(store.build().edges.some((e) => e.kind === "link" && e.from === link.from && e.to === link.to));
	assert.throws(() => store.addLink("missing", target), /missing/);
	assert.throws(() => store.addLink(target, target), /itself/);
	assert.equal(store.removeLink(target, skillId), true);
	assert.equal(store.removeLink(skillId, target), false);
});

test("paths roundtrip, generate prerequisite order, preserve creation time and reject unsafe ids", (t) => {
	const { home, store } = fixture(t);
	const explicit = store.savePath({ id: "explicit", title: "Start Python", goal: "Read code", steps: [root, skillId] });
	assert.deepEqual(store.readPath(explicit.id), explicit);
	const generated = store.savePath({ id: "generated", title: "Python", goal: "Practice", targetId: skillId });
	assert.equal(generated.source, "generated");
	assert.equal(generated.steps.at(-1), skillId);
	for (const edge of store.build().edges.filter((e) => e.kind === "prerequisite" && e.from.startsWith("subskill:"))) {
		assert.ok(generated.steps.indexOf(edge.from) < generated.steps.indexOf(edge.to));
	}
	const updated = store.savePath({ ...explicit, title: "Updated" });
	assert.equal(updated.createdAt, explicit.createdAt);
	assert.equal(store.readPath(explicit.id)?.title, "Updated");
	// Set timestamps explicitly to test ordering without sleeps or dependence on wall-clock resolution.
	for (const [id, updatedAt] of [["explicit", "2026-01-01T00:00:00Z"], ["generated", "2026-02-01T00:00:00Z"]]) {
		fs.writeFileSync(path.join(home, "graph", "paths", `${id}.json`),
			JSON.stringify({ ...store.readPath(id), updatedAt }));
	}
	assert.deepEqual(store.listPaths().map((p) => p.id), ["generated", "explicit"]);
	fs.writeFileSync(path.join(home, "graph", "paths", "explicit.json"),
		JSON.stringify({ ...store.readPath("explicit"), updatedAt: "2026-02-01T00:00:00Z" }));
	assert.deepEqual(store.listPaths().map((p) => p.id), ["explicit", "generated"]);
	assert.throws(() => store.savePath({ title: "Bad", goal: "", steps: ["unknown"] }), /unknown/);
	assert.throws(() => store.savePath({ title: "Bad", goal: "", targetId: "unknown" }), /unknown/);
	for (const id of ["../escape", "a/b", "a\\b", "..", "a..b", "", "/tmp/no", "%2e%2e"]) {
		assert.throws(() => store.savePath({ id, title: "Bad", goal: "" }), /Invalid path id/);
		assert.throws(() => store.readPath(id), /Invalid path id/);
		assert.throws(() => store.deletePath(id), /Invalid path id/);
	}
	assert.equal(store.deletePath(explicit.id), true);
	assert.equal(store.deletePath(explicit.id), false);
	assert.equal(store.readPath(explicit.id), undefined);
	assert.match(store.savePath({ title: "New", goal: "" }).id, /^path-/);
});

function smallGraph(): KnowledgeGraph {
	const node = (id: string, title: string, status: KnowledgeNode["status"] = "new"): KnowledgeNode =>
		({ id, title, kind: id === "s" ? "skill" : "subskill", status });
	return { builtAt: "2026-01-01T00:00:00Z", nodes: [node("s", "Skill"), node("a", "Zebra", "solid"),
		node("b", "Beta"), node("c", "Alpha", "mastered"), node("d", "Delta"), node("outside", "Outside")],
		edges: [{ from: "s", to: "b", kind: "contains" }, { from: "s", to: "c", kind: "contains" },
			{ from: "a", to: "b", kind: "prerequisite" }, { from: "b", to: "d", kind: "prerequisite" },
			{ from: "c", to: "d", kind: "prerequisite" }, { from: "outside", to: "s", kind: "related" }] };
}

test("knowledgePathTo respects topology, completion filtering, title ties and cyclic input", () => {
	const graph = smallGraph();
	assert.deepEqual(knowledgePathTo(graph, "d"), ["b", "d"]);
	assert.deepEqual(knowledgePathTo(graph, "d", { includeDone: true }), ["c", "a", "b", "d"]);
	assert.deepEqual(knowledgePathTo(graph, "s"), ["b", "s"]);
	assert.deepEqual(knowledgePathTo(graph, "s", { includeDone: true }), ["c", "a", "b", "s"]);
	assert.deepEqual(knowledgePathTo(graph, "a"), []);
	assert.deepEqual(knowledgePathTo(graph, "a", { includeDone: true }), ["a"]);
	assert.throws(() => knowledgePathTo(graph, "missing"), /missing/);
	graph.edges.push({ from: "d", to: "a", kind: "prerequisite" });
	const cyclic = knowledgePathTo(graph, "d", { includeDone: true });
	assert.equal(cyclic.at(-1), "d");
	assert.deepEqual(new Set(cyclic), new Set(["a", "b", "c", "d"]));
	assert.deepEqual(knowledgePathTo(graph, "d", { includeDone: true }), cyclic);
	graph.nodes.find((n) => n.id === "c")!.title = "Zebra";
	graph.edges.pop();
	assert.deepEqual(knowledgePathTo(graph, "d", { includeDone: true }), ["a", "b", "c", "d"]);
});

test("neighborhood uses undirected hops and retains precisely the induced edges", (t) => {
	const graph = smallGraph();
	assert.deepEqual(neighborhood(graph, "b", 0).nodes.map((n) => n.id), ["b"]);
	const one = neighborhood(graph, "b");
	assert.deepEqual(one.nodes.map((n) => n.id), ["a", "b", "d", "s"]);
	assert.deepEqual(one.edges.map(edgeKey).sort(), graph.edges.filter((e) =>
		["a", "b", "d", "s"].includes(e.from) && ["a", "b", "d", "s"].includes(e.to)).map(edgeKey).sort());
	const two = neighborhood(graph, "b", 2);
	assert.ok(one.nodes.every((n) => two.nodes.some((other) => other.id === n.id)));
	assert.equal(two.nodes.length, 6);
	assert.equal(two.builtAt, graph.builtAt);
	assert.throws(() => neighborhood(graph, "unknown"), /unknown/);
	assertSorted(two);
	const { store } = fixture(t);
	assert.deepEqual(store.pathTo(skillId), knowledgePathTo(store.build(), skillId));
	assert.deepEqual(store.neighborhood(skillId).nodes, neighborhood(store.build(), skillId).nodes);
});

test("missing, corrupt and wrong-shaped persisted files never break graph or path listing", (t) => {
	const { home, store, practice, topics } = fixture(t);
	fs.mkdirSync(path.join(home, "graph", "paths"), { recursive: true });
	fs.writeFileSync(path.join(home, "graph", "links.json"), "{bad");
	fs.writeFileSync(path.join(home, "graph", "paths", "broken.json"), "{bad");
	fs.writeFileSync(path.join(home, "graph", "paths", "wrong.json"), JSON.stringify({ steps: [1] }));
	assert.doesNotThrow(() => store.build());
	assert.deepEqual(store.listLinks(), []);
	assert.deepEqual(store.listPaths(), []);
	assert.equal(store.readPath("broken"), undefined);
	const plan = practice.readPlan(skill)!;
	const conceptGraph = topics.readGraph(topic)!;
	for (const value of ["{bad", "null", "[]", "42", '{"subskills":{}}']) {
		fs.writeFileSync(path.join(home, "skills", skill, "plan.json"), value);
		fs.writeFileSync(path.join(topics.topicDir(topic), "graph.json"), value);
		fs.writeFileSync(path.join(home, "memory.json"), value);
		assert.doesNotThrow(() => store.build());
	}
	practice.writePlan(plan);
	topics.writeGraph(topic, conceptGraph);
	for (const name of ["progress.json", "challenges.json", "attempts.jsonl"]) {
		fs.writeFileSync(path.join(home, "skills", skill, name), "{bad");
	}
	fs.writeFileSync(path.join(topics.topicDir(topic), "learner.json"), '{"mastery":null}');
	assert.doesNotThrow(() => store.build());
	assert.ok(store.build().nodes.some((n) => n.id === skillId));
	const empty = new KnowledgeStore(path.join(home, "absent"));
	assert.deepEqual(empty.build().nodes, []);
	assert.deepEqual(empty.listPaths(), []);
	assert.equal(fs.existsSync(path.join(home, "absent")), false);
});
