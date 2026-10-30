import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Concept, ConceptGraph } from "../src/types.ts";
import { ancestors, frontier, pathTo, toMermaid, topoOrder, validateGraph } from "../src/graph.ts";
import { newId, nowIso, slugify } from "../src/slug.ts";

const concept = (id: string, prerequisites: string[] = [], difficulty: Concept["difficulty"] = 1): Concept =>
	({ id, title: id, summary: "", prerequisites, difficulty });
const graph = (...concepts: Concept[]): ConceptGraph =>
	({ topic: "test", title: "Test", bigIdea: "", concepts, createdAt: "", updatedAt: "" });

describe("graph validation", () => {
	test("names cycle paths", () => {
		const g = graph(concept("a", ["b"]), concept("b", ["c"]), concept("c", ["a"]));
		assert.match(validateGraph(g).join("; "), /cycle detected: a -> b -> c -> a/);
		assert.throws(() => topoOrder(g), /cycle detected/);
	});
	for (const [name, g, pattern] of [
		["duplicates", graph(concept("a"), concept("a")), /duplicate.*a/],
		["unknown prerequisites", graph(concept("a", ["missing"])), /unknown.*missing/],
		["self-loops", graph(concept("a", ["a"])), /self-loop.*a/],
		["non-kebab identifiers", graph(concept("Not_kebab")), /non-kebab/],
	] as const) {
		test(name, () => assert.match(validateGraph(g).join("; "), pattern));
	}
});

describe("graph algorithms", () => {
	const g = graph(concept("target", ["b", "c"]), concept("c", ["a"]), concept("a"), concept("b", ["a"]));
	test("frontier requires every prerequisite", () => {
		assert.deepEqual(frontier(g, new Set()).map(c => c.id), ["a"]);
		assert.deepEqual(frontier(g, new Set(["a", "b"])).map(c => c.id), ["c"]);
		assert.deepEqual(frontier(g, new Set(["a", "b", "c", "target"])), []);
	});
	test("paths exclude mastered ancestors but always include target", () => {
		assert.deepEqual(pathTo(g, "target", new Set(["a", "target"])), ["b", "c", "target"]);
		assert.deepEqual(ancestors(g, "target"), new Set(["a", "b", "c"]));
		assert.throws(() => ancestors(g, "missing"), /unknown concept/);
		assert.throws(() => pathTo(g, "missing", new Set()), /unknown concept/);
	});
	test("Kahn ties use difficulty then id, including newly ready concepts", () => {
		const ordered = graph(concept("z", [], 3), concept("b", [], 2), concept("a", [], 2), concept("c", ["a"]));
		assert.deepEqual(topoOrder(ordered), ["a", "c", "b", "z"]);
		assert.deepEqual(topoOrder({ ...ordered, concepts: [...ordered.concepts].reverse() }), ["a", "c", "b", "z"]);
	});
	test("empty graphs and repeated prerequisites are supported", () => {
		assert.deepEqual(validateGraph(graph()), []);
		assert.deepEqual(topoOrder(graph()), []);
		assert.deepEqual(topoOrder(graph(concept("b", ["a", "a"]), concept("a"))), ["a", "b"]);
	});
	test("Mermaid is deterministic, escapes titles, and marks mastered nodes", () => {
		const m = graph({ ...concept("end"), title: 'A "quote" <tag>\nline' }, concept("2", ["end"]));
		const output = toMermaid(m, new Set(["end"]));
		assert.match(output, /^flowchart TD/);
		assert.match(output, /classDef mastered/);
		assert.match(output, /class concept_end mastered;/);
		assert.match(output, /concept_end --> concept_2/);
		assert.match(output, /&quot;quote&quot; &lt;tag&gt; line/);
		assert.equal(output, toMermaid({ ...m, concepts: [...m.concepts].reverse() }, new Set(["end"])));
	});
});

describe("slug helpers", () => {
	test("folds accents, collapses punctuation, and trims truncation", () => {
		assert.equal(slugify(" Café / déjà vu! "), "cafe-deja-vu");
		assert.equal(slugify("!!!"), "");
		assert.equal(slugify(`${"a".repeat(63)} xyz`), "a".repeat(63));
		assert.equal(slugify("a".repeat(80)).length, 64);
	});
	test("formats timestamps and generates prefixed base36 IDs", () => {
		assert.equal(nowIso(new Date("2026-01-01Z")), "2026-01-01T00:00:00.000Z");
		const ids = Array.from({ length: 100 }, () => newId("card"));
		assert.ok(ids.every(id => /^card-[a-z0-9]{8}$/.test(id)));
		assert.equal(new Set(ids).size, ids.length);
	});
});
