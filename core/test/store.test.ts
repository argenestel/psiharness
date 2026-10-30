import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PsiStore } from "../src/store.ts";
import { schedule } from "../src/fsrs.ts";
import type { Card, ConceptGraph, ExplorableSpec, LessonPlan, Storyboard } from "../src/types.ts";

const now = new Date("2026-01-15T12:00:00.000Z");
const topic = "linear-algebra";
const draft: Pick<Card, "conceptId" | "kind" | "prompt" | "answer" | "choices"> = {
	conceptId: "vectors", kind: "recall", prompt: "What is a vector?", answer: "An arrow with magnitude and direction.",
};

function fixture(t: { after: (fn: () => void) => void }): PsiStore {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-store-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return new PsiStore(home);
}

function graph(name = topic): ConceptGraph {
	return {
		topic: name, title: "Linear algebra", bigIdea: "See transformations", concepts: [],
		createdAt: now.toISOString(), updatedAt: now.toISOString(),
	};
}

test("graph and plan roundtrip with atomic, tab-indented JSON", (t) => {
	const store = fixture(t);
	assert.equal(store.readGraph("unknown-topic"), undefined);
	assert.equal(store.readPlan(topic), undefined);
	const plan: LessonPlan = {
		topic, goal: "Understand vectors", learnerLevel: "curious", lessons: [],
		createdAt: now.toISOString(), updatedAt: now.toISOString(),
	};
	store.writeGraph(topic, graph());
	store.writePlan(topic, plan);
	assert.deepEqual(store.readGraph(topic), graph());
	assert.deepEqual(store.readPlan(topic), plan);
	store.writeGraph(topic, { ...graph(), title: "Updated" });
	assert.equal(store.readGraph(topic)?.title, "Updated");
	assert.equal(fs.readFileSync(path.join(store.topicDir(topic), "plan.json"), "utf8"),
		JSON.stringify(plan, null, "\t") + "\n");
	assert.deepEqual(fs.readdirSync(store.topicDir(topic)).sort(), ["graph.json", "plan.json"]);
});

test("addCards persists unique cards due at initialization and appends later drafts", (t) => {
	const store = fixture(t);
	const cards = store.addCards(topic, [draft, { ...draft, kind: "mcq", choices: ["A", "B"] }], now);
	assert.equal(cards.length, 2);
	assert.ok(cards.every((card) => typeof card.id === "string" && card.id.length > 0));
	assert.equal(new Set(cards.map((card) => card.id)).size, 2);
	assert.ok(cards.every((card) => card.createdAt === now.toISOString() && card.topic === topic));
	assert.equal(Object.hasOwn(cards[0], "choices"), false);
	assert.deepEqual(cards[1].choices, ["A", "B"]);
	assert.deepEqual(store.readCards(topic), cards);
	assert.deepEqual(store.dueCards(topic, now), cards);
	assert.deepEqual(store.dueCards(topic, new Date(now.getTime() - 86_400_000)), []);
	const added = store.addCards(topic, [draft], now);
	assert.deepEqual(store.readCards(topic), [...cards, ...added]);
});

test("dueCards includes all topics and sorts by due time", (t) => {
	const store = fixture(t);
	const earlier = new Date(now.getTime() - 86_400_000);
	const laterCards = store.addCards("alpha-topic", [draft], now);
	const earlierCards = store.addCards("beta-topic", [draft], earlier);
	assert.deepEqual(store.dueCards(undefined, now), [...earlierCards, ...laterCards]);
});

test("review persists FSRS, review history, and successful mastery", (t) => {
	const store = fixture(t);
	const [card] = store.addCards(topic, [draft], now);
	const expected = schedule(card.fsrs, 3, now);
	const updated = store.review(topic, card.id, 3, now);
	assert.deepEqual(updated.fsrs, expected.state);
	assert.equal(updated.fsrs.reps, card.fsrs.reps + 1);
	assert.notEqual(updated.fsrs.state, card.fsrs.state);
	assert.equal(updated.fsrs.lastReview, now.toISOString());
	assert.deepEqual(store.readCards(topic), [updated]);
	assert.deepEqual(store.readReviews(topic), [{
		cardId: card.id, rating: 3, reviewedAt: now.toISOString(),
		elapsedDays: expected.log.elapsedDays, scheduledDays: expected.log.scheduledDays,
	}]);
	const lines = fs.readFileSync(path.join(store.topicDir(topic), "reviews.jsonl"), "utf8").trim().split("\n");
	assert.equal(lines.length, 1);
	assert.deepEqual(JSON.parse(lines[0]), store.readReviews(topic)[0]);
	const learner = store.readLearner(topic)!;
	assert.equal(learner.mastery.vectors.attempts, 1);
	assert.equal(learner.mastery.vectors.correct, 1);
	assert.equal(learner.updatedAt, now.toISOString());
	assert.deepEqual(learner.notes, []);
	fs.appendFileSync(path.join(store.topicDir(topic), "reviews.jsonl"), "\n \n");
	assert.equal(store.readReviews(topic).length, 1);
});

test("failed reviews update attempts while preserving existing learner notes", (t) => {
	const store = fixture(t);
	const [card] = store.addCards(topic, [draft], now);
	store.writeLearner(topic, { topic, mastery: {}, notes: ["Prefers diagrams"], updatedAt: now.toISOString() });
	store.review(topic, card.id, 1, now);
	assert.equal(store.readLearner(topic)?.mastery.vectors.attempts, 1);
	assert.equal(store.readLearner(topic)?.mastery.vectors.correct, 0);
	store.review(topic, card.id, 3, now);
	assert.equal(store.readLearner(topic)?.mastery.vectors.attempts, 2);
	assert.equal(store.readLearner(topic)?.mastery.vectors.correct, 1);
	assert.deepEqual(store.readLearner(topic)?.notes, ["Prefers diagrams"]);
	assert.equal(store.readReviews(topic).length, 2);
	assert.throws(() => store.review(topic, "missing-card", 3, now), /Card not found/);
});

test("artifacts support text and bytes, sorted filenames, and reject unsafe paths", (t) => {
	const store = fixture(t);
	const file = store.writeArtifact(topic, "lesson.html", "<p>Vectors</p>");
	assert.equal(path.isAbsolute(file), true);
	assert.equal(fs.readFileSync(file, "utf8"), "<p>Vectors</p>");
	const binary = store.writeArtifact(topic, "image.bin", new Uint8Array([0, 1, 255]));
	assert.deepEqual([...fs.readFileSync(binary)], [0, 1, 255]);
	for (const name of ["../evil.html", "a/b.html", "..\\x", "", ".", "..", "/tmp/evil.html"]) {
		assert.throws(() => store.writeArtifact(topic, name, "x"), /Invalid artifact filename/);
	}
	assert.deepEqual(store.listArtifacts(topic), ["image.bin", "lesson.html"]);
	assert.equal(fs.existsSync(path.join(store.topicDir(topic), "evil.html")), false);
	assert.deepEqual(fs.readdirSync(store.root), ["topics"]);
});

test("topic paths reject invalid slugs", (t) => {
	const store = fixture(t);
	assert.throws(() => store.readGraph("../etc"), /Invalid topic slug/);
	for (const invalid of ["Bad Topic", "", "a/b", "a\\b", "-topic", "topic-", "a--b"]) {
		assert.throws(() => store.topicDir(invalid), /Invalid topic slug/);
	}
});

test("listTopics returns sorted directories", (t) => {
	const store = fixture(t);
	assert.deepEqual(store.listTopics(), []);
	store.writeGraph("beta-topic", graph("beta-topic"));
	store.writeGraph("alpha-topic", graph("alpha-topic"));
	fs.writeFileSync(path.join(store.root, "topics", "ignore.txt"), "not a directory");
	assert.deepEqual(store.listTopics(), ["alpha-topic", "beta-topic"]);
});

test("notes append in order", (t) => {
	const store = fixture(t);
	store.appendNote(topic, "First note");
	store.appendNote(topic, "Second note");
	assert.equal(store.readNotes(topic), "First note\nSecond note\n");
});

test("absent reads and directory paths do not create topic directories", (t) => {
	const store = fixture(t);
	assert.equal(store.readGraph(topic), undefined);
	assert.equal(store.readPlan(topic), undefined);
	assert.equal(store.readLearner(topic), undefined);
	assert.deepEqual(store.readCards(topic), []);
	assert.deepEqual(store.readReviews(topic), []);
	assert.equal(store.readNotes(topic), "");
	assert.equal(store.readStoryboard(topic, "intro"), undefined);
	assert.equal(store.readExplorable(topic, "plot"), undefined);
	assert.deepEqual(store.listArtifacts(topic), []);
	assert.deepEqual(store.dueCards(), []);
	assert.ok(path.isAbsolute(store.artifactsDir(topic)));
	assert.deepEqual(fs.readdirSync(store.root), []);
});

test("storyboards and explorables roundtrip with validated ids", (t) => {
	const store = fixture(t);
	const storyboard: Storyboard = { id: "intro-1", topic, title: "Vectors", style: "3b1b", scenes: [] };
	const explorable: ExplorableSpec = {
		id: "plot-1", topic, title: "Plot", style: "plain", template: "function-plot",
		params: {}, sliders: [], prompts: [],
	};
	store.saveStoryboard(storyboard);
	store.saveExplorable(explorable);
	assert.deepEqual(store.readStoryboard(topic, storyboard.id), storyboard);
	assert.deepEqual(store.readExplorable(topic, explorable.id), explorable);
	for (const id of ["../escape", "a/b", "a\\b", "a..b", ""]) {
		assert.throws(() => store.saveStoryboard({ ...storyboard, id }), /Invalid id/);
		assert.throws(() => store.readStoryboard(topic, id), /Invalid id/);
		assert.throws(() => store.saveExplorable({ ...explorable, id }), /Invalid id/);
		assert.throws(() => store.readExplorable(topic, id), /Invalid id/);
	}
});

test("malformed JSON surfaces errors rather than looking absent", (t) => {
	const store = fixture(t);
	store.writeGraph(topic, graph());
	fs.writeFileSync(path.join(store.topicDir(topic), "graph.json"), "{");
	assert.throws(() => store.readGraph(topic), SyntaxError);
});

test("default home reads PSI_HOME at construction time", (t) => {
	const first = fixture(t);
	const second = fixture(t);
	const previous = process.env.PSI_HOME;
	try {
		process.env.PSI_HOME = first.root;
		assert.equal(new PsiStore().root, first.root);
		process.env.PSI_HOME = second.root;
		assert.equal(new PsiStore().root, second.root);
	} finally {
		if (previous === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previous;
	}
});
