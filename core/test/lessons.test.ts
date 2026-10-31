import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LessonStore, validateLesson } from "../src/lessons.ts";
import { PracticeStore } from "../src/practice.ts";
import type { SkillLesson, SkillPlan } from "../src/types.ts";

const skill = "python-basics";
const subskillId = "variables";
const sourceId = "src-fixture";
const createdAt = "2026-01-01T00:00:00.000Z";

function fixture(t: { after: (fn: () => void) => void }): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-lessons-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return home;
}

function plan(): SkillPlan {
	return {
		skill,
		title: "Python basics",
		targetPerformance: "Write small Python programs",
		whyItMatters: "It makes automation possible.",
		subskills: [{
			id: subskillId,
			title: "Variables",
			why: "Names keep values usable.",
			priority: 1,
			prerequisites: [],
			selfCorrection: "Print the value and inspect its type.",
			drills: ["Assign and inspect a value."],
			status: "active",
		}],
		resources: [],
		barriers: [],
		hoursGoal: 20,
		createdAt,
		updatedAt: createdAt,
	};
}

function sourceFixture(home: string): void {
	const directory = path.join(home, "skills", skill);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(path.join(directory, "sources.json"), JSON.stringify([{
		id: sourceId,
		url: "https://docs.python.org/3/tutorial/",
		title: "The Python tutorial",
		kind: "official-docs",
		rank: 100,
		rankReasons: ["Official documentation"],
		accessedAt: createdAt,
	}], null, "\t") + "\n");
}

function draft(overrides: Partial<SkillLesson> = {}):
	Omit<SkillLesson, "skill" | "subskillId" | "createdAt" | "updatedAt"> {
	return {
		title: "Variables",
		explanation: "A variable gives a value a readable name.",
		keyIdeas: ["Names refer to values.", "Assignment binds a name."],
		citations: [{ sourceId, quote: "Names refer to objects." }],
		...overrides,
	};
}

function setup(t: { after: (fn: () => void) => void }): { home: string; store: LessonStore } {
	const home = fixture(t);
	new PracticeStore(home).writePlan(plan());
	sourceFixture(home);
	return { home, store: new LessonStore(home) };
}

test("writes, reads, lists and atomically replaces source-grounded lessons", (t) => {
	const { home, store } = setup(t);
	const first = store.write(skill, subskillId, {
		...draft(), title: " Variables ", explanation: " A variable gives a value a readable name. ",
		keyIdeas: [" Names refer to values. ", " Assignment binds a name. "], createdAt,
	});
	assert.equal(first.skill, skill);
	assert.equal(first.subskillId, subskillId);
	assert.equal(first.createdAt, createdAt);
	assert.equal(first.title, "Variables");
	assert.equal(first.explanation, "A variable gives a value a readable name.");
	assert.deepEqual(first.keyIdeas, ["Names refer to values.", "Assignment binds a name."]);
	assert.ok(Number.isFinite(Date.parse(first.updatedAt)));
	assert.deepEqual(store.read(skill, subskillId), first);
	assert.deepEqual(store.list(skill), [first]);
	const file = path.join(home, "skills", skill, "lessons", `${subskillId}.json`);
	assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(first, null, "\t") + "\n");
	assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp")), []);

	const second = store.write(skill, subskillId, { ...draft(), title: "Updated variables", createdAt: "2027-01-01" });
	assert.equal(second.createdAt, first.createdAt);
	assert.equal(second.title, "Updated variables");
	assert.ok(Date.parse(second.updatedAt) >= Date.parse(first.updatedAt));
	assert.deepEqual(store.list(skill), [second]);
});

test("validates lesson content, source membership, and the skill plan", (t) => {
	const { store } = setup(t);
	assert.deepEqual(store.validate(skill, subskillId, draft()), []);
	assert.deepEqual(validateLesson(draft()), []);
	const cases: Array<[string, Partial<SkillLesson>, RegExp]> = [
		["explanation", { explanation: " \t" }, /explanation/],
		["too few key ideas", { keyIdeas: ["one"] }, /keyIdeas/],
		["too many key ideas", { keyIdeas: ["1", "2", "3", "4", "5"] }, /keyIdeas/],
		["empty key idea", { keyIdeas: ["one", " "] }, /keyIdeas/],
		["missing citations", { citations: [] }, /citations/],
		["unknown source", { citations: [{ sourceId: "src-missing" }] }, /sourceId/],
		["long quote", { citations: [{ sourceId, quote: "x".repeat(201) }] }, /quote/],
	];
	for (const [name, overrides, pattern] of cases) {
		assert.throws(() => store.write(skill, subskillId, draft(overrides)), pattern, name);
	}
	assert.throws(() => store.write(skill, "missing-subskill", draft()), /Unknown subskill/);
	const missing = new LessonStore(path.join(store.root, "missing"));
	assert.throws(() => missing.write(skill, subskillId, draft()), /Skill plan not found/);
	assert.throws(() => store.write(skill, subskillId, { ...draft(), skill: "other-skill" }), /does not match/);
	assert.throws(() => store.write(skill, subskillId, { ...draft(), subskillId: "other-subskill" }), /does not match/);

	const malformed = {
		...draft(),
		workedExample: { problem: " ", steps: ["ok"], answer: " " },
		pitfalls: ["ok", " "],
	};
	assert.match(validateLesson(malformed).join("; "), /workedExample|pitfalls/);
});

test("rejects invalid skill and subskill slugs without touching the filesystem", (t) => {
	const { home, store } = setup(t);
	for (const invalid of ["", "../escape", "a/b", "a\\b", "Bad-Slug", "a--b", "-a", "a-", "a%2fb"]) {
		assert.throws(() => store.read(invalid, subskillId), /Invalid skill slug/);
		assert.throws(() => store.list(invalid), /Invalid skill slug/);
		assert.throws(() => store.write(invalid, subskillId, draft()), /Invalid skill slug/);
		assert.throws(() => store.read(skill, invalid), /Invalid subskill slug/);
		assert.throws(() => store.write(skill, invalid, draft()), /Invalid subskill slug/);
	}
	assert.equal(fs.existsSync(path.join(home, "skills", "escape")), false);
});

test("absent reads and lists do not create lesson directories", (t) => {
	const home = fixture(t);
	const store = new LessonStore(home);
	assert.equal(store.read(skill, subskillId), undefined);
	assert.deepEqual(store.list(skill), []);
	assert.deepEqual(fs.readdirSync(home), []);
});
