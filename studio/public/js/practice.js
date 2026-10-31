import { api } from "./api.js";
import { el, on, toast, formatLevel, streakLabel, hoursLabel } from "./ui.js";

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

/** First line of a markdown prompt as plain text (no emphasis, code ticks, links or shouted prefixes). */
export function promptPreview(prompt = "", max = 140) {
	const line = String(prompt).split(/\r?\n/).map((s) => s.trim()).find((s) => s && !/^```/.test(s)) ?? "";
	let text = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)__(\S.*?)__(?=\s|$)/g, "$1$2")
		.replace(/\*(\S.*?)\*/g, "$1").replace(/(^|\s)_(\S.*?)_(?=[\s.,;:!?]|$)/g, "$1$2")
		.replace(/^#{1,6}\s+|^>\s*|^[-*+]\s+|^\d+[.)]\s+/, "").replace(/\$\$?([^$]+)\$\$?/g, "$1")
		.replace(/\\times\b/g, "×").replace(/\\cdot\b/g, "·").replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
		.replace(/\\([a-zA-Z]+)\b\s*/g, "$1 ").replace(/[{}]/g, "")
		.replace(/^(BOSS|BUILD|DEBUG|PREDICT|APPLY|EXPLAIN|QUICKFIRE)\b:?\s*/, "").replace(/\s+/g, " ").trim();
	if (text) text = text[0].toUpperCase() + text.slice(1);
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Subskill status in words, given the whole plan (Next up / Practising / Solid / Locked: after X / Not started). */
export function subskillStatus(sub, plan) {
	const subs = plan?.subskills ?? [];
	if (sub.status === "solid") return { key: "solid", text: "Solid" };
	if (sub.status === "practicing") return { key: "practising", text: "Practising" };
	const solid = new Set(subs.filter((s) => s.status === "solid").map((s) => s.id));
	const missing = (sub.prerequisites ?? []).filter((id) => !solid.has(id));
	if (missing.length) {
		// Lower-case a leading capital only when the next letter is lower-case ("Read syntax" → "read syntax", "SQL" stays).
		const names = missing.map((id) => subs.find((s) => s.id === id)?.title ?? id)
			.map((t) => /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
		const after = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
		return { key: "locked", text: `Locked: after ${after}` };
	}
	let next;
	for (const s of subs) {
		if (s.status === "solid" || s.status === "practicing") continue;
		if (!(s.prerequisites ?? []).every((id) => solid.has(id))) continue;
		if (!next || s.priority < next.priority) next = s;
	}
	return next?.id === sub.id ? { key: "next", text: "Next up" } : { key: "ready", text: "Not started" };
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
		root.append(header,
			el("section", { class: "psi-sk-block", "aria-labelledby": "psi-sk-trail-h" },
				el("h2", { id: "psi-sk-trail-h" }, "Your attempts"), refs.trail, refs.stats),
			renderSubskills(plan), renderChallenges());
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
				el("div", { class: "psi-sk-meter is-level", role: "progressbar", "aria-label": `${lvl.label} progress`,
					"aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(lvl.percent),
					"aria-valuetext": lvl.toNextLabel }, el("span", { style: { width: `${lvl.percent}%` } })),
				el("span", { class: "psi-sk-quiet" }, lvl.toNextLabel)),
			el("div", { class: "psi-sk-stat" },
				el("strong", {}, "Practice time"),
				el("div", { class: "psi-sk-meter is-hours", role: "progressbar", "aria-label": "Hours practised",
					"aria-valuemin": "0", "aria-valuemax": String(goal), "aria-valuenow": String(Math.round(minutes / 6) / 10),
					"aria-valuetext": hoursLabel(minutes, goal) }, el("span", { style: { width: `${hoursPct}%` } })),
				el("span", { class: "psi-sk-quiet" }, hoursLabel(minutes, goal))),
			el("div", { class: "psi-sk-stat" },
				el("strong", {}, streak ? streak.charAt(0).toUpperCase() + streak.slice(1) : "No streak yet"),
				el("span", { class: "psi-sk-quiet" },
					streak ? "Practise tomorrow to keep it going." : "Practise today to start one.")));
	}

	function renderSubskills(plan) {
		const subs = plan.subskills ?? [];
		const section = el("section", { class: "psi-sk-block", "aria-labelledby": "psi-sk-steps-h" },
			el("h2", { id: "psi-sk-steps-h" }, "Steps"));
		if (!subs.length) {
			section.append(el("p", { class: "psi-sk-quiet" }, "No steps yet. Ask the tutor to break this skill into steps."));
			return section;
		}
		section.append(el("ol", { class: "psi-sk-steps" }, subs.map((sub) => {
			const status = subskillStatus(sub, plan);
			return el("li", { class: `psi-sk-step is-${status.key}` },
				el("span", { class: "psi-sk-check", "aria-hidden": "true" }),
				el("div", { class: "psi-sk-step-body" },
					el("span", { class: "psi-sk-step-title" }, sub.title),
					sub.why ? el("span", { class: "psi-sk-quiet psi-sk-why" }, sub.why) : null),
				el("span", { class: "psi-sk-status" }, status.text));
		})));
		return section;
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
		return el("ul", { class: "psi-sk-rows", "aria-label": "Challenges" }, shown.map(challengeRow));
	}

	function challengeRow(c) {
		const last = lastAttempt(c);
		const mark = el("span", { class: "psi-sk-mark" });
		if (last) mark.append(renderTrail([last], { label: "Last result" }));
		else mark.append(el("span", { class: "psi-sk-quiet psi-sk-untried" }, "Not tried"));
		const sheet = el("div", { class: "psi-sk-sheet", hidden: true, id: `psi-sk-sheet-${c.id}` });
		const tryButton = el("button", { type: "button", "aria-expanded": "false", "aria-controls": sheet.id,
			onclick: () => toggle(c, row, tryButton, sheet) }, "Try");
		const row = el("li", { class: "psi-sk-row psi-sk-challenge", dataset: { id: c.id } },
			el("div", { class: "psi-sk-row-main" },
				el("span", { class: "psi-sk-prompt" }, promptPreview(c.prompt) || "Untitled challenge"),
				el("span", { class: "psi-sk-quiet psi-sk-format" }, formatWords(c))),
			mark, tryButton, sheet);
		return row;
	}

	async function toggle(c, row, button, sheet) {
		if (!sheet.hidden) { closeSheet(row, button, sheet); return; }
		for (const open of refs.list.querySelectorAll(".psi-sk-challenge.is-open")) {
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
					if (!text || /^Answered challenge\b/.test(text)) return;
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
		const rows = [...refs.list.querySelectorAll(".psi-sk-challenge")];
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
		drawStats(Boolean(detail.leveledUp));
		const row = c && refs.list?.querySelector(`.psi-sk-challenge[data-id="${CSS.escape(c.id)}"] .psi-sk-mark`);
		if (row) row.replaceChildren(renderTrail([attempt], { animateLast: true, label: "Last result" }));
	}
	cleanups.push(on("attempt", recordAttempt));

	void load();
	return {
		destroy() {
			disposed = true;
			for (const cleanup of cleanups) cleanup();
			for (const sheet of host.querySelectorAll(".psi-sk-sheet")) sheet._destroy?.();
			host.replaceChildren();
		},
	};
}
