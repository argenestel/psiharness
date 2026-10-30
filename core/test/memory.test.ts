import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryStore } from "../src/memory.ts";
import type { LearnerMemory, MemoryKind, SessionRecap } from "../src/types.ts";

function fixture(t: { after: (fn: () => void) => void }) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-memory-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return { home, store: new MemoryStore(home), file: path.join(home, "memory.json") };
}

function recap(overrides: Partial<Omit<SessionRecap, "id">> = {}): Omit<SessionRecap, "id"> {
	return { date: "2026-01-01T12:00:00.000Z", minutes: 20, summary: "Learned joins", next: "Try grouping",
		wins: ["Joined tables"], struggles: [], ...overrides };
}

function seed(file: string, data: LearnerMemory): void {
	fs.writeFileSync(file, JSON.stringify(data));
}

test("missing and corrupt files return usable defaults; partial files preserve valid records", (t) => {
	const { file, store } = fixture(t);
	assert.deepEqual(store.read().items, []);
	assert.deepEqual(store.read().recaps, []);
	for (const text of ["{", "null", "42", '{"items":{},"recaps":null}']) {
		fs.writeFileSync(file, text);
		assert.deepEqual(store.read().items, []);
		assert.deepEqual(store.read().recaps, []);
	}
	fs.writeFileSync(file, '{"name":" Ada ","items":[null,{}],"recaps":[null,{}]}');
	assert.equal(store.read().name, "Ada");
	assert.deepEqual(store.read().items, []);
	store.remember({ kind: "goal", text: "Write SQL queries" });
	assert.equal(store.read().items.length, 1);
});

test("remember validates kinds and text, trims and truncates, and defaults confidence by source", (t) => {
	const { store } = fixture(t);
	assert.throws(() => store.remember({ kind: "bogus" as MemoryKind, text: "hello" }), /kind/);
	assert.throws(() => store.remember({ kind: "goal", text: " \n\t" }), /empty/);
	assert.equal(store.remember({ kind: "goal", text: " learner " }).confidence, 0.9);
	assert.equal(store.remember({ kind: "goal", text: "observed", source: "observed" }).confidence, 0.6);
	assert.equal(store.remember({ kind: "goal", text: "inferred", source: "inferred" }).confidence, 0.5);
	const long = store.remember({ kind: "goal", text: `  ${"x".repeat(399)} z  `, confidence: 4 });
	assert.equal(long.text.length, 399);
	assert.equal(long.confidence, 1);
	assert.equal(store.remember({ kind: "constraint", text: "limited time", confidence: -1 }).confidence, 0);
});

test("similar facts merge by kind with newer text and increased confidence", (t) => {
	const { store } = fixture(t);
	const first = store.remember({ kind: "preference", text: "I learn using short practical examples" });
	const merged = store.remember({ kind: "preference", text: "Short practical examples help learn" });
	assert.equal(merged.id, first.id);
	assert.equal(merged.createdAt, first.createdAt);
	assert.equal(merged.text, "Short practical examples help learn");
	assert.equal(merged.confidence, 1);
	assert.equal(store.read().items.length, 1);
	store.remember({ kind: "insight", text: merged.text });
	assert.equal(store.read().items.length, 2);
	const observed = store.remember({ kind: "goal", text: "Build reliable servers", source: "observed" });
	const inferred = store.remember({ kind: "goal", text: observed.text, source: "inferred" });
	assert.equal(inferred.confidence, 0.7);
});

test("deduplication handles Unicode and empty-token texts without merging unrelated stopwords", (t) => {
	const { store } = fixture(t);
	const first = store.remember({ kind: "goal", text: "Écrire français 日本語" });
	assert.equal(store.remember({ kind: "goal", text: "ÉCRIRE français 日本語!" }).id, first.id);
	const stopword = store.remember({ kind: "goal", text: "I am" });
	assert.notEqual(store.remember({ kind: "goal", text: "you are" }).id, stopword.id);
	const empty = store.remember({ kind: "constraint", text: "THE and" });
	assert.equal(store.remember({ kind: "constraint", text: "the, AND!" }).id, empty.id);
	assert.notEqual(store.remember({ kind: "constraint", text: "you are" }).id, empty.id);
});

test("update validates, clamps, preserves identity, and persists changes", (t) => {
	const { store, home } = fixture(t);
	const item = store.remember({ kind: "goal", text: "Learn databases" });
	assert.throws(() => store.update("missing", { text: "hello" }), /not found/);
	assert.throws(() => store.update(item.id, { text: " " }), /empty/);
	assert.throws(() => store.update(item.id, { kind: "bad" as MemoryKind }), /kind/);
	const updated = store.update(item.id, { kind: "strength", text: " z ".repeat(300), confidence: -5,
		source: "observed", skill: "sql", topic: "databases" });
	assert.equal(updated.id, item.id);
	assert.equal(updated.createdAt, item.createdAt);
	assert.ok(updated.text.length <= 400);
	assert.equal(updated.confidence, 0);
	assert.equal(updated.kind, "strength");
	assert.deepEqual(new MemoryStore(home).read().items[0], updated);
});

test("recall ranks matching skill and topic above otherwise identical facts", (t) => {
	const { store } = fixture(t);
	const other = store.remember({ kind: "goal", text: "Practice joins", skill: "other" });
	const match = store.remember({ kind: "insight", text: other.text, skill: "sql", topic: "databases" });
	assert.equal(store.recall({ skill: "sql" })[0].id, match.id);
	assert.equal(store.recall({ topic: "databases" })[0].id, match.id);
	assert.equal(store.recall({ query: "joins" }).length, 2);
});

test("recall query overlap, recency decay, and stable tie breakers determine order", (t) => {
	const { store, file } = fixture(t);
	const first = store.remember({ kind: "goal", text: "Cook pasta", confidence: 1 });
	const second = store.remember({ kind: "goal", text: "Join database tables", confidence: 0 });
	assert.equal(store.recall({ query: "database tables" })[0].id, second.id);
	const data = store.read();
	data.items = data.items.map((item, index) => ({ ...item, confidence: 0.5,
		updatedAt: index ? "2025-01-01T00:00:00.000Z" : "2000-01-01T00:00:00.000Z" }));
	seed(file, data);
	assert.equal(store.recall()[0].id, second.id);
	data.items = data.items.map((item) => ({ ...item, updatedAt: "2025-01-01T00:00:00.000Z" }));
	seed(file, data);
	assert.deepEqual(store.recall().map((item) => item.id), [first.id, second.id].sort());
});

test("recall filters only by kind, respects limits, and persists lastUsedAt", (t) => {
	const { store, home, file } = fixture(t);
	store.remember({ kind: "goal", text: "Build a website" });
	const preference = store.remember({ kind: "preference", text: "Use examples", skill: "html" });
	const results = store.recall({ kind: "preference", skill: "unrelated", topic: "unrelated" });
	assert.equal(results.length, 1);
	assert.equal(results[0].id, preference.id);
	assert.ok(Number.isFinite(Date.parse(results[0].lastUsedAt!)));
	assert.equal(new MemoryStore(home).read().items.find((item) => item.id === preference.id)?.lastUsedAt,
		results[0].lastUsedAt);
	const before = fs.readFileSync(file, "utf8");
	assert.deepEqual(store.recall({ limit: 0 }), []);
	assert.deepEqual(store.recall({ limit: -1 }), []);
	assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("forget persists removals and leaves the file untouched for unknown ids", (t) => {
	const { store, file, home } = fixture(t);
	const item = store.remember({ kind: "goal", text: "Play piano" });
	const before = fs.readFileSync(file, "utf8");
	assert.equal(store.forget("missing"), false);
	assert.equal(fs.readFileSync(file, "utf8"), before);
	assert.equal(store.forget(item.id), true);
	assert.deepEqual(new MemoryStore(home).read().items, []);
});

test("item cap removes lowest confidence first and oldest on equal confidence", (t) => {
	const { store, file } = fixture(t);
	const ids: string[] = [];
	for (let i = 0; i < 305; i++) {
		if (i === 300) {
			const data = store.read();
			data.items[0].updatedAt = "2000-01-01T00:00:00.000Z";
			data.items[1].updatedAt = "2001-01-01T00:00:00.000Z";
			data.items[2].updatedAt = "2002-01-01T00:00:00.000Z";
			seed(file, data);
		}
		ids.push(store.remember({ kind: "goal", text: `unique${i}`, confidence: i < 3 ? 0.1 : 0.9 }).id);
		if (i === 300) assert.equal(store.read().items.some((item) => item.id === ids[0]), false);
	}
	const items = store.read().items;
	assert.equal(items.length, 300);
	for (const id of ids.slice(0, 3)) assert.equal(items.some((item) => item.id === id), false);
	assert.equal(items.some((item) => item.id === ids[304]), true);
});

test("recaps trim text, clamp minutes, and retain the latest hundred by date", (t) => {
	const { store } = fixture(t);
	for (let i = 104; i >= 0; i--) {
		const date = new Date(Date.UTC(2025, 0, i + 1)).toISOString();
		store.addRecap(recap({ date, summary: ` Session ${i} `, next: " Next task " }));
	}
	assert.equal(store.read().recaps.length, 100);
	assert.equal(store.recentRecaps(100).at(-1)?.summary, "Session 5");
	assert.equal(store.recentRecaps()[0].summary, "Session 104");
	assert.equal(store.recentRecaps()[0].next, "Next task");
	assert.deepEqual(store.recentRecaps(0), []);
	assert.equal(store.addRecap(recap({ minutes: NaN })).minutes, 0);
	assert.equal(store.addRecap(recap({ minutes: -4 })).minutes, 0);
	assert.equal(store.addRecap(recap({ minutes: Infinity })).minutes, 0);
});

test("summarize orders nonempty sections, prefers matching facts, and selects a matching recap", (t) => {
	const { store } = fixture(t);
	assert.equal(store.summarize(), "");
	store.setName(" Ada ");
	store.remember({ kind: "goal", text: "Play piano", confidence: 1 });
	store.remember({ kind: "goal", text: "Write queries", skill: "sql", confidence: 0.2 });
	store.remember({ kind: "preference", text: "Concrete examples" });
	store.remember({ kind: "struggle", text: "Nested joins" });
	store.remember({ kind: "background", text: "Spreadsheet experience" });
	store.addRecap(recap({ skill: "sql", summary: "SQL session" }));
	store.addRecap(recap({ skill: "piano", date: "2026-02-01T00:00:00.000Z", summary: "Piano session" }));
	const output = store.summarize({ skill: "sql" });
	assert.ok(output.startsWith("Learner: Ada"));
	const headings = ["## Goals", "## How they learn best", "## Watch out for",
		"## Background & constraints", "## Last session"];
	for (let i = 1; i < headings.length; i++) {
		assert.ok(output.indexOf(headings[i - 1]) < output.indexOf(headings[i]));
	}
	assert.ok(output.indexOf("Write queries") < output.indexOf("Play piano"));
	assert.ok(output.includes("2026-01-01, 20 min: SQL session"));
	assert.ok(output.includes("- Next: Try grouping"));
	assert.ok(!output.includes("Piano session"));
	assert.ok(store.summarize().includes("Piano session"));
	assert.ok(!store.summarize({ skill: "missing" }).includes("## Last session"));
	assert.equal(output, store.summarize({ skill: "sql" }));
	assert.ok(output.length <= 1800);
	assert.ok(store.summarize({ maxChars: 200 }).length <= 200);
});

test("summarize omits empty sections and handles long first bullets and tiny limits", (t) => {
	const { store, file } = fixture(t);
	store.remember({ kind: "goal", text: "x".repeat(400) });
	const before = fs.readFileSync(file, "utf8");
	assert.equal(store.summarize(), `## Goals\n- ${"x".repeat(400)}`);
	assert.ok(!store.summarize().includes("## Last session"));
	for (const maxChars of [0, 1, 2, 9, 20, 100, 200]) {
		const output = store.summarize({ maxChars });
		assert.ok(output.length <= maxChars);
		if (maxChars) assert.ok(output.endsWith("…"));
	}
	assert.ok(store.summarize({ maxChars: 20 }).startsWith("## Goals\n- "));
	assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("atomic tab-indented snapshots persist names, items, and recaps across instances", (t) => {
	const { store, home, file } = fixture(t);
	store.setName(" Ada ");
	const item = store.remember({ kind: "goal", text: "Learn statistics" });
	const session = store.addRecap(recap());
	const fresh = new MemoryStore(home).read();
	assert.equal(fresh.name, "Ada");
	assert.deepEqual(fresh.items, [item]);
	assert.deepEqual(fresh.recaps, [session]);
	const text = fs.readFileSync(file, "utf8");
	assert.ok(text.includes("\n\t"));
	assert.ok(text.endsWith("\n"));
	assert.deepEqual(JSON.parse(text), fresh);
	assert.equal(fs.readdirSync(home).some((name) => name.endsWith(".tmp")), false);
	store.setName("  ");
	assert.equal(new MemoryStore(home).read().name, undefined);
});

test("writes create missing home directories and PSI_HOME is read at construction", (t) => {
	const { home } = fixture(t);
	const nested = path.join(home, "nested", "home");
	new MemoryStore(nested).setName("Ada");
	assert.equal(new MemoryStore(nested).read().name, "Ada");
	const previous = process.env.PSI_HOME;
	try {
		process.env.PSI_HOME = home;
		new MemoryStore().setName("Grace");
		assert.equal(new MemoryStore(home).read().name, "Grace");
	} finally {
		if (previous === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previous;
	}
});
