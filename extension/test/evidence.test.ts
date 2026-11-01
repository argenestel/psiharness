import test from "node:test";
import assert from "node:assert/strict";
import type { Source } from "../../core/src/types.ts";
import { bm25, tokenize, rankEvidence, evidenceVerdict, mapVerdict } from "../src/practice/evidence.ts";

const source: Source = { id: "src-test", title: "Reference", url: "https://example.org/", rank: 80,
	kind: "reference", rankReasons: [], accessedAt: "2026-01-01T00:00:00Z" };
const passages = (text: string, claim: string) => rankEvidence(claim, [{ source, text }]);

test("BM25 ranks relevance and gives rare terms more weight", () => {
	const scores = bm25("common rare", ["common", "common", "rare", "unrelated"]);
	assert.ok(scores[2]! > scores[0]!);
	assert.ok(scores[0]! > scores[3]!);
});

test("numeric and code tokens survive tokenization and receive a 0.35 match boost", () => {
	assert.deepEqual(tokenize("3.14 O(n^2) sql_join x_1"), ["3.14", "o(n^2)", "sql_join", "x_1"]);
	const evidence = passages("Algorithm uses O(n^2) and x_1 with 3.14. Bananas grow.", "O(n^2) x_1 3.14");
	assert.ok(Math.abs(evidence[0]!.score - evidence[0]!.bm25 - 1.05) < 0.00001);
});

test("passages include source metadata, sentence index, scores and neighbours", () => {
	const evidence = passages("Before context. Python lists are mutable. After context. Extra sentence.", "Python lists mutable");
	assert.equal(evidence.length, 4);
	assert.equal(evidence[0]!.sentenceIndex, 1);
	assert.match(evidence[0]!.context, /Before context.*After context/);
	assert.equal(evidence[0]!.sourceId, source.id);
	assert.ok(evidence[0]!.bm25 > 0);
	assert.equal(passages("One. Two. Three. Four. Five. Six. Seven.", "One").length, 6);
});

test("conservative evidence signals guard semantics, missing numbers and irrelevant text", () => {
	for (const [claim, text, expected] of [
		["The timer lasts 10 seconds", "The timer lasts 10 seconds. Bananas grow on trees.", "likely-supported"],
		["A LEFT JOIN returns only matching rows", "A LEFT JOIN returns all rows from the left table.", "unclear"],
		["Python lists are mutable", "Python lists are not mutable. Other information.", "possibly-contradicted"],
		["Python lists are mutable", "Bananas grow on trees.", "unclear"],
		["The timer lasts 10 seconds", "The timer lasts 20 seconds.", "unclear"],
		["Python lists are mutable", "Python lists may be mutable.", "unclear"],
	]) {
		assert.equal(evidenceVerdict(claim!, passages(text!, claim!)), expected, claim);
	}
});

test("legacy verdicts map to uncertain evidence labels", () => {
	assert.equal(mapVerdict("supported"), "likely-supported");
	assert.equal(mapVerdict("contradicted"), "possibly-contradicted");
	assert.equal(mapVerdict("unclear"), "unclear");
});
