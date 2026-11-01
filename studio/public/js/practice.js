import { api } from "./api.js";
import { el, on, toast, formatLevel, streakLabel, hoursLabel } from "./ui.js";
import { nextSubskill } from "./bench.js";
import { pickAnnouncement, fillAnnouncement } from "./you.js";

const enc = encodeURIComponent;
const reason = (error) => String(error?.message ?? error).replace(/[.\s]+$/, "");
/** "What happened, what to do" for a failed request. */
const failure = (error) => error instanceof TypeError || /failed to fetch|network/i.test(error?.message ?? "")
	? "psi web didn't answer. Check that it's running, then try again." : `${reason(error)}. Try again in a moment.`;

/** Plain-language answer format for a challenge row. */
export function formatWords(c = {}) {
	if (c.format === "code") {
		const lang = { python: "Python", javascript: "JavaScript", sql: "SQL" }[c.language] ?? "";
		return lang ? `${lang} code` : "Code";
	}
	if (c.format === "choice") return "Multiple choice";
	if (c.format === "number") return "Number";
	if (c.format === "math") return "Math expression";
	if (c.kind === "explain" || c.kind === "build" || c.kind === "boss") return "Written answer";
	return "Short answer";
}

const TEX_WORDS = { times: "×", cdot: "·", Delta: "Δ", delta: "δ", pi: "π", theta: "θ", alpha: "α", beta: "β",
	lambda: "λ", mu: "μ", sigma: "σ", infty: "∞", int: "∫", sum: "Σ", prime: "′", left: "", right: "" };
const TEX_RELATIONS = { to: "→", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈" };
const SUPER = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻", "+": "⁺", n: "ⁿ" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "-": "₋", "+": "₊" };
function script(body, table, mark) {
	if ([...body].every((ch) => table[ch])) return [...body].map((ch) => table[ch]).join("");
	return body.length === 1 ? `${mark}${body}` : `${mark}(${scripts(body)})`;
}
function scripts(text) {
	return text.replace(/\^\{([^{}]*)\}|\^(\S)/g, (_, a, b) => script(a ?? b, SUPER, "^"))
		.replace(/_\{([^{}]*)\}|_(\S)/g, (_, a, b) => script(a ?? b, SUB, "_"));
}

/** Inline TeX as readable plain text for one-line previews: \frac{a}{b} → a/b, x^2 → x², \le → ≤. */
export function texText(tex = "") {
	const words = (text) => text.replace(/\\[,;:! ]/g, " ")
		.replace(/\\([a-zA-Z]+)\s*/g, (match, name) => name in TEX_RELATIONS ? ` ${TEX_RELATIONS[name]} `
			: TEX_WORDS[name] ?? name);
	const group = (text) => {
		const plain = words(text).trim();
		return /[+\-*/ ]/.test(plain) ? `(${plain})` : plain;
	};
	let text = String(tex).replace(/\\[dt]?frac(\d)(\d)/g, "$1/$2");
	for (let i = 0; i < 3; i++) {
		text = text.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${group(a)}/${group(b)}`)
			.replace(/\\sqrt\{([^{}]*)\}/g, (_, a) => `√${group(a)}`);
	}
	return scripts(words(text)).replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** First line of a markdown prompt as plain text (no emphasis, code ticks, links or shouted prefixes). */
export function promptPreview(prompt = "", max = 140) {
	const line = String(prompt).split(/\r?\n/).map((s) => s.trim()).find((s) => s && !/^```/.test(s)) ?? "";
	let text = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)__(\S.*?)__(?=\s|$)/g, "$1$2")
		.replace(/\*(\S.*?)\*/g, "$1").replace(/(^|\s)_(\S.*?)_(?=[\s.,;:!?]|$)/g, "$1$2")
		.replace(/^#{1,6}\s+|^>\s*|^[-*+]\s+|^\d+[.)]\s+/, "").replace(/\$\$?([^$]+)\$\$?/g, (_, tex) => texText(tex))
		.replace(/^(BOSS|BUILD|DEBUG|PREDICT|APPLY|EXPLAIN|QUICKFIRE)\b:?\s*/, "").replace(/\s+/g, " ").trim();
	if (text) text = text[0].toUpperCase() + text.slice(1);
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Plain sentences of a prompt (code fences dropped), for comparing prompts sentence by sentence. */
export function promptSentences(prompt = "") {
	return String(prompt ?? "").replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
		.replace(/\s+/g, " ").trim()
		.split(/(?<=[.!?])\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
}

/**
 * The part of each prompt that tells it apart from its neighbours: leading sentences that two or more
 * prompts share (a pack's setup boilerplate) are dropped. At least the last sentence always remains.
 */
export function distinctPrompts(prompts = []) {
	const split = prompts.map(promptSentences);
	const counts = new Map();
	for (const sentences of split) {
		for (let k = 1; k < sentences.length; k++) {
			const key = sentences.slice(0, k).join("\n");
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return split.map((sentences, i) => {
		let k = 0;
		for (let j = sentences.length - 1; j >= 1; j--) {
			if ((counts.get(sentences.slice(0, j).join("\n")) ?? 0) >= 2) { k = j; break; }
		}
		return sentences.slice(k).join(" ") || String(prompts[i] ?? "");
	});
}

/**
 * Subskill status in words, given the whole plan: Next up / Practising / Solid / Not started, or
 * "After step 2" / "After steps 1 and 3" for a locked one (steps are numbered in plan order; `names` spells them out).
 */
export function subskillStatus(sub, plan) {
	const subs = plan?.subskills ?? [];
	if (sub.status === "solid") return { key: "solid", text: "Solid" };
	if (sub.status === "practicing") return { key: "practising", text: "Practising" };
	const solid = new Set(subs.filter((s) => s.status === "solid").map((s) => s.id));
	const missing = (sub.prerequisites ?? []).filter((id) => !solid.has(id));
	if (missing.length) {
		const and = (items) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0];
		const numbers = missing.map((id) => subs.findIndex((s) => s.id === id) + 1);
		const names = missing.map((id) => subs.find((s) => s.id === id)?.title ?? id);
		if (numbers.every((n) => n > 0)) {
			const sorted = [...numbers].sort((a, b) => a - b);
			return { key: "locked", text: `After step${sorted.length > 1 ? "s" : ""} ${and(sorted.map(String))}`,
				names: `Unlocks after ${and(names)}` };
		}
		return { key: "locked", text: `After ${and(names.map((t) => /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t))}` };
	}
	let next;
	for (const s of subs) {
		if (s.status === "solid" || s.status === "practicing") continue;
		if (!(s.prerequisites ?? []).every((id) => solid.has(id))) continue;
		if (!next || s.priority < next.priority) next = s;
	}
	return next?.id === sub.id ? { key: "next", text: "Next up" } : { key: "ready", text: "Not started" };
}

const LANES = [1, 2, 1, 0];
/** Lane centres in the map track's 0–120 viewBox (CSS places the dots at the same fractions). */
export const LANE_X = [20, 60, 100];

/**
 * The skill's steps as stops on a level map, in route order: prerequisites first, otherwise plan order
 * (cycles and unknown prerequisites fall back to plan order). Each stop: { id, title, why, state, status,
 * lessonAvailable, lane, next } where state is solid | here | practising | ready | locked, `here` is the
 * step to work on now, and `next` describes the route segment to the following stop ("open" or "ahead").
 */
export function mapStops(plan) {
	const subs = Array.isArray(plan?.subskills) ? plan.subskills.filter((s) => s && s.id) : [];
	const known = new Set(subs.map((s) => s.id)), placed = new Set(), order = [];
	for (let found = true; found && order.length < subs.length;) {
		found = false;
		for (const s of subs) {
			if (placed.has(s.id) || !(s.prerequisites ?? []).every((p) => placed.has(p) || !known.has(p))) continue;
			order.push(s); placed.add(s.id); found = true; break;
		}
	}
	for (const s of subs) if (!placed.has(s.id)) order.push(s);
	const here = nextSubskill(plan)?.id;
	const stops = order.map((sub, i) => {
		const words = subskillStatus(sub, plan);
		const state = sub.status === "solid" ? "solid" : words.key === "locked" ? "locked" : sub.id === here ? "here"
			: sub.status === "practicing" ? "practising" : "ready";
		const status = state === "here" ? (sub.status === "practicing" ? "Continue here" : "Start here")
			: state === "locked" ? (words.names ?? words.text.replace(/^After/, "Unlocks after"))
			: state === "solid" ? "Solid" : state === "practising" ? "Practising" : "Not started";
		return { id: sub.id, title: sub.title || sub.id, why: sub.why ?? "", state, status,
			lessonAvailable: Boolean(sub.lessonAvailable), lane: LANES[i % LANES.length] };
	});
	return stops.map((stop, i) => ({ ...stop,
		next: i + 1 < stops.length ? (stops[i + 1].state === "locked" ? "ahead" : "open") : null }));
}

let summarize = (attempts) => `${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}`;

/** Load ./trail.js lazily; fall back to a minimal text trail if it is unavailable. */
async function loadTrail() {
	try {
		const mod = await import("./trail.js");
		if (typeof mod.renderTrail === "function") {
			if (typeof mod.trailSummary === "function") summarize = mod.trailSummary;
			return mod.renderTrail;
		}
	} catch { /* fall through */ }
	const words = { success: "Solved", partial: "Partly solved", fail: "Missed", skipped: "Skipped" };
	return (attempts, { label } = {}) => el("ol", { class: "psi-sk-fallback-trail", "aria-label": label ?? "Attempts" },
		attempts.map((a) => el("li", { class: `is-${a.outcome}`,
			title: a.lesson ? `${words[a.outcome]}: ${a.lesson}` : words[a.outcome] },
			el("span", { class: "psi-visually-hidden" }, words[a.outcome] ?? a.outcome))));
}

/** Mount the skill page at #/skills/:skill. */
export function mountPractice(host, { skill, navigate } = {}) {
	let disposed = false;
	const cleanups = [];
	const go = (hash) => (navigate ? navigate(hash) : (location.hash = hash));
	const openTutor = (prompt) => go(`#/new?${new URLSearchParams({ skill: skill || "", prompt })}`);
	const state = { plan: null, progress: {}, challenges: [], attempts: [], filter: "all", open: null };
	let renderTrail, refs = {};

	const root = el("section", { class: "psi-sk psi-view", "aria-busy": "true" },
		el("p", { class: "psi-sk-quiet" }, "Opening your skill…"));
	host.replaceChildren(root);

	const retryable = (title, body) => {
		const retry = el("button", { type: "button", onclick: () => void load() }, "Try again");
		root.replaceChildren(el("h1", {}, title), el("div", { class: "psi-sk-empty" },
			el("p", { class: "psi-sk-quiet" }, body), retry));
	};

	async function load() {
		root.setAttribute("aria-busy", "true");
		try {
			if (!skill) return await renderSkillList();
			const [detail, attempts, trail] = await Promise.all([
				api.get(`/api/skills/${enc(skill)}`),
				api.get(`/api/skills/${enc(skill)}/attempts?limit=200`).catch(() => []),
				renderTrail ? Promise.resolve(renderTrail) : loadTrail(),
			]);
			if (disposed) return;
			renderTrail = trail;
			state.plan = detail.plan; state.progress = detail.progress ?? {};
			state.challenges = detail.challenges ?? []; state.attempts = [...attempts].reverse();
			render();
		} catch (error) {
			if (disposed) return;
			if (/not found/i.test(error.message)) {
				root.replaceChildren(el("h1", {}, "No skill by that name"), el("div", { class: "psi-sk-empty" },
					el("p", { class: "psi-sk-quiet" }, `psi has no skill called “${skill}” on this machine. Start one from home.`),
					el("a", { class: "button primary", href: "#/" }, "Start a skill")));
			} else {
				retryable("Couldn't open this skill", failure(error));
			}
		} finally { root.removeAttribute("aria-busy"); }
	}

	async function renderSkillList() {
		const skills = await api.get("/api/skills");
		if (disposed) return;
		root.replaceChildren(el("h1", {}, "Your skills"));
		if (!skills.length) {
			root.append(el("div", { class: "psi-sk-empty" },
				el("p", { class: "psi-sk-quiet" }, "No skills yet. Add a skill pack or start one from home."),
				el("a", { class: "button primary", href: "#/" }, "Start a skill")));
			return;
		}
		root.append(el("ul", { class: "psi-sk-rows" }, skills.map((s) => {
			const slug = typeof s === "string" ? s : s.skill;
			return el("li", { class: "psi-sk-row" }, el("a", { href: `#/skills/${enc(slug)}` }, s.title ?? slug));
		})));
	}

	function render() {
		const plan = state.plan ?? {};
		const title = plan.title || skill;
		root.replaceChildren();
		const target = (plan.targetPerformance ?? "").trim();
		const header = el("header", { class: "psi-sk-head" },
			el("h1", {}, title),
			target ? el("p", { class: "psi-sk-target" }, /[.!?]$/.test(target) ? target : `${target}.`)
				: el("p", { class: "psi-sk-target psi-sk-quiet" }, "No target yet. Ask the tutor to plan this skill."),
			el("button", { type: "button", class: "primary", onclick: () => openTutor("/practice") }, "Practice with the tutor"));
		refs.trail = el("div", { class: "psi-sk-trail" });
		refs.stats = el("div", { class: "psi-sk-stats" });
		// Level-up and achievement moments are written into this live region after an attempt.
		refs.announce = el("div", { class: "psi-announce psi-sk-announce", role: "status", "aria-live": "polite" });
		root.append(header, renderMap(plan),
			el("section", { class: "psi-sk-block", "aria-labelledby": "psi-sk-trail-h" },
				el("h2", { id: "psi-sk-trail-h" }, "Your attempts"), refs.trail, refs.stats, refs.announce),
			renderChallenges());
		drawTrail(false);
		drawStats();
	}

	function drawTrail(animateLast) {
		refs.trail.replaceChildren();
		if (!state.attempts.length) {
			refs.trail.append(el("p", { class: "psi-sk-quiet" },
				"No attempts yet. Your first one leaves a mark here, solved or missed."));
			return;
		}
		refs.trail.append(renderTrail(state.attempts, { animateLast, label: `Attempts on ${state.plan?.title || skill}` }),
			el("p", { class: "psi-sk-quiet psi-sk-trail-sum" }, `${summarize(state.attempts)}. Every miss stays on the trail.`));
	}

	function drawStats(leveledUp = false) {
		const p = state.progress;
		const lvl = formatLevel(p.xp ?? 0);
		const goal = state.plan?.hoursGoal ?? 20;
		const minutes = Number(p.minutesLogged) || 0;
		const hoursPct = Math.max(0, Math.min(100, (minutes / 60 / goal) * 100));
		const streak = streakLabel(p.streakDays);
		refs.stats.replaceChildren(
			el("div", { class: `psi-sk-stat psi-sk-level${leveledUp ? " is-levelup" : ""}` },
				el("strong", {}, lvl.label),
				// Meters appear once there is progress to fill; an empty track reads as an underline.
				lvl.percent > 0 ? el("div", { class: "psi-sk-meter is-level", role: "progressbar", "aria-label": `${lvl.label} progress`,
					"aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(lvl.percent),
					"aria-valuetext": lvl.toNextLabel }, el("span", { style: { width: `${lvl.percent}%` } })) : null,
				el("span", { class: "psi-sk-quiet" }, lvl.toNextLabel)),
			el("div", { class: "psi-sk-stat" },
				el("strong", {}, "Practice time"),
				minutes > 0 ? el("div", { class: "psi-sk-meter is-hours", role: "progressbar", "aria-label": "Hours practised",
					"aria-valuemin": "0", "aria-valuemax": String(goal), "aria-valuenow": String(Math.round(minutes / 6) / 10),
					"aria-valuetext": hoursLabel(minutes, goal) }, el("span", { style: { width: `${hoursPct}%` } })) : null,
				el("span", { class: "psi-sk-quiet" }, hoursLabel(minutes, goal))),
			el("div", { class: "psi-sk-stat" },
				el("strong", {}, streak ? streak.charAt(0).toUpperCase() + streak.slice(1) : "No streak yet"),
				el("span", { class: "psi-sk-quiet" },
					streak ? "Practise tomorrow to keep it going." : "Practise today to start one.")));
	}

	/** Prompt previews that tell challenges apart (shared setup sentences dropped). */
	function previews() {
		const all = state.challenges;
		const distinct = distinctPrompts(all.map((c) => c.prompt));
		return new Map(all.map((c, i) => [c.id, promptPreview(distinct[i]) || promptPreview(c.prompt)]));
	}

	/** The skill's steps as a level map: stops on a pencil route, the next one ringed in ink. */
	function renderMap(plan) {
		const stops = mapStops(plan);
		const solid = stops.filter((s) => s.state === "solid").length;
		const section = el("section", { class: "psi-sk-block psi-map-block", "aria-labelledby": "psi-sk-map-h" },
			el("div", { class: "psi-sk-block-head" }, el("h2", { id: "psi-sk-map-h" }, "Your route"),
				stops.length ? el("p", { class: "psi-sk-quiet psi-map-count" }, `${solid} of ${stops.length} steps solid`) : null));
		if (!stops.length) {
			section.append(el("p", { class: "psi-sk-quiet" }, "No steps yet. Ask the tutor to break this skill into steps."));
			return section;
		}
		refs.map = el("ol", { class: "psi-map", "aria-label": `Steps in ${plan.title || skill}` },
			stops.map((stop) => buildStop(stop, stop.state === "here")));
		section.append(refs.map);
		return section;
	}

	function stopRail(stop) {
		const rail = el("span", { class: "psi-map-rail", "aria-hidden": "true" });
		if (stop.next) {
			const ns = "http://www.w3.org/2000/svg";
			const svg = document.createElementNS(ns, "svg");
			svg.setAttribute("class", `psi-map-seg is-${stop.next}`);
			svg.setAttribute("viewBox", "0 0 120 100");
			svg.setAttribute("preserveAspectRatio", "none");
			const path = document.createElementNS(ns, "path");
			const a = LANE_X[stop.lane], b = LANE_X[stop.nextLane ?? stop.lane];
			path.setAttribute("d", `M${a} 0 C${a} 55 ${b} 45 ${b} 100`);
			path.setAttribute("vector-effect", "non-scaling-stroke");
			svg.append(path);
			rail.append(svg);
		}
		rail.append(el("span", { class: `psi-map-dot lane-${stop.lane}` }));
		return rail;
	}

	function stopMeta(stop) {
		const count = state.challenges.filter((c) => c.subskillId === stop.id).length;
		const parts = [stop.lessonAvailable ? "Lesson ready" : "", count ? `${count} ${count === 1 ? "challenge" : "challenges"}` : ""]
			.filter(Boolean);
		return parts.length ? el("p", { class: "psi-map-meta" }, parts.join(", ")) : null;
	}

	function buildStop(stop, expanded = false) {
		const stops = mapStops(state.plan);
		const index = stops.findIndex((s) => s.id === stop.id);
		stop = { ...stop, nextLane: stops[index + 1]?.lane };
		const li = el("li", { class: `psi-map-stop is-${stop.state}`, dataset: { id: stop.id } });
		const panelId = `psi-map-panel-${stop.id}`;
		const status = el("p", { class: "psi-map-status" }, stop.status);
		if (stop.state === "locked") {
			li.append(stopRail(stop), el("div", { class: "psi-map-body" },
				el("h3", { class: "psi-map-title" }, el("span", {}, stop.title)), status, stopMeta(stop)));
			return li;
		}
		const panel = el("div", { class: "psi-map-panel", id: panelId, hidden: !expanded });
		const title = el("button", { type: "button", class: "psi-map-toggle", "aria-expanded": String(expanded),
			"aria-controls": panelId, onclick: () => {
				const open = panel.hidden;
				panel.hidden = !open; title.setAttribute("aria-expanded", String(open));
				li.classList.toggle("is-expanded", open);
			} }, stop.title);
		const list = el("div", { class: "psi-map-practice", hidden: true });
		const practise = el("button", { type: "button", class: stop.state === "here" && stop.status === "Continue here" ? "primary" : "",
			"aria-expanded": "false", onclick: () => {
				const open = list.hidden;
				list.hidden = !open; practise.setAttribute("aria-expanded", String(open));
				if (open && !list.firstChild) fillPractice(stop, list);
			} }, "Practise");
		const learn = el("button", { type: "button", class: stop.state === "here" && stop.status === "Start here" ? "primary" : "",
			onclick: () => openTutor(`Teach me ${stop.title}`) }, "Learn this step");
		panel.append(stop.why ? el("p", { class: "psi-sk-quiet psi-map-why" }, stop.why) : null,
			el("div", { class: "psi-map-actions" }, stop.state === "solid" ? [practise, learn] : [learn, practise]), list);
		li.classList.toggle("is-expanded", expanded);
		li.append(stopRail(stop), el("div", { class: "psi-map-body" },
			el("h3", { class: "psi-map-title" }, title), status, stopMeta(stop), panel));
		return li;
	}

	function fillPractice(stop, list) {
		const mine = state.challenges.filter((c) => c.subskillId === stop.id);
		if (!mine.length) {
			list.replaceChildren(el("div", { class: "psi-sk-empty" },
				el("p", { class: "psi-sk-quiet" }, "No challenges for this step yet."),
				el("button", { type: "button", onclick: () => openTutor(`Give me a challenge on ${stop.title}`) }, "Get a challenge")));
			return;
		}
		const preview = previews();
		list.replaceChildren(el("ul", { class: "psi-sk-rows", "aria-label": `Challenges for ${stop.title}` },
			mine.map((c) => challengeRow(c, preview.get(c.id)))));
	}

	/** Redraw stop markers and status after the plan changes, leaving any open challenge sheet in place. */
	function refreshMap() {
		if (!refs.map?.isConnected) return;
		const stops = mapStops(state.plan);
		if (stops.length !== refs.map.children.length) { refs.map.closest("section")?.replaceWith(renderMap(state.plan)); return; }
		const solid = stops.filter((s) => s.state === "solid").length;
		const count = refs.map.closest("section")?.querySelector(".psi-map-count");
		if (count) count.textContent = `${solid} of ${stops.length} steps solid`;
		stops.forEach((stop, i) => {
			const li = refs.map.children[i];
			const busy = li.dataset.id === stop.id && li.querySelector(".psi-sk-challenge.is-open");
			if (!busy) { li.replaceWith(buildStop(stop, li.classList.contains("is-expanded"))); return; }
			const rail = li.querySelector(".psi-map-rail");
			rail.replaceWith(stopRail({ ...stop, nextLane: stops[i + 1]?.lane }));
			li.className = `psi-map-stop is-${stop.state} is-expanded`;
			li.querySelector(".psi-map-status").textContent = stop.status;
		});
	}

	function lastAttempt(c) {
		for (let i = state.attempts.length - 1; i >= 0; i--) if (state.attempts[i].challengeId === c.id) return state.attempts[i];
		return c.lastOutcome ? { id: `${c.id}-last`, challengeId: c.id, outcome: c.lastOutcome } : undefined;
	}

	function renderChallenges() {
		const section = el("section", { class: "psi-sk-block", "aria-labelledby": "psi-sk-ch-h" });
		const filters = [["all", "All"], ["new", "Not tried"], ["missed", "Missed"]];
		const bar = el("div", { class: "psi-sk-filters", role: "group", "aria-label": "Show challenges" },
			filters.map(([key, label]) => el("button", { type: "button", class: "quiet",
				"aria-pressed": String(state.filter === key),
				onclick: () => { state.filter = key; state.open = null; refs.list.replaceWith(refs.list = challengeList());
					for (const b of bar.children) b.setAttribute("aria-pressed", String(b.dataset.key === key)); },
				dataset: { key } }, label)));
		refs.list = challengeList();
		section.append(el("div", { class: "psi-sk-block-head" }, el("h2", { id: "psi-sk-ch-h" }, "Challenges"), bar),
			refs.list);
		return section;
	}

	function challengeList() {
		const all = state.challenges;
		if (!all.length) {
			return el("div", { class: "psi-sk-empty" },
				el("p", {}, "No challenges yet. Practice with the tutor to get your first one."),
				el("button", { type: "button", onclick: () => openTutor("/challenge") }, "Get a challenge"));
		}
		const shown = all.filter((c) => state.filter === "all" || (state.filter === "new" ? !c.attempted
			: lastAttempt(c)?.outcome === "fail"));
		if (!shown.length) {
			return el("p", { class: "psi-sk-empty psi-sk-quiet" }, state.filter === "new"
				? "You've tried every challenge here. Ask the tutor for a new one."
				: "Nothing missed right now. Misses show up here so you can go back to them.");
		}
		// Previews come from what differs between prompts, so rows sharing a setup sentence stay distinguishable.
		const preview = previews();
		return el("ul", { class: "psi-sk-rows", "aria-label": "Challenges" },
			shown.map((c) => challengeRow(c, preview.get(c.id))));
	}

	function challengeRow(c, preview) {
		const last = lastAttempt(c);
		const mark = el("span", { class: "psi-sk-mark" });
		if (last) mark.append(renderTrail([last], { label: "Last result" }));
		// No mark means not tried yet; the "Not tried" filter covers that, so the row stays quiet.
		const sheet = el("div", { class: "psi-sk-sheet", hidden: true, id: `psi-sk-sheet-${c.id}` });
		const tryButton = el("button", { type: "button", "aria-expanded": "false", "aria-controls": sheet.id,
			onclick: () => toggle(c, row, tryButton, sheet) }, "Try");
		const row = el("li", { class: "psi-sk-row psi-sk-challenge", dataset: { id: c.id } },
			el("div", { class: "psi-sk-row-main" },
				el("span", { class: "psi-sk-prompt" }, preview || "Untitled challenge"),
				el("span", { class: "psi-sk-quiet psi-sk-format" }, formatWords(c))),
			mark, tryButton, sheet);
		return row;
	}

	async function toggle(c, row, button, sheet) {
		if (!sheet.hidden) { closeSheet(row, button, sheet); return; }
		for (const open of root.querySelectorAll(".psi-sk-challenge.is-open")) {
			closeSheet(open, open.querySelector(":scope > button"), open.querySelector(".psi-sk-sheet"));
		}
		row.classList.add("is-open"); sheet.hidden = false;
		button.textContent = "Close"; button.setAttribute("aria-expanded", "true");
		sheet.replaceChildren(el("p", { class: "psi-sk-quiet" }, "Opening the challenge…"));
		try {
			const [{ renderToolWidget }, full] = await Promise.all([import("./widgets.js"),
				api.get(`/api/skills/${enc(skill)}/challenges/${enc(c.id)}`)]);
			if (disposed || sheet.hidden) return;
			const ctx = {
				api, skill,
				// The sheet narrates every saved attempt for chat; here the page itself shows the result.
				continueAfterAttempt: false,
				send: async (message) => {
					const text = String(message ?? "").trim();
					// Attempts and lessons are already saved and drawn here; only real questions go to the tutor.
				if (!text || /^(Answered challenge|Lesson for challenge)\b/.test(text)) return;
					if (text === "Next challenge") { openNext(c); return; }
					openTutor(text);
				},
				toast: (message, opts) => toast(message, opts),
				onAttempt: recordAttempt,
			};
			const result = { details: { widget: { ...full, type: "challenge" } } };
			const widget = await renderToolWidget("psi_challenge", { skill, id: c.id }, result, ctx);
			if (disposed || sheet.hidden) { widget?.destroy?.(); return; }
			const node = widget instanceof Node ? widget : widget?.el;
			if (!(node instanceof Node)) throw new Error("The challenge sheet isn't available");
			sheet.replaceChildren(node);
			if (typeof widget?.destroy === "function") sheet._destroy = () => widget.destroy();
			node.querySelector("input, textarea, [contenteditable=true], button")?.focus({ preventScroll: true });
		} catch (error) {
			if (disposed) return;
			sheet.replaceChildren(el("p", { class: "psi-sk-error" }, `Couldn't open this challenge. ${failure(error)}`),
				el("button", { type: "button", onclick: () => openTutor(`Let's work on this challenge: ${c.prompt}`) },
					"Try it with the tutor"));
		}
	}

	/** Open the next not-yet-tried challenge after `c` inline, or ask the tutor for a new one. */
	function openNext(c) {
		const current = root.querySelector(`.psi-sk-challenge.is-open[data-id="${CSS.escape(c.id)}"]`);
		const rows = [...(current?.closest("ul") ?? refs.list).querySelectorAll(":scope > .psi-sk-challenge")];
		const from = rows.findIndex((r) => r.dataset.id === c.id);
		const untried = (r) => !state.challenges.find((x) => x.id === r.dataset.id)?.attempted;
		const next = [...rows.slice(from + 1), ...rows.slice(0, Math.max(0, from))].find(untried);
		if (!next) { openTutor("/challenge"); return; }
		next.querySelector(":scope > button")?.click();
		const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
		next.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
	}

	function closeSheet(row, button, sheet) {
		sheet._destroy?.(); sheet._destroy = undefined;
		sheet.hidden = true; sheet.replaceChildren(); row.classList.remove("is-open");
		if (button) { button.textContent = "Try"; button.setAttribute("aria-expanded", "false"); }
	}

	function recordAttempt(detail) {
		const attempt = detail?.attempt;
		if (disposed || !attempt || attempt.outcome === "pending" || !refs.trail) return;
		if ((attempt.skill ?? detail.progress?.skill) !== skill) return;
		if (state.attempts.some((a) => a.id === attempt.id)) return;
		state.attempts.push(attempt);
		if (detail.progress) state.progress = detail.progress;
		const c = state.challenges.find((x) => x.id === attempt.challengeId);
		if (c) { c.attempted = true; c.attempts = (c.attempts ?? 0) + 1; c.lastOutcome = attempt.outcome; }
		drawTrail(true);
		// One stroke per moment: the announcement carries a level-up, so the level number doesn't swipe as well.
		const moment = pickAnnouncement(detail);
		drawStats(Boolean(detail.leveledUp) && !moment);
		if (moment && refs.announce) {
			fillAnnouncement(refs.announce, moment);
			clearTimeout(refs.announceTimer);
			refs.announceTimer = setTimeout(() => { if (!disposed) fillAnnouncement(refs.announce, null); }, 12000);
		}
		if (c) {
			for (const mark of root.querySelectorAll(`.psi-sk-challenge[data-id="${CSS.escape(c.id)}"] .psi-sk-mark`)) {
				mark.replaceChildren(renderTrail([attempt], { animateLast: true, label: "Last result" }));
			}
		}
		// Statuses (solid steps, unlocked stops) come from the server's progression rules.
		void api.get(`/api/skills/${enc(skill)}`).then((detail) => {
			if (disposed || !detail?.plan) return;
			state.plan = detail.plan;
			refreshMap();
		}).catch(() => {});
	}
	cleanups.push(on("attempt", recordAttempt));
	// A lesson saved after a miss is written under that mark on the trail.
	cleanups.push(on("lesson", (detail) => {
		const saved = detail?.attempt;
		const mine = saved && state.attempts.find((a) => a.id === saved.id);
		if (disposed || !mine || !refs.trail) return;
		mine.lesson = saved.lesson; mine.xp = saved.xp;
		if (detail.progress) state.progress = detail.progress;
		drawTrail(false);
		drawStats(Boolean(detail.leveledUp));
	}));

	void load();
	return {
		destroy() {
			disposed = true;
			clearTimeout(refs.announceTimer);
			for (const cleanup of cleanups) cleanup();
			for (const sheet of host.querySelectorAll(".psi-sk-sheet")) sheet._destroy?.();
			host.replaceChildren();
		},
	};
}
