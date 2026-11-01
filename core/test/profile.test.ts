import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ACHIEVEMENTS, ProfileStore } from "../src/profile.ts";
import { SourceStore } from "../src/sources.ts";
import type { Attempt, PracticeSession, Progress } from "../src/types.ts";

function fixture(t: { after: (fn: () => void) => void }): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-profile-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return home;
}

function write(home: string, name: string, value: unknown, jsonl = false): void {
	const file = path.join(home, name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, jsonl ? (value as unknown[]).map((v) => JSON.stringify(v)).join("\n") + "\n"
		: JSON.stringify(value));
}

function attempt(id: string, at: Date, patch: Partial<Attempt> = {}): Attempt {
	return { id, at: at.toISOString(), skill: "python", challengeId: "boss", subskillId: "loops", answer: "yes",
		outcome: "success", hintsUsed: 0, xp: 10, ...patch };
}

function progress(skill: string, xp: number, minutesLogged: number): Progress {
	return { skill, xp, minutesLogged, level: 1, attempts: 0, successes: 0, failures: 0, streakDays: 0, badges: [] };
}

function earned(store: ProfileStore, now: Date): Set<string> {
	return new Set(store.summarize(now).achievements.filter((a) => a.earned).map((a) => a.id));
}

test("profile defaults, validation, persistence and atomic cleanup", (t) => {
	const home = fixture(t), store = new ProfileStore(home);
	assert.deepEqual(store.read().dailyGoal, { kind: "challenges", target: 5 });
	assert.equal(store.read().tutorMode, "practice");
	assert.equal(fs.existsSync(path.join(home, "profile.json")), false);
	const saved = store.update({ dailyGoal: { kind: "minutes", target: 20 }, tutorMode: "teach" });
	assert.deepEqual(new ProfileStore(home).read(), saved);
	assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
	assert.equal(store.update({ tutorMode: "test" }).dailyGoal.target, 20);
	for (const target of [0, -1, NaN, Infinity]) {
		assert.throws(() => store.update({ dailyGoal: { kind: "minutes", target } }), /goal/i);
	}
	assert.throws(() => store.update({ tutorMode: "invalid" as "test" }), /mode/i);
	assert.throws(() => store.update({ dailyGoal: { kind: "other" as "minutes", target: 20 } }), /goal/i);
	assert.deepEqual(fs.readdirSync(home), ["profile.json"]);
});

test("empty summary has 84 local days and independent locked achievement results", (t) => {
	const store = new ProfileStore(fixture(t)), now = new Date(2026, 2, 10, 0, 5);
	const s = store.summarize(now);
	assert.deepEqual(s.today, { date: "2026-03-10", challenges: 0, minutes: 0, xp: 0, goalMet: false });
	assert.equal(s.calendar.length, 84);
	assert.equal(s.calendar[0].date, "2025-12-17");
	assert.deepEqual(s.calendar.at(-1), { date: "2026-03-10", attempts: 0 });
	assert.equal(s.totalXp, 0);
	assert.equal(s.level, 1);
	assert.equal(s.levelTitle, "Getting started");
	assert.equal(s.streakDays, 0);
	assert.equal(s.combo, 0);
	assert.ok(s.achievements.every((a) => !a.earned && a.earnedAt === undefined));
	assert.throws(() => store.summarize(new Date("invalid")), /date/i);
	assert.ok(ACHIEVEMENTS.length >= 12 && ACHIEVEMENTS.length <= 16);
	assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

test("summary combines skills, local dates, sessions, progress, goals and all achievements", (t) => {
	const home = fixture(t), store = new ProfileStore(home), now = new Date(2026, 10, 1, 16);
	const attempts: Attempt[] = [];
	for (let days = 29; days >= 1; days--) {
		const date = new Date(2026, 10, 1 - days, 12);
		attempts.push(attempt(`old-${days}`, date, { outcome: "fail", lesson: "Check the loop boundary" }));
	}
	const today = Array.from({ length: 5 }, (_, i) => attempt(`today-${i}`, new Date(2026, 10, 1, 12, i)));
	attempts.push(...today);
	write(home, "skills/python/attempts.jsonl", attempts, true);
	write(home, "skills/sql/attempts.jsonl", [attempt("sql", new Date(2026, 10, 1, 13),
		{ skill: "sql", challengeId: "query", xp: 15 })], true);
	write(home, "skills/python/progress.json", progress("python", 450, 900));
	write(home, "skills/sql/progress.json", progress("sql", 50, 300));
	const session: PracticeSession = { id: "session", skill: "python", startedAt: new Date(2026, 10, 1, 12).toISOString(),
		attemptIds: today.map((a) => a.id) };
	write(home, "skills/python/sessions.jsonl", [session], true);
	write(home, "skills/sql/sessions.jsonl", [{ id: "sql-session", skill: "sql", attemptIds: ["sql"],
		startedAt: new Date(2026, 10, 1, 10).toISOString(), endedAt: new Date(2026, 10, 1, 10, 30).toISOString(),
		minutes: 30 }], true);
	write(home, "skills/python/challenges.json", [{ id: "boss", skill: "python", kind: "boss" }]);
	write(home, "graph/paths/path.json", { id: "path" });
	const sources = new SourceStore(home);
	for (const url of ["https://docs.python.org/3/", "https://docs.python.org/3/tutorial/",
		"https://docs.python.org/3/library/"]) {
		sources.add("python", { url });
	}
	let s = store.summarize(now);
	assert.deepEqual(s.today, { date: "2026-11-01", challenges: 6, minutes: 210, xp: 65, goalMet: true });
	assert.equal(s.totalXp, 500);
	assert.equal(s.level, 5);
	assert.equal(s.levelTitle, "Solid foundations");
	assert.equal(s.streakDays, 30);
	assert.equal(s.combo, 5); // Latest open session is python, not the later SQL attempt.
	assert.deepEqual(s.calendar.at(-1), { date: "2026-11-01", attempts: 6 });
	assert.equal(s.achievements.filter((a) => a.earned).length, ACHIEVEMENTS.length);
	assert.equal(s.achievements.find((a) => a.id === "first-attempt")?.earnedAt, attempts[0].at);
	assert.ok(ACHIEVEMENTS.every((a) => !a.earned));
	store.update({ dailyGoal: { kind: "minutes", target: 211 } });
	s = store.summarize(now);
	assert.equal(s.today.goalMet, false);
	assert.equal(s.achievements.find((a) => a.id === "daily-goal-met")?.earned, false);
	store.update({ dailyGoal: { kind: "minutes", target: 210 } });
	assert.equal(store.summarize(now).today.goalMet, true);
});

test("streak accepts yesterday, survives calendar boundaries, and historical achievements persist", (t) => {
	const home = fixture(t), store = new ProfileStore(home);
	write(home, "skills/python/attempts.jsonl", [29, 30, 31].map((date) =>
		attempt(String(date), new Date(2025, 11, date, 23, 55))), true);
	assert.equal(store.summarize(new Date(2026, 0, 1, 0, 5)).streakDays, 3);
	assert.equal(store.summarize(new Date(2026, 0, 2)).streakDays, 0);
	assert.ok(earned(store, new Date(2026, 0, 2)).has("streak-3"));
});

test("combo uses today's attempts without a session; failures, partials and skips break runs", (t) => {
	const home = fixture(t), store = new ProfileStore(home), now = new Date(2026, 2, 10, 18);
	const rows = [attempt("old", new Date(2026, 2, 9)), ...Array.from({ length: 5 }, (_, i) =>
		attempt(`a${i}`, new Date(2026, 2, 10, 12, i)))];
	write(home, "skills/python/attempts.jsonl", rows, true);
	assert.equal(store.summarize(now).combo, 5);
	assert.ok(!earned(store, now).has("combo-5")); // Achievement requires a real session.
	for (const outcome of ["fail", "partial", "skipped"] as const) {
		write(home, "skills/python/attempts.jsonl", [...rows, attempt("break", new Date(2026, 2, 10, 13), { outcome }),
			attempt("last", new Date(2026, 2, 10, 14))], true);
		assert.equal(store.summarize(now).combo, 1);
	}
});

test("comeback requires same skill and same challenge or known subskill; boss uses challenge kind", (t) => {
	const home = fixture(t), store = new ProfileStore(home), now = new Date(2026, 2, 10, 18);
	const fail = attempt("fail", new Date(2026, 2, 10, 12), { outcome: "fail", subskillId: undefined });
	const success = attempt("success", new Date(2026, 2, 10, 13), { challengeId: "other", subskillId: undefined });
	write(home, "skills/python/attempts.jsonl", [fail, success], true);
	assert.ok(!earned(store, now).has("comeback"));
	assert.ok(!earned(store, now).has("boss-slayer"));
	write(home, "skills/python/attempts.jsonl", [fail, { ...success, challengeId: fail.challengeId }], true);
	assert.ok(earned(store, now).has("comeback"));
	write(home, "skills/python/attempts.jsonl", [{ ...fail, subskillId: "loops" },
		{ ...success, subskillId: "loops" }], true);
	assert.ok(earned(store, now).has("comeback"));
});

test("session-only activity and derived duration count, while future attempts do not", (t) => {
	const home = fixture(t), store = new ProfileStore(home), now = new Date(2026, 2, 10, 18);
	write(home, "skills/python/sessions.jsonl", [{ id: "s", skill: "python", attemptIds: [],
		startedAt: new Date(2026, 2, 10, 12).toISOString(), endedAt: new Date(2026, 2, 10, 12, 20).toISOString() }], true);
	write(home, "skills/python/attempts.jsonl", [attempt("future", new Date(2026, 2, 11))], true);
	const s = store.summarize(now);
	assert.equal(s.today.minutes, 20);
	assert.equal(s.streakDays, 1);
	assert.equal(s.today.challenges, 0);
	assert.equal(s.calendar.at(-1)?.attempts, 0);
});

test("hour achievements respect each threshold and combo achievement survives a later failed attempt", (t) => {
	const home = fixture(t), store = new ProfileStore(home), now = new Date(2026, 2, 10, 18);
	for (const minutes of [0, 59, 60, 299, 300, 1199, 1200]) {
		write(home, "skills/python/progress.json", progress("python", 0, minutes));
		const unlocked = earned(store, now);
		for (const hours of [1, 5, 20]) assert.equal(unlocked.has(`hour-${hours}`), minutes >= hours * 60);
	}
	const rows = Array.from({ length: 5 }, (_, i) => attempt(String(i), new Date(2026, 2, 10, 12, i)));
	rows.push(attempt("fail", new Date(2026, 2, 10, 13), { outcome: "fail" }));
	write(home, "skills/python/attempts.jsonl", rows, true);
	write(home, "skills/python/sessions.jsonl", [{ id: "s", skill: "python", attemptIds: rows.map((a) => a.id),
		startedAt: new Date(2026, 2, 10, 12).toISOString(), endedAt: new Date(2026, 2, 10, 14).toISOString() }], true);
	assert.equal(store.summarize(now).combo, 0);
	assert.ok(earned(store, now).has("combo-5"));
});

test("profile and activity readers reject symlinks and propagate malformed records", (t) => {
	const home = fixture(t), external = fixture(t), store = new ProfileStore(home);
	write(external, "profile.json", store.read());
	fs.symlinkSync(path.join(external, "profile.json"), path.join(home, "profile.json"));
	assert.throws(() => store.read(), /symlink/);
	assert.throws(() => store.update({ tutorMode: "teach" }), /symlink/);
	fs.unlinkSync(path.join(home, "profile.json"));
	write(home, "skills/python/attempts.jsonl", [], true);
	fs.writeFileSync(path.join(home, "skills/python/attempts.jsonl"), "broken-json\n");
	assert.throws(() => store.summarize(), SyntaxError);
	fs.rmSync(path.join(home, "skills/python/attempts.jsonl"));
	fs.symlinkSync(path.join(external, "profile.json"), path.join(home, "skills/python/attempts.jsonl"));
	assert.throws(() => store.summarize(), /symlink/);
});

test("session minutes are credited to the local start day, and PSI_HOME selects the default store", (t) => {
	const home = fixture(t), previous = process.env.PSI_HOME;
	process.env.PSI_HOME = home;
	try {
		new ProfileStore().update({ tutorMode: "teach" });
		assert.equal(new ProfileStore(home).read().tutorMode, "teach");
	} finally {
		if (previous === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previous;
	}
	write(home, "skills/python/sessions.jsonl", [{ id: "s", skill: "python", attemptIds: [],
		startedAt: new Date(2026, 2, 9, 23, 50).toISOString(), endedAt: new Date(2026, 2, 10, 0, 10).toISOString(),
		minutes: 20 }], true);
	const summary = new ProfileStore(home).summarize(new Date(2026, 2, 10, 12));
	assert.equal(summary.today.minutes, 0);
	assert.equal(summary.streakDays, 1);
});

test("equal-timestamp attempts preserve log order for combo calculation", (t) => {
	const home = fixture(t), store = new ProfileStore(home), at = new Date(2026, 2, 10, 12);
	write(home, "skills/python/attempts.jsonl", [attempt("z-first", at, { outcome: "fail" }),
		attempt("a-second", at), attempt("b-third", at)], true);
	assert.equal(store.summarize(new Date(2026, 2, 10, 18)).combo, 2);
});


test("gameLayer defaults, round-trips, tolerates invalid saved values and reaches summaries", (t) => {
	const home = fixture(t), store = new ProfileStore(home);
	assert.equal(store.read().gameLayer, "on");
	for (const gameLayer of ["quiet", "off", "on"] as const) {
		store.update({ gameLayer });
		assert.equal(new ProfileStore(home).read().gameLayer, gameLayer);
		assert.equal(store.summarize().gameLayer, gameLayer);
	}
	for (const gameLayer of [undefined, null, "invalid", 1, {}]) {
		write(home, "profile.json", { ...store.read(), gameLayer });
		assert.equal(store.read().gameLayer, "on");
	}
	assert.throws(() => store.update({ gameLayer: "invalid" as "on" }), /gameLayer/);
});
