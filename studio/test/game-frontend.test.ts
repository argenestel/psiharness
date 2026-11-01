import test from "node:test";
import assert from "node:assert/strict";
import { levelTitle as coreLevelTitle } from "../../core/src/gamify.ts";
import { ACHIEVEMENTS } from "../../core/src/profile.ts";

// Module paths in variables keep tsc from resolving the untyped browser modules.
const youModule = "../public/js/you.js", practiceModule = "../public/js/practice.js", homeModule = "../public/js/home.js";
const benchModule = "../public/js/bench.js";
const you = await import(youModule);
const { mapStops, LANE_X } = await import(practiceModule);
const { hasHistory, continueAction } = await import(homeModule);
const { isHomeHash } = await import(benchModule);

const calendar = (today: string, counts: Record<string, number>) => {
	const end = new Date(`${today}T12:00:00`);
	return Array.from({ length: 84 }, (_, i) => {
		const d = new Date(end);
		d.setDate(end.getDate() - 83 + i);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		return { date: key, attempts: counts[key] ?? 0 };
	});
};

test("level titles match core gamify", () => {
	for (let level = 1; level <= 12; level++) assert.equal(you.levelTitle(level), coreLevelTitle(level));
});

test("day intensity buckets attempts into three ink strengths", () => {
	assert.deepEqual([0, 1, 2, 3, 5, 6, 40, -1, NaN].map(you.dayIntensity), [0, 1, 1, 2, 2, 3, 3, 0, 0]);
});

test("calendar grid has 12 Monday-first week columns ending in the current week", () => {
	// 2026-11-01 is a Sunday: the last column is complete and ends today.
	const sunday = you.calendarGrid(calendar("2026-11-01", { "2026-11-01": 7, "2026-10-30": 3, "2026-10-01": 1 }));
	assert.equal(sunday.columns.length, 12);
	assert.ok(sunday.columns.every((c: { days: unknown[] }) => c.days.length === 7));
	const last = sunday.columns[11].days;
	assert.equal(last[0].date, "2026-10-26");
	assert.equal(last[6].date, "2026-11-01");
	assert.ok(last[6].today && last[6].level === 3 && !last[6].future);
	assert.equal(last[4].level, 2);
	assert.equal(sunday.activeDays, 3);
	assert.equal(sunday.total, 11);
	assert.equal(sunday.columns[0].days[0].date, "2026-08-10");
	// A Wednesday: Thursday to Sunday of this week are future cells, never counted.
	const wed = you.calendarGrid(calendar("2026-11-04", { "2026-11-04": 2 }));
	const week = wed.columns[11].days;
	assert.deepEqual(week.map((d: { future: boolean }) => d.future), [false, false, false, true, true, true, true]);
	assert.ok(week[2].today && week[2].level === 1);
	// Month labels sit on the column that contains the 1st.
	const months = sunday.columns.map((c: { month: string }) => c.month).filter(Boolean);
	assert.deepEqual(months, ["Aug", "Sep", "Oct", "Nov"]);
	assert.deepEqual(you.calendarGrid(undefined), { columns: [], activeDays: 0, total: 0 });
});

test("goal progress reads today's challenges or minutes against the goal", () => {
	const base = { today: { date: "2026-11-01", challenges: 3, minutes: 12, xp: 30, goalMet: false } };
	assert.deepEqual(
		(({ label, met, percent, unit }) => ({ label, met, percent, unit }))(
			you.goalProgress({ ...base, dailyGoal: { kind: "challenges", target: 5 } })),
		{ label: "3 of 5 today", met: false, percent: 60, unit: "challenges" });
	const minutes = you.goalProgress({ ...base, dailyGoal: { kind: "minutes", target: 10 } });
	assert.equal(minutes.label, "12 of 10 today");
	assert.ok(minutes.met);
	assert.equal(minutes.percent, 100);
	assert.equal(you.goalProgress({}).label, "0 of 5 today");
	assert.equal(you.goalProgress({ dailyGoal: { kind: "challenges", target: 1 } }).unit, "challenge");
	assert.equal(you.GOAL_CHOICES.length, 6);
});

test("the goal fill moment happens once per day", () => {
	const met = { dailyGoal: { kind: "challenges", target: 3 }, today: { date: "2026-11-01", challenges: 3 } };
	assert.equal(you.shouldCelebrate(met, ""), true);
	assert.equal(you.shouldCelebrate(met, "2026-11-01"), false);
	assert.equal(you.shouldCelebrate(met, "2026-10-31"), true);
	assert.equal(you.shouldCelebrate({ ...met, today: { date: "2026-11-01", challenges: 2 } }, ""), false);
	assert.equal(you.shouldCelebrate({ dailyGoal: met.dailyGoal, today: { challenges: 9 } }, ""), false);
});

test("streaks, achievements and totals in plain words", () => {
	assert.deepEqual(you.streakWords(0), { text: "No streak yet", hint: "Practise today to start one." });
	assert.deepEqual(you.streakWords(1), { text: "1 day in a row", hint: "Practise today to keep it going." });
	assert.equal(you.streakWords(4, true).hint, "You've practised today.");
	const groups = you.achievementGroups([
		{ id: "a", title: "A", earned: true, earnedAt: "2026-10-01T00:00:00Z" },
		{ id: "b", title: "B", earned: false }, { id: "c", title: "C", earned: true },
		{ id: "d", title: "D", earned: true, earnedAt: "2026-10-20T00:00:00Z" }, null,
	]);
	assert.deepEqual(groups.earned.map((a: { id: string }) => a.id), ["d", "a", "c"]);
	assert.deepEqual(groups.open.map((a: { id: string }) => a.id), ["b"]);
	assert.deepEqual(you.lifetimeTotals([{ attempts: 10, successes: 6, failures: 4, minutesLogged: 90 },
		{ attempts: 2, successes: 1, failures: 1, minutesLogged: 45 }, null]),
		{ attempts: 12, solved: 7, misses: 5, hours: 2.3 });
});

test("one announcement per attempt: level-up first, then the most notable badge", () => {
	assert.deepEqual(you.pickAnnouncement({ leveledUp: true, progress: { level: 5 }, badges: ["comeback"] }),
		{ kind: "level", key: "level-5", title: "Skill level 5", text: "Solid foundations", spoken: "Skill level 5. Solid foundations." });
	const badge = you.pickAnnouncement({ leveledUp: false, badges: ["first-attempt", "comeback", "unknown"] });
	assert.equal(badge.title, "New: Comeback");
	assert.equal(badge.text, "Solved a step right after missing it.");
	assert.equal(you.pickAnnouncement({ badges: ["streak-3", "boss-slayer"] }).key, "boss-slayer");
	assert.equal(you.pickAnnouncement({ badges: ["level-5"] }), null);
	assert.equal(you.pickAnnouncement({ leveledUp: true, attempt: { outcome: "pending" } }), null);
	assert.equal(you.pickAnnouncement(undefined), null);
	// Announced badge names match the achievement titles the You page lists.
	const titles = new Map(ACHIEVEMENTS.map((a) => [a.id, a.title]));
	for (const [id, [name]] of Object.entries(you.BADGE_COPY) as [string, [string, string]][]) {
		// Core titles "1 practice hours"; the announcement keeps the singular.
		if (titles.has(id)) assert.equal(name, titles.get(id), id);
	}
});

test("the level map orders stops by prerequisites and marks where to start", () => {
	const plan = { title: "T", subskills: [
		{ id: "c", title: "Loops", priority: 1, prerequisites: ["b"], status: "locked", lessonAvailable: true },
		{ id: "a", title: "Values", priority: 1, prerequisites: [], status: "solid" },
		{ id: "b", title: "Names", priority: 1, prerequisites: ["a"], status: "active" },
		{ id: "d", title: "Strings", priority: 2, prerequisites: ["a"], status: "practicing" },
		{ id: "e", title: "Ghost", priority: 3, prerequisites: ["zz"], status: "locked" },
	] };
	const stops = mapStops(plan);
	assert.deepEqual(stops.map((s: { id: string }) => s.id), ["a", "b", "c", "d", "e"]);
	assert.deepEqual(stops.map((s: { state: string }) => s.state), ["solid", "here", "locked", "practising", "locked"]);
	assert.deepEqual(stops.map((s: { status: string }) => s.status),
		["Solid", "Start here", "Unlocks after Names", "Practising", "Unlocks after zz"]);
	assert.equal(stops[2].lessonAvailable, true);
	assert.deepEqual(stops.map((s: { next: string | null }) => s.next), ["open", "ahead", "open", "ahead", null]);
	assert.ok(stops.every((s: { lane: number }) => LANE_X[s.lane] !== undefined));
	// A practising step that is next says "Continue here"; cycles fall back to plan order.
	const cont = mapStops({ subskills: [{ id: "x", title: "X", priority: 1, prerequisites: [], status: "practicing" }] });
	assert.equal(cont[0].status, "Continue here");
	const cycle = mapStops({ subskills: [{ id: "p", prerequisites: ["q"], status: "locked" },
		{ id: "q", prerequisites: ["p"], status: "locked" }] });
	assert.deepEqual(cycle.map((s: { id: string }) => s.id), ["p", "q"]);
	assert.deepEqual(mapStops(null), []);
});

test("home shows Today once there is history and continues the right skill", () => {
	assert.equal(hasHistory({ calendar: [{ date: "x", attempts: 0 }] }, undefined), false);
	assert.equal(hasHistory({ calendar: [{ date: "x", attempts: 2 }] }, undefined), true);
	assert.equal(hasHistory(null, { date: "2026-10-01" }), true);
	const skills = [
		{ skill: "mental-math", plan: { title: "Mental math", subskills: [] }, progress: { attempts: 3 } },
		{ skill: "python-foundations", progress: { attempts: 9 }, plan: { title: "Python", subskills: [
			{ id: "a", title: "Syntax", priority: 1, prerequisites: [], status: "solid" },
			{ id: "b", title: "Strings", priority: 1, prerequisites: ["a"], status: "active" }] } },
	];
	assert.deepEqual(continueAction({ skills }),
		{ skill: "python-foundations", title: "Python", step: "Strings", label: "Continue Python: Strings",
			prompt: "/practice Strings" });
	assert.equal(continueAction({ skills, active: "mental-math" })?.label, "Continue Mental math");
	assert.equal(continueAction({ skills, recap: { skill: "python-foundations" }, active: "mental-math" })?.skill,
		"python-foundations");
	assert.equal(continueAction({ skills: [] }), null);
	assert.deepEqual(["#/", "", "#/you", "#/chat/a"].map(isHomeHash), [true, true, false, false]);
});
