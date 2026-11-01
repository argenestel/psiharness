/**
 * The game layer: daily goal, level and title, streak calendar, achievements and level-up moments.
 *
 * API
 * - Pure helpers (no DOM; imported by Node tests): `levelTitle`, `dayIntensity`, `calendarGrid`, `goalProgress`,
 *   `shouldCelebrate`, `streakWords`, `achievementGroups`, `lifetimeTotals`, `pickAnnouncement`, `GOAL_CHOICES`.
 * - `goalWidget(summary, { compact?, onSaved? })` → HTMLElement: a ring "3 of 5 today" that opens a goal picker
 *   (PUT /api/me/profile). The first time a day's goal shows as met, the ring fills once (reduced motion: instant).
 * - `fillAnnouncement(node, item)` writes one level-up or achievement announcement into a live region.
 * - `mountYou(root)` → { destroy } — the #/you page.
 */
import { api } from "./api.js";
import { el, emit, on, formatLevel } from "./ui.js";

/** Plain level title, matching core gamify.levelTitle. */
export function levelTitle(level) {
	if (level >= 10) return "Expert in the making";
	if (level >= 7) return "Confident";
	if (level >= 5) return "Solid foundations";
	if (level >= 3) return "Building momentum";
	if (level >= 2) return "Finding your feet";
	return "Getting started";
}

/** Ink intensity for one day: 0 (none), 1 (1–2 attempts), 2 (3–5), 3 (6 or more). */
export function dayIntensity(attempts) {
	const n = Number(attempts);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return n <= 2 ? 1 : n <= 5 ? 2 : 3;
}

const two = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const parseDay = (key) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ""));
	return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : undefined;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Bucket the summary calendar (oldest first, last entry = today) into week columns, Monday first.
 * The last column is the current week (days after today are `future`). Each column carries a month label
 * when the 1st of a month falls in it (or on the first column).
 */
export function calendarGrid(calendar, { weeks = 12, today } = {}) {
	const list = (Array.isArray(calendar) ? calendar : []).filter((d) => parseDay(d?.date));
	const end = parseDay(today) ?? parseDay(list.at(-1)?.date);
	if (!end) return { columns: [], activeDays: 0, total: 0 };
	const counts = new Map(list.map((d) => [d.date, Math.max(0, Number(d.attempts) || 0)]));
	const start = new Date(end);
	start.setDate(start.getDate() - (end.getDay() + 6) % 7 - (weeks - 1) * 7);
	const todayKey = dayKey(end);
	let activeDays = 0, total = 0;
	const columns = Array.from({ length: weeks }, (_, w) => {
		const days = Array.from({ length: 7 }, (_, r) => {
			const date = new Date(start);
			date.setDate(start.getDate() + w * 7 + r);
			const key = dayKey(date), future = date.getTime() > end.getTime() && key !== todayKey;
			const attempts = future ? 0 : counts.get(key) ?? 0;
			if (attempts > 0) { activeDays++; total += attempts; }
			return { date: key, attempts, level: dayIntensity(attempts), today: key === todayKey, future };
		});
		const first = days.find((d) => d.date.endsWith("-01"));
		const month = first ?? (w === 0 ? days[0] : undefined);
		return { days, month: month ? MONTHS[Number(month.date.slice(5, 7)) - 1] : "" };
	});
	// Drop a first-column label that would collide with the next column's month label.
	if (columns[0]?.month && columns[1]?.month) columns[0].month = "";
	return { columns, activeDays, total };
}

/** Today's progress toward the daily goal in plain words. */
export function goalProgress(summary) {
	const goal = summary?.dailyGoal ?? {};
	const kind = goal.kind === "minutes" ? "minutes" : "challenges";
	const target = Math.max(1, Math.round(Number(goal.target) || 5));
	const today = summary?.today ?? {};
	const done = Math.max(0, Math.round(Number(kind === "minutes" ? today.minutes : today.challenges) || 0));
	const met = Boolean(today.goalMet) || done >= target;
	const unit = kind === "minutes" ? (target === 1 ? "minute" : "minutes") : (target === 1 ? "challenge" : "challenges");
	return { kind, target, done, met, unit, percent: Math.round(Math.min(1, done / target) * 100),
		label: `${Math.min(done, 999)} of ${target} today` };
}

/** True when today's goal is met and this browser hasn't shown the fill moment for today yet. */
export function shouldCelebrate(summary, lastCelebrated) {
	const date = summary?.today?.date;
	return Boolean(date) && goalProgress(summary).met && lastCelebrated !== date;
}

/** Streak in words, plus what to do about it today. */
export function streakWords(days, practisedToday = false) {
	const n = Math.max(0, Math.floor(Number(days) || 0));
	const text = n === 0 ? "No streak yet" : `${n} ${n === 1 ? "day" : "days"} in a row`;
	const hint = practisedToday ? "You've practised today." : n > 0 ? "Practise today to keep it going."
		: "Practise today to start one.";
	return { text, hint };
}

/** Earned achievements (newest first, undated last) and the ones still to earn (definition order). */
export function achievementGroups(achievements) {
	const list = (Array.isArray(achievements) ? achievements : []).filter((a) => a && a.id && a.title);
	const time = (a) => { const t = Date.parse(a.earnedAt ?? ""); return Number.isFinite(t) ? t : -Infinity; };
	const earned = list.map((a, i) => [a, i]).filter(([a]) => a.earned)
		.sort(([a, i], [b, j]) => time(b) - time(a) || i - j).map(([a]) => a);
	return { earned, open: list.filter((a) => !a.earned) };
}

/** Lifetime totals across skills' progress records. */
export function lifetimeTotals(progresses) {
	const sum = (key) => (Array.isArray(progresses) ? progresses : [])
		.reduce((total, p) => total + Math.max(0, Number(p?.[key]) || 0), 0);
	return { attempts: sum("attempts"), solved: sum("successes"), misses: sum("failures"),
		hours: Math.round(sum("minutesLogged") / 6) / 10 };
}

/** What each new badge id says when it's announced (title as in core ACHIEVEMENTS, text in the past tense). */
export const BADGE_COPY = Object.freeze({
	"boss-slayer": ["Boss slayer", "beat a boss challenge"],
	comeback: ["Comeback", "solved a step right after missing it"],
	"streak-30": ["30 day streak", "practised 30 days in a row"],
	"streak-7": ["7 day streak", "practised 7 days in a row"],
	"streak-3": ["3 day streak", "practised 3 days in a row"],
	"hour-20": ["20 practice hours", "the full 20 hours"],
	"hour-10": ["10 practice hours", "halfway to 20 hours"],
	"hour-5": ["5 practice hours", "logged 5 hours of practice"],
	"hour-1": ["1 practice hour", "logged your first hour"],
	"no-hints": ["No hints needed", "five solved in a row without a hint"],
	"lesson-learned": ["Lesson learned", "wrote down what a miss taught you"],
	"first-fail": ["Failure is progress", "missed one and kept going"],
	"first-attempt": ["First step", "tried your first challenge"],
});
const BADGE_ORDER = Object.keys(BADGE_COPY);

/**
 * Pick at most one announcement for a recorded attempt: a level-up beats any badge; badges follow BADGE_ORDER.
 * Returns { kind: "level"|"badge", key, title, text, spoken } or null.
 */
export function pickAnnouncement(detail) {
	if (!detail || detail.attempt?.outcome === "pending") return null;
	if (detail.leveledUp) {
		const level = Number(detail.progress?.level) || formatLevel(detail.progress?.xp).level;
		const text = levelTitle(level);
		return { kind: "level", key: `level-${level}`, title: `Level ${level}`, text, spoken: `Level ${level}. ${text}.` };
	}
	const id = (Array.isArray(detail.badges) ? detail.badges : []).filter((b) => BADGE_COPY[b])
		.sort((a, b) => BADGE_ORDER.indexOf(a) - BADGE_ORDER.indexOf(b))[0];
	if (!id) return null;
	const [name, what] = BADGE_COPY[id];
	return { kind: "badge", key: id, title: `New: ${name}`, text: `${what[0].toUpperCase()}${what.slice(1)}.`,
		spoken: `New achievement: ${name}. You ${what}.` };
}

/** The goal options offered by the picker. */
export const GOAL_CHOICES = Object.freeze([
	{ kind: "challenges", target: 3 }, { kind: "challenges", target: 5 }, { kind: "challenges", target: 10 },
	{ kind: "minutes", target: 10 }, { kind: "minutes", target: 20 }, { kind: "minutes", target: 30 },
]);

/* ---------- DOM ---------- */

const SVG = "http://www.w3.org/2000/svg";
const CELEBRATED_KEY = "psi-goal-celebrated";
function svg(tag, attrs = {}, ...children) {
	const node = document.createElementNS(SVG, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	node.append(...children);
	return node;
}
function readCelebrated() { try { return localStorage.getItem(CELEBRATED_KEY) ?? ""; } catch { return ""; } }
function writeCelebrated(date) { try { localStorage.setItem(CELEBRATED_KEY, date); } catch { /* blocked storage */ } }

/** A 44 px ring: rule track, highlighter arc for today's share of the goal, filled disc once the goal is met. */
function goalRing(g) {
	const arc = svg("circle", { class: "psi-ring-arc", cx: 22, cy: 22, r: 18, pathLength: 100,
		"stroke-dasharray": `${g.percent} 100`, transform: "rotate(-90 22 22)" });
	return svg("svg", { class: "psi-ring", viewBox: "0 0 44 44", width: 44, height: 44, "aria-hidden": "true" },
		svg("circle", { class: "psi-ring-track", cx: 22, cy: 22, r: 18 }),
		g.percent > 0 ? arc : "",
		g.met ? svg("circle", { class: "psi-ring-fill", cx: 22, cy: 22, r: 13 }) : "",
		svg("text", { class: "psi-ring-n", x: 22, y: 22, "text-anchor": "middle", "dominant-baseline": "central" },
			String(Math.min(g.done, 99))));
}

async function putProfile(body) {
	const response = await fetch("/api/me/profile", { method: "PUT",
		headers: { "X-Psi": "1", "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
	let data;
	try { data = await response.json(); } catch { data = {}; }
	if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
	return data;
}

let widgetCount = 0;
/** Daily-goal ring with its picker. `compact` is the bench size. */
export function goalWidget(summary, { compact = false, onSaved } = {}) {
	let current = summary;
	const id = `psi-goal-picker-${++widgetCount}`;
	const root = el("div", { class: `psi-goalw${compact ? " is-compact" : ""}` });
	const live = el("p", { class: "psi-sr-only", role: "status", "aria-live": "polite" });
	const status = el("p", { class: "psi-goalw-status", role: "status" });
	const button = el("button", { type: "button", class: "psi-goalw-button", "aria-expanded": "false", "aria-controls": id });
	const picker = el("div", { class: "psi-goalw-picker", id, hidden: true });

	function draw(celebrate = false) {
		const g = goalProgress(current);
		root.classList.toggle("is-met", g.met);
		root.classList.toggle("is-celebrating", celebrate);
		button.replaceChildren(goalRing(g),
			el("span", { class: "psi-goalw-text" },
				el("strong", {}, g.label),
				el("span", {}, g.met ? "Goal met. Anything more is a bonus." : `Goal: ${g.target} ${g.unit}`)),
			el("span", { class: "psi-goalw-change" }, "Change goal"));
		button.setAttribute("aria-label", `${g.done} of ${g.target} ${g.unit} today${g.met ? ", goal met" : ""}. Change daily goal`);
		const choice = (c) => el("button", { type: "button", class: "psi-goalw-choice",
			"aria-pressed": String(c.kind === g.kind && c.target === g.target),
			onclick: () => void save(c) }, String(c.target));
		picker.replaceChildren(
			el("p", { class: "psi-goalw-ask" }, "How much practice a day?"),
			el("div", { class: "psi-goalw-row", role: "group", "aria-label": "Challenges a day" },
				el("span", {}, "Challenges"), GOAL_CHOICES.filter((c) => c.kind === "challenges").map(choice)),
			el("div", { class: "psi-goalw-row", role: "group", "aria-label": "Minutes a day" },
				el("span", {}, "Minutes"), GOAL_CHOICES.filter((c) => c.kind === "minutes").map(choice)),
			status);
	}
	function toggle(open = picker.hidden) {
		picker.hidden = !open;
		button.setAttribute("aria-expanded", String(open));
		if (open) picker.querySelector("[aria-pressed=true]")?.focus();
	}
	async function save(choice) {
		status.textContent = "Saving…";
		try {
			const result = await putProfile({ dailyGoal: choice });
			current = result.summary ?? { ...current, dailyGoal: choice };
			status.textContent = "";
			draw(false);
			toggle(false);
			button.focus();
			live.textContent = `Daily goal set to ${choice.target} ${choice.kind}.`;
			onSaved?.(current);
			emit("psi:goal", current);
			maybeCelebrate();
		} catch (error) {
			status.textContent = `Couldn't save the goal. ${String(error.message).replace(/\.$/, "")}. Try again.`;
		}
	}
	function maybeCelebrate() {
		if (!shouldCelebrate(current, readCelebrated())) return;
		writeCelebrated(current.today.date);
		draw(true);
		live.textContent = "Today's goal is done.";
	}
	button.addEventListener("click", () => toggle());
	picker.addEventListener("keydown", (event) => {
		if (event.key === "Escape") { event.stopPropagation(); toggle(false); button.focus(); }
	});
	root.append(button, picker, live);
	draw(false);
	maybeCelebrate();
	return Object.assign(root, {
		update(next) { if (next) { current = next; draw(false); maybeCelebrate(); } },
	});
}

/** Write one announcement into a live region node (kept mounted so screen readers hear the change). */
export function fillAnnouncement(node, item) {
	if (!item) { node.replaceChildren(); node.classList.remove("is-shown"); return; }
	node.dataset.kind = item.kind;
	node.replaceChildren(
		el("p", { class: "psi-announce-title", "aria-hidden": "true" }, el("span", {}, item.title)),
		el("p", { class: "psi-announce-text", "aria-hidden": "true" }, item.text),
		el("p", { class: "psi-sr-only" }, item.spoken));
	node.classList.remove("is-shown");
	void node.offsetWidth; // restart the stroke
	node.classList.add("is-shown");
}

const fmtDate = (iso) => {
	const t = Date.parse(iso ?? "");
	return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
};
const longDate = (key) => {
	const d = parseDay(key);
	return d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : key;
};

function calendarNode(summary) {
	const grid = calendarGrid(summary.calendar, { today: summary.today?.date });
	const label = `Practice over the last 12 weeks: ${grid.activeDays} ${grid.activeDays === 1 ? "day" : "days"}`
		+ ` with practice, ${grid.total} ${grid.total === 1 ? "attempt" : "attempts"}.`;
	const weekdays = el("div", { class: "psi-cal-col psi-cal-weekdays", "aria-hidden": "true" },
		el("span", { class: "psi-cal-month" }), ["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d) => el("span", {}, d)));
	return el("div", { class: "psi-cal", role: "img", "aria-label": label }, weekdays,
		grid.columns.map((col) => el("div", { class: "psi-cal-col", "aria-hidden": "true" },
			el("span", { class: "psi-cal-month" }, col.month),
			col.days.map((d) => el("span", { class: `psi-cal-day is-${d.level}${d.today ? " is-today" : ""}${d.future ? " is-future" : ""}`,
				title: d.future ? undefined : `${longDate(d.date)}: ${d.attempts} ${d.attempts === 1 ? "attempt" : "attempts"}` })))));
}

/** Mount the #/you page. */
export function mountYou(root) {
	let disposed = false;
	const view = el("div", { class: "psi-you psi-view", "aria-busy": "true" }, el("p", { class: "muted" }, "Opening your progress…"));
	root.replaceChildren(view);

	async function load() {
		try {
			const [summary, skills] = await Promise.all([api.get("/api/me"), api.get("/api/skills").catch(() => [])]);
			const slugs = (Array.isArray(skills) ? skills : []).map((s) => typeof s === "string" ? s : s?.skill).filter(Boolean);
			const details = await Promise.all(slugs.map((s) => api.get(`/api/skills/${encodeURIComponent(s)}`).catch(() => null)));
			if (disposed) return;
			render(summary, details.filter(Boolean).map((d) => d.progress));
		} catch (error) {
			if (disposed) return;
			const retry = el("button", { type: "button", onclick: () => void load() }, "Try again");
			view.replaceChildren(el("h1", {}, "Couldn't open your progress"),
				el("p", { class: "muted" }, `${String(error.message).replace(/\.$/, "")}. Check that psi web is running, then try again.`),
				retry);
		} finally { view.removeAttribute("aria-busy"); }
	}

	function render(summary, progresses) {
		const lvl = formatLevel(summary.totalXp);
		const streak = streakWords(summary.streakDays, (summary.today?.challenges || 0) + (summary.today?.minutes || 0) > 0);
		const groups = achievementGroups(summary.achievements);
		const totals = lifetimeTotals(progresses);
		const xpToday = Number(summary.today?.xp) || 0;
		const meter = el("progress", { class: "psi-meter psi-you-meter", max: "100", value: String(lvl.percent),
			"aria-label": `Level ${lvl.level}: ${lvl.toNextLabel}` }, `${lvl.percent}%`);
		const fact = (n, words) => el("div", {}, el("dt", {}, words), el("dd", {}, String(n)));
		view.replaceChildren(
			el("header", { class: "psi-you-head" },
				el("h1", { class: "psi-you-level" }, `Level ${summary.level ?? lvl.level}`),
				el("p", { class: "psi-you-title" }, summary.levelTitle || levelTitle(lvl.level)),
				meter,
				el("p", { class: "psi-you-xp" }, `${lvl.toNextLabel}. ${summary.totalXp ?? 0} XP so far.`)),
			el("section", { class: "psi-you-block", "aria-labelledby": "you-today" },
				el("h2", { id: "you-today" }, "Today"),
				goalWidget(summary, { onSaved: (next) => { summary = next; } }),
				xpToday > 0 ? el("p", { class: "muted psi-you-note" }, `+${xpToday} XP today.`) : null,
				summary.combo >= 3 ? el("p", { class: "psi-you-note" }, `${summary.combo} right in a row. Bonus XP is on.`) : null),
			el("section", { class: "psi-you-block", "aria-labelledby": "you-streak" },
				el("h2", { id: "you-streak" }, "Streak"),
				el("p", { class: "psi-you-streak" }, streak.text),
				el("p", { class: "muted" }, streak.hint),
				calendarNode(summary),
				el("p", { class: "muted psi-you-note" }, "Each square is a day. Darker squares mean more attempts, misses included.")),
			el("section", { class: "psi-you-block", "aria-labelledby": "you-ach" },
				el("h2", { id: "you-ach" }, "Achievements"),
				el("p", { class: "muted" }, `${groups.earned.length} of ${groups.earned.length + groups.open.length} earned`),
				groups.earned.length ? el("h3", {}, "Earned") : null,
				groups.earned.length ? el("ul", { class: "psi-you-list" }, groups.earned.map((a) => el("li", { class: "is-earned" },
					el("div", {}, el("strong", {}, a.title), el("span", {}, a.description)),
					a.earnedAt ? el("time", { datetime: a.earnedAt }, fmtDate(a.earnedAt)) : null))) : null,
				groups.open.length ? el("h3", {}, "Still to earn") : null,
				groups.open.length ? el("ul", { class: "psi-you-list" }, groups.open.map((a) => el("li", { class: "is-open" },
					el("div", {}, el("strong", {}, a.title), el("span", {}, `How to earn it: ${a.description}`))))) : null),
			el("section", { class: "psi-you-block", "aria-labelledby": "you-all" },
				el("h2", { id: "you-all" }, "All time"),
				el("dl", { class: "psi-you-totals" },
					fact(totals.attempts, "Attempts"), fact(totals.solved, "Solved"),
					fact(totals.misses, "Misses that taught you something"), fact(totals.hours, "Hours practised"))));
	}

	const offs = [on("psi:attempt", () => void load()), on("psi:lesson", () => void load())];
	void load();
	return { destroy() { disposed = true; offs.forEach((off) => off()); root.replaceChildren(); } };
}
