import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PracticeStore, nextSubskill, validateChallenge } from "../src/practice.ts";
import type { Challenge, SkillPlan, Subskill } from "../src/types.ts";

const skill = "sql-queries";
const now = new Date("2026-01-15T12:00:00.000Z");
const draft = { skill, subskillId: "joins", kind: "predict", level: 1, prompt: "Answer?", expected: "yes" } as const;

function fixture(t: { after: (fn: () => void) => void }): PracticeStore {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-practice-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return new PracticeStore(home);
}

function subskill(id: string, patch: Partial<Subskill> = {}): Subskill {
	return { id, title: id, why: "Useful", priority: 1, prerequisites: [], selfCorrection: "Check",
		drills: [], status: "active", ...patch };
}

function plan(subskills: Subskill[] = []): SkillPlan {
	return { skill, title: "SQL", targetPerformance: "Query", whyItMatters: "Work", subskills,
		resources: [], barriers: [], hoursGoal: 20, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

function answerChallenge(patch: Partial<Challenge> = {}): Challenge {
	return { ...draft, id: "c", hints: [], createdAt: now.toISOString(), ...patch };
}

test("absent reads stay empty and do not create directories", (t) => {
	const store = fixture(t);
	assert.deepEqual(store.listSkills(), []);
	assert.equal(store.readPlan(skill), undefined);
	assert.equal(store.getChallenge(skill, "missing"), undefined);
	assert.deepEqual(store.listChallenges(skill, { unattempted: true }), []);
	assert.equal(store.activeSession(), undefined);
	assert.equal(store.endSession(skill), undefined);
	assert.deepEqual(store.progress(skill), { skill, xp: 0, level: 1, streakDays: 0,
		minutesLogged: 0, attempts: 0, successes: 0, failures: 0, badges: [] });
	assert.deepEqual(store.hours(skill), { logged: 0, goal: 20 });
	assert.deepEqual(fs.readdirSync(store.root), []);
});

test("plans roundtrip in tab-indented JSON, sorted skills ignore invalid entries", (t) => {
	const store = fixture(t);
	const p = plan([subskill("joins")]);
	store.writePlan(p);
	assert.deepEqual(new PracticeStore(store.root).readPlan(skill), p);
	const directory = path.join(store.root, "skills", skill);
	assert.equal(fs.readFileSync(path.join(directory, "plan.json"), "utf8"), JSON.stringify(p, null, "\t") + "\n");
	store.setSubskillStatus(skill, "joins", "solid");
	assert.equal(store.readPlan(skill)?.subskills[0].status, "solid");
	assert.throws(() => store.setSubskillStatus(skill, "missing", "solid"), /Unknown subskill/);
	assert.throws(() => store.setSubskillStatus("absent", "missing", "solid"), /Unknown subskill/);
	store.writePlan({ ...p, skill: "a-skill", hoursGoal: 5 });
	assert.equal(store.hours("a-skill").goal, 5);
	fs.mkdirSync(path.join(store.root, "skills", "Bad Slug"));
	fs.writeFileSync(path.join(store.root, "skills", "ignore"), "file");
	assert.deepEqual(store.listSkills(), ["a-skill", skill]);
	assert.deepEqual(fs.readdirSync(directory), ["plan.json"]);
});

test("nextSubskill respects priority, solid prerequisites, unknown prerequisites, and stable ties", (t) => {
	const store = fixture(t);
	const p = plan([subskill("solid", { status: "solid" }), subskill("later", { priority: 3 }),
		subskill("blocked", { prerequisites: ["missing"] }),
		subskill("first", { prerequisites: ["solid"] }), subskill("tie")]);
	assert.equal(nextSubskill(p)?.id, "first");
	assert.equal(store.nextSubskill(p)?.id, "first");
	assert.equal(p.subskills[3].status, "active");
	p.subskills[3].status = "solid";
	assert.equal(nextSubskill(p)?.id, "tie");
	assert.equal(nextSubskill(plan([subskill("done", { status: "solid" })])), undefined);
});

test("checkAnswer normalizes case, whitespace, wrappers, punctuation and unicode minus", (t) => {
	const store = fixture(t);
	for (const text of [" YES ", '"yes"', "'yes'", "`yes`", "yes.", "yes!?", "“yes”", "(yes)"]) {
		assert.equal(store.checkAnswer(answerChallenge(), text), "success", text);
	}
	assert.equal(store.checkAnswer(answerChallenge({ expected: "hello world" }), " HELLO   world. "), "success");
	for (const minus of ["−", "–", "—", "－"]) {
		assert.equal(store.checkAnswer(answerChallenge({ expected: "-3" }), `${minus}3`), "success");
	}
	assert.equal(store.checkAnswer(answerChallenge(), "no"), "fail");
	assert.equal(store.checkAnswer(answerChallenge({ expected: undefined, acceptable: ["yes"] }), "yes"), undefined);
	assert.equal(store.checkAnswer(answerChallenge({ expected: "  " }), "yes"), undefined);
});

test("checkAnswer supports grouped numbers, fractions, percentages and acceptable numeric alternatives", (t) => {
	const store = fixture(t);
	for (const [expected, answer] of [
		["1000", "1,000"], ["1,000", "1000"], ["0.75", "3/4"], ["3/4", "0.75"],
		["0.75", "75%"], ["75%", "0.75"], ["75%", "75%"], ["-0.75", "−3/4"], ["0.75", ".75"],
	]) assert.equal(store.checkAnswer(answerChallenge({ expected }), answer), "success", `${expected} / ${answer}`);
	for (const [expected, answer] of [["75%", "75"], ["75", "75%"], ["1000", "1,00,0"],
		["1000", "10,00"], ["0.75", "3/0"], ["0", "Infinity"], ["0", "NaN"], ["10", "10 apples"]]) {
		assert.equal(store.checkAnswer(answerChallenge({ expected }), answer), "fail");
	}
	assert.equal(store.checkAnswer(answerChallenge({ acceptable: ["Indeed!"] }), '"indeed"'), "success");
	assert.equal(store.checkAnswer(answerChallenge({ acceptable: ["3/4"] }), "75%"), "success");
});

test("checkAnswer defaults to relative tolerance but explicit tolerance is absolute", (t) => {
	const store = fixture(t);
	assert.equal(store.checkAnswer(answerChallenge({ expected: "1" }), "1.0000000005"), "success");
	assert.equal(store.checkAnswer(answerChallenge({ expected: "1" }), "1.000000002"), "fail");
	assert.equal(store.checkAnswer(answerChallenge({ expected: "1000000" }), "1000000.0005"), "success");
	assert.equal(store.checkAnswer(answerChallenge({ expected: "1000", tolerance: 0.1 }), "1000.05"), "success");
	assert.equal(store.checkAnswer(answerChallenge({ expected: "1000", tolerance: 0.1 }), "1001"), "fail");
	assert.equal(store.checkAnswer(answerChallenge({ expected: "1", tolerance: 0 }), "1.0000000001"), "fail");
});

test("challenges persist unique ids, hints, filtering and unattempted state", (t) => {
	const store = fixture(t);
	const first = store.addChallenge(draft);
	const second = store.addChallenge({ ...draft, subskillId: "select", hints: ["Try"] });
	assert.notEqual(first.id, second.id);
	assert.deepEqual(first.hints, []);
	assert.deepEqual(second.hints, ["Try"]);
	assert.ok(Number.isFinite(Date.parse(first.createdAt)));
	assert.deepEqual(store.getChallenge(skill, first.id), first);
	assert.deepEqual(store.listChallenges(skill, { subskillId: "select" }), [second]);
	store.recordAttempt({ challengeId: first.id, answer: "", outcome: "skipped", hintsUsed: 0 });
	assert.deepEqual(store.listChallenges(skill, { unattempted: true }), [second]);
	assert.equal(store.progress(skill).attempts, 1);
	assert.equal(store.progress(skill).xp, 0);
	assert.throws(() => store.recordAttempt({ challengeId: "missing", answer: "", outcome: "success", hintsUsed: 0 }),
		/Challenge not found/);
});

test("attempts update progress and levels from XP before the attempt and persist session links", (t) => {
	const store = fixture(t);
	const c = store.addChallenge({ ...draft, kind: "boss" });
	store.startSession(skill, "joins", now);
	const record = (outcome: "success" | "partial" | "fail", at = now.toISOString()) =>
		store.recordAttempt({ challengeId: c.id, answer: "yes", outcome, hintsUsed: 0, at });
	const first = record("success");
	assert.equal(first.attempt.xp, 30);
	assert.equal(first.leveledUp, false);
	assert.deepEqual(first.badges, ["first-attempt", "boss-slayer"]);
	assert.equal(first.attempt.skill, skill);
	assert.equal(first.attempt.subskillId, "joins");
	const second = record("success");
	assert.equal(second.progress.xp, 60);
	assert.equal(second.progress.level, 2);
	assert.equal(second.leveledUp, true);
	assert.deepEqual(second.badges, []);
	const third = record("partial");
	assert.equal(third.attempt.xp, 20);
	assert.equal(third.leveledUp, false);
	const fourth = record("fail");
	assert.equal(fourth.progress.attempts, 4);
	assert.equal(fourth.progress.successes, 2);
	assert.equal(fourth.progress.failures, 1);
	assert.equal(fourth.progress.streakDays, 1);
	assert.deepEqual(fourth.badges, ["first-fail"]);
	assert.deepEqual(store.activeSession(skill)?.attemptIds,
		[first, second, third, fourth].map((result) => result.attempt.id));
	assert.deepEqual(new PracticeStore(store.root).progress(skill), fourth.progress);
	const lines = fs.readFileSync(path.join(store.root, "skills", skill, "attempts.jsonl"), "utf8").trim().split("\n");
	assert.equal(lines.length, 4);
	assert.deepEqual(lines.map((line) => JSON.parse(line)), [first, second, third, fourth].map((r) => r.attempt));
	const before = store.progress(skill);
	assert.throws(() => record("success", "invalid date"), /Invalid time value/);
	assert.deepEqual(store.progress(skill), before);
});

test("stored history drives comeback and no-hints badges across fresh store instances", (t) => {
	const store = fixture(t);
	const c = store.addChallenge(draft);
	const record = (outcome: "success" | "fail") => new PracticeStore(store.root)
		.recordAttempt({ challengeId: c.id, outcome, answer: "", hintsUsed: 0 });
	record("fail");
	record("fail");
	assert.ok(record("success").badges.includes("comeback"));
	for (let i = 0; i < 3; i++) assert.ok(!record("success").badges.includes("no-hints"));
	assert.ok(record("success").badges.includes("no-hints"));
	assert.deepEqual(record("success").badges, []);
});

test("sessions round minutes, award hours without attempts, cap at 180, and close once", (t) => {
	const store = fixture(t);
	const start = store.startSession(skill, "focus", now);
	assert.deepEqual(store.activeSession(), start);
	const end = store.endSession(skill, new Date(now.getTime() + 59.5 * 60_000));
	assert.equal(end?.minutes, 60);
	assert.equal(store.progress(skill).minutesLogged, 60);
	assert.deepEqual(store.progress(skill).badges, ["hour-1"]);
	assert.equal(store.progress(skill).attempts, 0);
	assert.equal(store.activeSession(skill), undefined);
	assert.equal(store.endSession(skill), undefined);
	store.startSession(skill, undefined, now);
	assert.equal(store.endSession(skill, new Date(now.getTime() + 300 * 60_000))?.minutes, 180);
	assert.equal(store.progress(skill).minutesLogged, 240);
	store.startSession(skill, undefined, now);
	assert.equal(store.endSession(skill, new Date(now.getTime() + 61 * 60_000))?.minutes, 61);
	assert.ok(store.progress(skill).badges.includes("hour-5"));
	assert.deepEqual(store.hours(skill), { logged: 5.02, goal: 20 });
	const rows = fs.readFileSync(path.join(store.root, "skills", skill, "sessions.jsonl"), "utf8").trim().split("\n");
	assert.equal(rows.length, 3);
	assert.ok(rows.every((line) => JSON.parse(line).endedAt));
});

test("startSession closes the prior session at the same time; latest active spans skills", (t) => {
	const store = fixture(t);
	store.startSession(skill, "old", now);
	const later = new Date(now.getTime() + 90_000);
	const next = store.startSession(skill, "new", later);
	assert.equal(store.progress(skill).minutesLogged, 2);
	assert.equal(store.activeSession(skill)?.id, next.id);
	const other = store.startSession("other", undefined, new Date(later.getTime() + 60_000));
	assert.equal(store.activeSession()?.id, other.id);
	assert.equal(store.endSession("other", now)?.minutes, 0);
	assert.equal(store.activeSession()?.id, next.id);
});

test("all skill entry points reject traversal and invalid slugs", (t) => {
	const store = fixture(t);
	for (const invalid of ["../x", "a/b", "a\\b", "Bad Slug", "", "/tmp/x", "x\0y", "a--b", "a-", "a%2fb"]) {
		const calls = [() => store.readPlan(invalid), () => store.writePlan({ ...plan(), skill: invalid }),
			() => store.setSubskillStatus(invalid, "x", "solid"), () => store.addChallenge({ ...draft, skill: invalid }),
			() => store.getChallenge(invalid, "x"), () => store.listChallenges(invalid),
			() => store.checkAnswer(answerChallenge({ skill: invalid }), "yes"),
			() => store.startSession(invalid), () => store.activeSession(invalid), () => store.endSession(invalid),
			() => store.progress(invalid), () => store.hours(invalid),
			() => nextSubskill({ ...plan(), skill: invalid }), () => store.nextSubskill({ ...plan(), skill: invalid })];
		for (const call of calls) assert.throws(call, /Invalid skill slug/, invalid);
	}
	assert.deepEqual(fs.readdirSync(store.root), []);
});

test("symlink directories and file targets are refused while a symlink home is allowed", (t) => {
	const store = fixture(t);
	const outside = fixture(t);
	const skills = path.join(store.root, "skills");
	fs.symlinkSync(outside.root, skills, "dir");
	assert.throws(() => store.listSkills(), /Refusing symlink/);
	assert.throws(() => store.writePlan(plan()), /Refusing symlink/);
	fs.unlinkSync(skills);
	fs.mkdirSync(skills);
	const directory = path.join(skills, skill);
	fs.symlinkSync(outside.root, directory, "dir");
	assert.throws(() => store.readPlan(skill), /Refusing symlink/);
	assert.throws(() => store.startSession(skill), /Refusing symlink/);
	assert.deepEqual(store.listSkills(), []);
	fs.unlinkSync(directory);
	store.writePlan(plan());
	for (const name of ["plan.json", "challenges.json", "attempts.jsonl", "sessions.jsonl", "progress.json"]) {
		const file = path.join(directory, name);
		fs.rmSync(file, { force: true });
		const target = path.join(outside.root, name);
		fs.writeFileSync(target, "keep");
		fs.symlinkSync(target, file);
		const read = name === "plan.json" ? () => store.readPlan(skill)
			: name === "challenges.json" ? () => store.listChallenges(skill)
				: name === "attempts.jsonl" ? () => store.listChallenges(skill, { unattempted: true })
					: name === "sessions.jsonl" ? () => store.activeSession(skill) : () => store.progress(skill);
		assert.throws(read, /Refusing symlink/);
		assert.equal(fs.readFileSync(target, "utf8"), "keep");
		fs.unlinkSync(file);
	}
	const linkedRoot = path.join(outside.root, "home");
	fs.symlinkSync(store.root, linkedRoot, "dir");
	new PracticeStore(linkedRoot).writePlan(plan());
	assert.deepEqual(store.readPlan(skill), plan());
});

test("malformed JSON and JSONL throw errors naming the file and line", (t) => {
	const store = fixture(t);
	store.writePlan(plan());
	const directory = path.join(store.root, "skills", skill);
	for (const [name, read] of [
		["plan.json", () => store.readPlan(skill)], ["progress.json", () => store.progress(skill)],
		["challenges.json", () => store.listChallenges(skill)], ["sessions.jsonl", () => store.activeSession(skill)],
		["attempts.jsonl", () => store.listChallenges(skill, { unattempted: true })],
	] as const) {
		fs.writeFileSync(path.join(directory, name), "{");
		assert.throws(read, new RegExp(`Invalid JSON in .*${name.replace(".", "\\.")}`));
		fs.rmSync(path.join(directory, name));
	}
});

test("default home reads PSI_HOME at construction time", (t) => {
	const store = fixture(t);
	const previous = process.env.PSI_HOME;
	try {
		process.env.PSI_HOME = store.root;
		assert.equal(new PracticeStore().root, store.root);
	} finally {
		if (previous === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previous;
	}
});

test("choice grading accepts normalized exact answers, letters and one-based indices", (t) => {
	const store = fixture(t), c = answerChallenge({ format: "choice", choices: ["red", "Light Blue", "green"],
		expected: "Light Blue" });
	for (const answer of ["Light Blue", " LIGHT   BLUE ", "B", "b)", "b", "2"]) {
		assert.equal(store.checkAnswer(c, answer), "success", answer);
	}
	for (const answer of ["red", "a", "1", "0", "4", "blue", "Light Blue!"]) {
		assert.equal(store.checkAnswer(c, answer), "fail", answer);
	}
});

test("number format parses fractions, percents, scientific notation, grouping and matching units", (t) => {
	const store = fixture(t);
	for (const [expected, answer] of [["0.75", "3/4"], ["0.25", "25%"], ["1200", "1.2e3"],
		["1200", "1.2×10^3"], ["1200", "1.2x10^3"], ["0.0012", "1.2E-3"],
		["1234567", "1,234,567"], ["-0.75", "−3/4"], ["1200", "1.2 × 10 ^ 3"]]) {
		assert.equal(store.checkAnswer(answerChallenge({ format: "number", expected }), answer), "success", answer);
	}
	const c = answerChallenge({ format: "number", expected: "1200", unit: "m/s" });
	for (const answer of ["1200 m/s", "1200m/s", "1.2e3 m/s", "1200"]) {
		assert.equal(store.checkAnswer(c, answer), "success", answer);
	}
	for (const answer of ["1200 km/s", "1200 s", "1201 m/s", "1,20,0 m/s", "Infinity", "NaN", "3/0", ""]) {
		assert.equal(store.checkAnswer(c, answer), "fail", answer);
	}
	assert.equal(store.checkAnswer({ ...c, expected: "1200 m/s" }, "1200"), "success");
	assert.equal(store.checkAnswer({ ...c, tolerance: 0.1 }, "1200.05 m/s"), "success");
	assert.equal(store.checkAnswer({ ...c, tolerance: 0 }, "1200.00001 m/s"), "fail");
});

test("math format normalizes LaTeX and compares safe numeric expressions", (t) => {
	const store = fixture(t);
	for (const [expected, answer] of [
		["1/2", "\\frac{1}{2}"], ["(x+1)", "\\left( x + 1 \\right)"], ["x+1", "$ x + 1 $"],
		["x+1", "$$x+1$$"], ["x*y", "x\\cdot y"], ["x*y", "x × y"], ["x^2", "x^{2}"],
		["sqrt(x)", "\\sqrt{x}"], ["1/2", "2/4"], ["2", "\\sqrt{4}"], ["8", "2^{3}"],
		["6", "2\\cdot3"], ["6", "2×3"], ["512", "2^3^2"], ["-4", "-2^2"],
		["0.25", "2^-2"], ["1", "pi/pi"], ["1", "e/e"], ["3", "1+4/2"],
		["0.125", "\\frac{1}{\\frac{8}{1}}"], ["2", "\\sqrt{\\sqrt{16}}"],
		["3.141592653589793", "\\pi"], ["1200", "1.2e3"], ["1", "1.0000000005"],
	]) {
		assert.equal(store.checkAnswer(answerChallenge({ format: "math", expected }), answer), "success",
			`${expected} / ${answer}`);
	}
	for (const [expected, answer] of [["1/2", "2/3"], ["x^2", "x^3"], ["1", "1.000000002"],
		["0", "1/0"], ["0", "sqrt(-1)"], ["1", "1+"], ["1", "(1"], ["1", "1)"],
		["1", "process.exit()"], ["1", "globalThis.x=1"], ["1", "Math.sqrt(1)"], ["1", "1;1"]]) {
		assert.equal(store.checkAnswer(answerChallenge({ format: "math", expected }), answer), "fail", answer);
	}
	assert.equal(store.checkAnswer(answerChallenge({ format: "math", expected: "x", acceptable: ["y"] }),
		"$y$"), "success");
});

test("code format always defers grading even when expected matches", (t) => {
	const store = fixture(t);
	assert.equal(store.checkAnswer(answerChallenge({ format: "code" }), "yes"), undefined);
	assert.equal(store.checkAnswer(answerChallenge({ format: "code", expected: undefined }), ""), undefined);
});

test("validateChallenge accepts valid formats and reports malformed contracts", () => {
	assert.deepEqual(validateChallenge(answerChallenge()), []);
	assert.deepEqual(validateChallenge(answerChallenge({ format: "choice", choices: ["yes", "no"] })), []);
	assert.deepEqual(validateChallenge(answerChallenge({ format: "code", language: "sql", tests: "select 1" })), []);
	const invalid: [Partial<Challenge>, RegExp][] = [
		[{ format: "choice" }, /choices containing expected/],
		[{ format: "choice", choices: ["no"] }, /choices containing expected/],
		[{ format: "code", tests: "assert True" }, /language and tests/],
		[{ format: "code", language: "python" }, /language and tests/],
		[{ format: "code", language: "python", tests: " " }, /language and tests/],
		[{ level: 0 as Challenge["level"] }, /level/], [{ level: 6 as Challenge["level"] }, /level/],
		[{ level: 1.5 as Challenge["level"] }, /level/],
		[{ hints: "hint" as unknown as string[] }, /hints/], [{ hints: undefined }, /hints/],
		[{ hints: [1] as unknown as string[] }, /hints/], [{ prompt: " " }, /prompt/],
		[{ skill: "../x" }, /Invalid skill slug/], [{ tolerance: -1 }, /tolerance/],
		[{ tolerance: Infinity }, /tolerance/], [{ createdAt: "bad" }, /createdAt/],
		[{ kind: "bad" as Challenge["kind"] }, /kind/], [{ format: "bad" as Challenge["format"] }, /format/],
		[{ language: "ruby" as Challenge["language"] }, /language/],
		[{ acceptable: "yes" as unknown as string[] }, /acceptable/],
		[{ choices: "yes" as unknown as string[] }, /choices/],
		[{ tests: 123 as unknown as string }, /tests/],
	];
	for (const [patch, pattern] of invalid) assert.match(validateChallenge(answerChallenge(patch)).join("; "), pattern);
});

test("addChallenge rejects invalid drafts before writing and joins validation errors", (t) => {
	const store = fixture(t);
	assert.throws(() => store.addChallenge({ ...draft, format: "choice", level: 0 as Challenge["level"] }),
		/level.*; .*choices containing expected/);
	assert.throws(() => store.addChallenge({ ...draft, hints: "bad" as unknown as string[] }), /hints/);
	assert.throws(() => store.addChallenge({ ...draft, format: "code" }), /language and tests/);
	assert.deepEqual(fs.readdirSync(store.root), []);
	const good = store.addChallenge(draft);
	assert.throws(() => store.addChallenge({ ...draft, prompt: "" }), /prompt/);
	assert.deepEqual(store.listChallenges(skill), [good]);
});
