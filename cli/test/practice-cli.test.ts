import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { PRACTICE_COMMANDS } from "../src/practice-commands.ts";
import type { Attempt, Challenge, SkillPlan } from "../../core/src/types.ts";

const absent = ["memory.ts", "practice.ts", "gamify.ts"].filter((name) =>
	!existsSync(fileURLToPath(new URL(`../../core/src/${name}`, import.meta.url))));
const needsCore = { skip: absent.length ? `Core modules not present yet: ${absent.join(", ")}` : false };
const plan: SkillPlan = {
	skill: "test-skill", title: "Test Skill", targetPerformance: "Answer two sums", whyItMatters: "Build fluency",
	subskills: [{ id: "sums", title: "Simple sums", why: "Basics", priority: 1, prerequisites: [],
		selfCorrection: "Count again", drills: ["Add"], status: "active" }],
	resources: [], barriers: [], hoursGoal: 20, createdAt: "2026-01-01", updatedAt: "2026-01-01",
};
const challenges: Challenge[] = [
	{ id: "one", skill: plan.skill, subskillId: "sums", kind: "predict", level: 1,
		prompt: "One plus one?", expected: "2", hints: ["Count two ones"], createdAt: "2026-01-01" },
	{ id: "two", skill: plan.skill, subskillId: "sums", kind: "predict", level: 1,
		prompt: "Two plus two?", expected: "4", hints: [], createdAt: "2026-01-01" },
	{ id: "three", skill: plan.skill, subskillId: "sums", kind: "predict", level: 1,
		prompt: "Three plus three?", expected: "6", hints: [], createdAt: "2026-01-01" },
	{ id: "open", skill: plan.skill, subskillId: "sums", kind: "explain", level: 1,
		prompt: "Explain addition", hints: [], createdAt: "2026-01-01" },
];

function temp(t: { after: (fn: () => void) => void }): string {
	const home = mkdtempSync(join(tmpdir(), "psi-practice-cli-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	return home;
}

function fixture(home: string, skillPlan = plan): string {
	const dir = join(home, "skills", skillPlan.skill);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "plan.json"), JSON.stringify(skillPlan));
	writeFileSync(join(dir, "challenges.json"), JSON.stringify(challenges));
	return dir;
}

async function run(name: string, argv: string[], home: string, input = "") {
	const command = PRACTICE_COMMANDS.find((entry) => entry.name === name);
	assert.ok(command);
	let output = "";
	const stdout = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
	const stdin = new PassThrough();
	stdin.end(input);
	const code = await command.run(argv, { home, stdin, stdout });
	return { code, output };
}

function attempts(dir: string): Attempt[] {
	return readFileSync(join(dir, "attempts.jsonl"), "utf8").trim().split("\n")
		.filter(Boolean).map((line) => JSON.parse(line) as Attempt);
}

test("practice command table exports six commands with usage and summaries", () => {
	assert.deepEqual(PRACTICE_COMMANDS.map((c) => c.name),
		["skills", "practice", "hours", "memory", "progress", "import-skill"]);
	assert.ok(PRACTICE_COMMANDS.every((c) => c.usage && c.summary && typeof c.run === "function"));
});

test("import-skill copies a slugged pack, refuses overwrite, and supports --force", async (t) => {
	const root = temp(t);
	const pack = fixture(root, { ...plan, skill: "Test Skill" });
	const home = join(root, "home");
	const target = join(home, "skills", plan.skill);
	assert.equal((await run("import-skill", [pack], home)).code, 0);
	assert.equal(JSON.parse(readFileSync(join(target, "plan.json"), "utf8")).skill, plan.skill);
	assert.deepEqual(JSON.parse(readFileSync(join(target, "challenges.json"), "utf8")), challenges);
	writeFileSync(join(target, "attempts.jsonl"), "history\n");
	writeFileSync(join(pack, "plan.json"), JSON.stringify({ ...plan, title: "Updated" }));
	const refused = await run("import-skill", [pack], home);
	assert.equal(refused.code, 1);
	assert.match(refused.output, /already exists/);
	assert.equal(JSON.parse(readFileSync(join(target, "plan.json"), "utf8")).title, plan.title);
	assert.equal((await run("import-skill", [pack, "--force"], home)).code, 0);
	assert.equal(JSON.parse(readFileSync(join(target, "plan.json"), "utf8")).title, "Updated");
	assert.equal(readFileSync(join(target, "attempts.jsonl"), "utf8"), "history\n");
});

test("import-skill rejects missing or malformed JSON before writing", async (t) => {
	const root = temp(t);
	const pack = join(root, "pack");
	mkdirSync(pack);
	const home = join(root, "home");
	assert.equal((await run("import-skill", [pack], home)).code, 1);
	writeFileSync(join(pack, "plan.json"), JSON.stringify(plan));
	writeFileSync(join(pack, "challenges.json"), "{");
	assert.equal((await run("import-skill", [pack], home)).code, 1);
	assert.ok(!existsSync(join(home, "skills")));
	writeFileSync(join(pack, "challenges.json"), "[]");
	writeFileSync(join(pack, "plan.json"), "null");
	assert.equal((await run("import-skill", [pack], home)).code, 1);
});

test("practice grades answers, hints, lesson bonus, and quit; ends the session", needsCore, async (t) => {
	const home = temp(t);
	const dir = fixture(home);
	const result = await run("practice", [plan.skill, "--minutes", "5"], home,
		"?\n2\nwrong\nCount on my fingers\nq\n");
	assert.equal(result.code, 0, result.output);
	assert.match(result.output, /Count two ones/);
	assert.match(result.output, /Fail = \+4 XP/);
	assert.match(result.output, /What will you try differently\?/);
	assert.match(result.output, /lesson bonus/);
	assert.match(result.output, /open-ended; run `psi learn`/);
	assert.match(result.output, /2 attempts, 1 success, 1 fail/);
	assert.match(result.output, /minutes/);
	assert.match(result.output, /20 hours/);
	const recorded = attempts(dir);
	assert.deepEqual(recorded.map((a) => a.outcome), ["success", "fail"]);
	assert.equal(recorded[0].hintsUsed, 1);
	assert.equal(recorded[1].lesson, "Count on my fingers");
	const { xpFor } = await import("../../core/src/gamify.ts");
	assert.ok(recorded[1].xp > xpFor({ outcome: "fail", kind: "predict", level: 1, hintsUsed: 0 }));
	const { PracticeStore } = await import("../../core/src/practice.ts");
	assert.equal(new PracticeStore(home).activeSession(plan.skill), undefined);
	const session = JSON.parse(readFileSync(join(dir, "sessions.jsonl"), "utf8").trim());
	assert.equal(session.attemptIds.length, 2);
	assert.equal(typeof session.minutes, "number");
	assert.ok(session.endedAt);
});

test("practice puts unattempted before failures and excludes completed or locked work", needsCore, async (t) => {
	const home = temp(t);
	const lockedPlan: SkillPlan = { ...plan, subskills: [...plan.subskills, {
		...plan.subskills[0], id: "advanced", title: "Advanced", prerequisites: ["sums"], status: "locked",
	}] };
	const dir = fixture(home, lockedPlan);
	writeFileSync(join(dir, "challenges.json"), JSON.stringify([...challenges, {
		...challenges[0], id: "locked", subskillId: "advanced", prompt: "Locked challenge",
	}]));
	await run("practice", [plan.skill], home, "2\nwrong\n\nq\n");
	const result = await run("practice", [plan.skill], home, "6\n4\n");
	assert.equal(result.code, 0, result.output);
	assert.ok(result.output.indexOf("Three plus three?") < result.output.indexOf("Two plus two?"));
	assert.doesNotMatch(result.output, /One plus one\?|Locked challenge/);
	assert.deepEqual(attempts(dir).map((a) => a.challengeId), ["one", "two", "three", "two"]);
});

test("practice handles EOF, skip, and time-up without leaving an active session", needsCore, async (t) => {
	const home = temp(t);
	fixture(home);
	const eof = await run("practice", [plan.skill], home, "s\n");
	assert.equal(eof.code, 0, eof.output);
	assert.match(eof.output, /skipped: \+0 XP/);
	const { PracticeStore } = await import("../../core/src/practice.ts");
	const store = new PracticeStore(home);
	assert.equal(store.activeSession(plan.skill), undefined);
	const command = PRACTICE_COMMANDS.find((c) => c.name === "practice")!;
	const stdin = new PassThrough();
	let output = "";
	const stdout = new Writable({ write(chunk, _encoding, callback) { output += chunk; callback(); } });
	t.after(() => stdin.destroy());
	assert.equal(await command.run([plan.skill, "--minutes=0.0005"], { home, stdin, stdout }), 0);
	assert.match(output, /Time is up/);
	assert.equal(store.activeSession(plan.skill), undefined);
	assert.equal((await run("practice", [plan.skill, "--minutes", "0"], home)).code, 1);
});

test("hours, progress, and skills report stored progress and a 20-hour goal", needsCore, async (t) => {
	const home = temp(t);
	const dir = fixture(home);
	writeFileSync(join(dir, "progress.json"), JSON.stringify({ skill: plan.skill, xp: 75, level: 2,
		streakDays: 3, minutesLogged: 120, attempts: 5, successes: 3, failures: 2, badges: ["first-fail"] }));
	const hours = await run("hours", [plan.skill], home);
	assert.equal(hours.code, 0, hours.output);
	assert.match(hours.output, /test-skill.*\[##[-]+\].*2.00 \/ 20 hours/);
	const progress = await run("progress", [plan.skill], home);
	assert.equal(progress.code, 0, progress.output);
	for (const expected of [/75 XP/, /Level 2/, /Streak: 3/, /Success: 3/, /Fail: 2/, /first-fail/, /\[#+-+\]/]) {
		assert.match(progress.output, expected);
	}
	const skills = await run("skills", [], home);
	assert.equal(skills.code, 0, skills.output);
	assert.match(skills.output, /test-skill/);
	assert.match(skills.output, /Simple sums/);
	assert.match(skills.output, /2.00\/20 h/);
	assert.equal((await run("hours", [], home)).code, 0);
	assert.equal((await run("progress", [], home)).code, 0);
});

test("memory adds, lists, names, summarizes, forgets, and rejects invalid kinds", needsCore, async (t) => {
	const home = temp(t);
	assert.match((await run("memory", [], home)).output, /No memories/);
	assert.equal((await run("memory", ["add", "goal", "Learn arithmetic"], home)).code, 0);
	assert.equal((await run("memory", ["name", "Ada"], home)).code, 0);
	const list = await run("memory", ["list"], home);
	assert.match(list.output, /Ada/);
	assert.match(list.output, /goal.*Learn arithmetic/);
	assert.match((await run("memory", ["show"], home)).output, /Learn arithmetic/);
	const data = JSON.parse(readFileSync(join(home, "memory.json"), "utf8"));
	assert.equal((await run("memory", ["forget", data.items[0].id], home)).code, 0);
	assert.doesNotMatch((await run("memory", [], home)).output, /Learn arithmetic/);
	assert.equal((await run("memory", ["forget", "missing"], home)).code, 1);
	assert.equal((await run("memory", ["add", "invalid", "Text"], home)).code, 1);
});
