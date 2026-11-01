/**
 * The attempt trail: every attempt leaves one hand-drawn mark, oldest on the left.
 *
 * - solved (success): a highlighter swipe
 * - partial: a half swipe
 * - missed (fail): a pencil ring; the lesson shows under the trail on hover/focus and is in the mark's label
 * - skipped: a small pencil dot
 *
 * API
 * - `renderTrail(attempts, { animateLast = false, label } = {})` → HTMLElement. attempts: [{ outcome, lesson?, at, xp? }]
 *   oldest → newest. Unknown outcomes (e.g. "pending") are left out.
 * - `appendMark(trailEl, attempt)` adds one mark and draws it (≈400 ms; instant with reduced motion).
 * - `markSvg(outcome)` → SVGElement for a single mark (used by challenge results and code test rows).
 * - Pure helpers (no DOM): `trailCounts`, `trailSummary`, `markLabel`, `outcomeWord`.
 */

import { currentGameLayer, gameRules } from "./format.js";

export const OUTCOMES = ["success", "partial", "fail", "skipped"];
const WORDS = { success: "solved", partial: "partly right", fail: "missed", skipped: "skipped" };
const SVG = "http://www.w3.org/2000/svg";

/** Plain word for an outcome: "solved", "partly right", "missed", "skipped". */
export function outcomeWord(outcome) { return WORDS[outcome] ?? ""; }

/** Count recognised outcomes. */
export function trailCounts(attempts = []) {
	const counts = { total: 0, success: 0, partial: 0, fail: 0, skipped: 0 };
	for (const attempt of attempts ?? []) {
		if (!OUTCOMES.includes(attempt?.outcome)) continue;
		counts.total++;
		counts[attempt.outcome]++;
	}
	return counts;
}

/** One-sentence summary, e.g. "12 attempts: 8 solved, 3 missed, 1 skipped". */
export function trailSummary(attempts = []) {
	const c = trailCounts(attempts);
	if (!c.total) return "No attempts yet";
	const parts = OUTCOMES.filter((o) => c[o] > 0).map((o) => `${c[o]} ${WORDS[o]}`);
	return `${c.total} ${c.total === 1 ? "attempt" : "attempts"}: ${parts.join(", ")}`;
}

function when(at, now) {
	const then = Date.parse(at ?? "");
	if (!Number.isFinite(then)) return "";
	const seconds = Math.max(0, (now - then) / 1000);
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
	if (seconds < 172800) return "yesterday";
	if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
	return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Accessible label for one mark, e.g. "Attempt 4, missed, 2 h ago. Lesson: check the base case." */
export function markLabel(attempt = {}, index = 0, now = Date.now()) {
	const parts = [`Attempt ${index + 1}`, outcomeWord(attempt.outcome) || "recorded"];
	if (Number(attempt.hintsUsed) > 0) parts.push("with a hint");
	const xp = Number(attempt.xp);
	// XP is game layer: left out when the learner turned the layer off.
	if (Number.isFinite(xp) && xp > 0 && gameRules(currentGameLayer()).numbers) parts.push(`+${xp} XP`);
	const time = when(attempt.at, now);
	if (time) parts.push(time);
	let text = parts.join(", ") + ".";
	const lesson = typeof attempt.lesson === "string" ? attempt.lesson.trim() : "";
	if (lesson) text += ` Lesson: ${lesson}`;
	return text;
}

function svgNode(tag, attrs) {
	const n = document.createElementNS(SVG, tag);
	for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
	return n;
}

/** One mark drawn in a 28 × 20 box. Strokes use pathLength=1 so CSS can draw them left to right. */
export function markSvg(outcome) {
	const svg = svgNode("svg", { viewBox: "0 0 28 20", width: 28, height: 20, class: `psi-mark is-${outcome}`,
		"aria-hidden": "true", focusable: "false" });
	if (outcome === "success") {
		svg.append(svgNode("path", { d: "M2.5 11.6 L25.5 9.4", class: "psi-mark-swipe", pathLength: 1 }));
	} else if (outcome === "partial") {
		svg.append(svgNode("path", { d: "M2.5 11.6 L25.5 9.4", class: "psi-mark-ghost" }),
			svgNode("path", { d: "M2.5 11.6 L14 10.5", class: "psi-mark-swipe", pathLength: 1 }));
	} else if (outcome === "fail") {
		// A loose, slightly overlapping hand-drawn ring.
		svg.append(svgNode("path", { class: "psi-mark-ring", pathLength: 1,
			d: "M19.6 5.6 C16.8 2.6 8.4 3.2 7 8.6 C5.8 13.4 10.4 16.6 15.2 15.8 C20 15 22.2 10.8 20.6 7.6 C19.8 6.1 18.2 5.2 16.4 4.9" }));
	} else {
		svg.append(svgNode("circle", { cx: 14, cy: 10.5, r: 2.2, class: "psi-mark-dot" }));
	}
	return svg;
}

const state = new WeakMap();

/** Marks draw in only with the game layer on and motion allowed; quiet and off place them at once. */
function reducedMotion() {
	return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !gameRules(currentGameLayer()).motion;
}

function setLabel(trailEl) {
	const s = state.get(trailEl);
	const summary = trailSummary(s.attempts);
	trailEl.setAttribute("aria-label", s.label ? `${s.label}: ${summary}` : summary);
	trailEl.dataset.count = String(trailCounts(s.attempts).total);
}

function showTip(trailEl, mark) {
	const s = state.get(trailEl);
	if (!mark) { s.tip.hidden = true; return; }
	const attempt = s.attempts[Number(mark.dataset.index)];
	const lesson = typeof attempt?.lesson === "string" ? attempt.lesson.trim() : "";
	const word = outcomeWord(attempt?.outcome);
	s.tip.replaceChildren();
	const head = document.createElement("strong");
	head.textContent = word ? word[0].toUpperCase() + word.slice(1) : "Attempt";
	s.tip.append(head);
	const xp = Number(attempt?.xp), numbers = gameRules(currentGameLayer()).numbers;
	const extra = [Number(attempt?.hintsUsed) > 0 ? "with a hint" : "", Number.isFinite(xp) && xp > 0 && numbers ? `+${xp} XP` : "",
		when(attempt?.at, Date.now())].filter(Boolean).join(", ");
	if (extra) s.tip.append(document.createTextNode(`, ${extra}`));
	if (lesson) {
		const p = document.createElement("span");
		p.className = "psi-trail-lesson";
		p.textContent = `Lesson: ${lesson}`;
		s.tip.append(p);
	}
	s.tip.hidden = false;
	// Position under the mark, kept inside the trail's width (CSSOM writes are CSP-safe).
	const host = trailEl.getBoundingClientRect(), box = mark.getBoundingClientRect();
	const tipWidth = s.tip.offsetWidth || 0;
	const left = Math.max(0, Math.min(box.left - host.left + box.width / 2 - tipWidth / 2, host.width - tipWidth));
	s.tip.style.left = `${Math.round(left)}px`;
}

function makeMark(trailEl, attempt, index) {
	const mark = document.createElement("span");
	mark.className = `psi-trail-mark is-${attempt.outcome}`;
	mark.setAttribute("role", "listitem");
	mark.tabIndex = -1;
	mark.dataset.index = String(index);
	mark.setAttribute("aria-label", markLabel(attempt, index));
	mark.append(markSvg(attempt.outcome));
	return mark;
}

/** Roving tab stop: only one mark is in the tab order; arrows, Home and End move between marks. */
function setCurrent(trailEl, mark, focus = false) {
	const s = state.get(trailEl);
	for (const m of s.list.children) m.tabIndex = -1;
	if (!mark) return;
	mark.tabIndex = 0;
	if (focus) {
		mark.focus();
		mark.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	}
}

function keepNewestVisible(trailEl) {
	const s = state.get(trailEl);
	if (!s.pinned) return;
	s.scroller.scrollLeft = s.scroller.scrollWidth;
}

/** Render an attempt trail. `label` names it for assistive tech, e.g. "Attempt trail for SQL lab". */
export function renderTrail(attempts = [], { animateLast = false, label = "Attempt trail" } = {}) {
	const list = (attempts ?? []).filter((a) => OUTCOMES.includes(a?.outcome)).slice(-300);
	const trailEl = document.createElement("div");
	trailEl.className = "psi-trail";
	const scroller = document.createElement("div");
	scroller.className = "psi-trail-scroll";
	const marks = document.createElement("div");
	marks.className = "psi-trail-marks";
	marks.setAttribute("role", "list");
	const empty = document.createElement("p");
	empty.className = "psi-trail-empty";
	empty.textContent = "Your first attempt leaves the first mark here.";
	const tip = document.createElement("div");
	tip.className = "psi-trail-tip";
	tip.setAttribute("aria-hidden", "true");
	tip.hidden = true;
	scroller.append(marks);
	trailEl.append(scroller, empty, tip);
	// The trail is a list of marks; its accessible name is the summary sentence.
	trailEl.setAttribute("role", "group");
	state.set(trailEl, { attempts: [...list], label, list: marks, scroller, tip, empty, pinned: true });
	list.forEach((attempt, i) => marks.append(makeMark(trailEl, attempt, i)));
	empty.hidden = list.length > 0;
	setLabel(trailEl);
	setCurrent(trailEl, marks.lastElementChild);
	if (animateLast && marks.lastElementChild && !reducedMotion()) marks.lastElementChild.classList.add("is-new");

	scroller.addEventListener("scroll", () => {
		const s = state.get(trailEl);
		s.pinned = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
	}, { passive: true });
	if (typeof ResizeObserver === "function") new ResizeObserver(() => keepNewestVisible(trailEl)).observe(scroller);

	marks.addEventListener("keydown", (event) => {
		const current = /** @type {Element} */ (event.target).closest?.(".psi-trail-mark");
		if (!current) return;
		const all = [...marks.children];
		const i = all.indexOf(current);
		const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[event.key];
		if (next === undefined) {
			if (event.key === "Escape") showTip(trailEl, null);
			return;
		}
		event.preventDefault();
		const target = all[Math.max(0, Math.min(all.length - 1, next))];
		setCurrent(trailEl, target, true);
	});
	marks.addEventListener("focusin", (event) => showTip(trailEl, /** @type {Element} */ (event.target).closest?.(".psi-trail-mark")));
	marks.addEventListener("focusout", () => showTip(trailEl, null));
	marks.addEventListener("pointerover", (event) => {
		const mark = /** @type {Element} */ (event.target).closest?.(".psi-trail-mark");
		if (mark) showTip(trailEl, mark);
	});
	marks.addEventListener("pointerleave", () => {
		if (!marks.contains(document.activeElement)) showTip(trailEl, null);
	});
	return trailEl;
}

/** Add one attempt to a rendered trail and draw its mark. Returns the new mark (or null when skipped). */
export function appendMark(trailEl, attempt) {
	const s = state.get(trailEl);
	if (!s || !OUTCOMES.includes(attempt?.outcome)) return null;
	s.attempts.push(attempt);
	const mark = makeMark(trailEl, attempt, s.attempts.length - 1);
	if (!reducedMotion()) mark.classList.add("is-new");
	s.list.append(mark);
	s.empty.hidden = true;
	setLabel(trailEl);
	setCurrent(trailEl, mark);
	s.pinned = true;
	keepNewestVisible(trailEl);
	return mark;
}
