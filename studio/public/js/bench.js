import { api } from "./api.js";
import { el, on, formatLevel, streakLabel, hoursLabel } from "./ui.js";

/** First sentence of a target performance, clipped to `max` characters. */
export function firstSentence(text, max = 160) {
	const value = String(text ?? "").replace(/\s+/g, " ").trim();
	if (!value) return "";
	const match = value.match(/^.+?[.!?](?=\s|$)/);
	let sentence = (match ? match[0] : value).replace(/[;:,]\s*$/, "");
	if (sentence.length > max) {
		const cut = sentence.slice(0, max - 1);
		sentence = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[\s,;:]+$/, "")}…`;
	}
	return sentence;
}

/** The subskill to work on next: lowest priority number, prerequisites solid, not yet solid itself. */
export function nextSubskill(plan) {
	const subskills = Array.isArray(plan?.subskills) ? plan.subskills : [];
	const solid = new Set(subskills.filter((s) => s.status === "solid").map((s) => s.id));
	return subskills
		.filter((s) => s.status !== "solid" && (s.prerequisites ?? []).every((p) => solid.has(p)))
		.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
}

/** Attempts endpoint returns newest first; the trail wants oldest → newest with only the fields it draws. */
export function trailAttempts(list) {
	if (!Array.isArray(list)) return [];
	return [...list].reverse().filter((a) => a && typeof a.outcome === "string")
		.map((a) => ({ outcome: a.outcome, at: a.at, xp: Number(a.xp) || 0, ...(a.lesson ? { lesson: a.lesson } : {}) }));
}

/** Plain-words caption under the trail, e.g. "12 attempts, 4 missed". */
export function trailCaption(attempts) {
	const n = attempts.length;
	if (!n) return "";
	const missed = attempts.filter((a) => a.outcome === "fail").length;
	return `${n} ${n === 1 ? "attempt" : "attempts"}${missed ? `, ${missed} missed` : ""}`;
}

let trailModule;
async function loadTrail() {
	trailModule ??= import("./trail.js").catch(() => null);
	return trailModule;
}

/**
 * Mount the progress bench: active skill, target, next subskill, attempt trail, level, streak and hours.
 * `skill` pins a skill; otherwise the active skill from /api/state is used. `onChange(hasSkill)` reports
 * whether there is anything to show, so the shell can hide the column.
 */
export function mountBench(root, { skill, onChange, onClose } = {}) {
	let disposed = false, token = 0, lastAttemptId, current = skill;
	const enc = encodeURIComponent;

	async function load({ animate = false, leveledUp = false } = {}) {
		const mine = ++token;
		try {
			const state = skill ? {} : await api.get("/api/state").catch(() => ({}));
			const active = skill || state.activeSkill;
			if (!active) {
				if (mine === token && !disposed) { current = undefined; root.replaceChildren(); onChange?.(false); }
				return;
			}
			const [data, attempts] = await Promise.all([
				api.get(`/api/skills/${enc(active)}`),
				api.get(`/api/skills/${enc(active)}/attempts?limit=40`).catch(() => []),
			]);
			if (mine !== token || disposed) return;
			current = active;
			await render(active, data, trailAttempts(attempts), { animate, leveledUp });
			if (mine === token && !disposed) onChange?.(true);
		} catch {
			if (mine === token && !disposed) { root.replaceChildren(); onChange?.(false); }
		}
	}

	async function render(slug, data, attempts, { animate, leveledUp }) {
		const plan = data.plan ?? {}, progress = data.progress ?? {};
		const level = formatLevel(progress.xp);
		const next = nextSubskill(plan);
		const target = firstSentence(plan.targetPerformance);
		const close = el("button", { type: "button", class: "quiet psi-bench-close", onclick: () => onClose?.() }, "Close");

		let trail = null;
		const mod = attempts.length ? await loadTrail() : null;
		if (mod?.renderTrail) {
			try { trail = mod.renderTrail(attempts, { context: "bench", animateLast: animate }); } catch { trail = null; }
		}
		const levelNumber = el("strong", { class: leveledUp ? "is-level-up" : "" }, level.label);
		const streak = streakLabel(progress.streakDays);
		const hours = Number(progress.minutesLogged) / 60;
		const hoursPct = Math.round(Math.max(0, Math.min(1, (Number.isFinite(hours) ? hours : 0) / 20)) * 100);

		root.replaceChildren(el("div", { class: "psi-bench-inner" },
			el("header", {},
				el("div", { class: "psi-bench-head" },
					el("h2", {}, el("a", { href: `#/skills/${enc(slug)}` }, plan.title || slug.replace(/[-_]+/g, " "))),
					close),
				target ? el("p", { class: "psi-bench-target" }, target) : null),
			next ? el("section", { class: "psi-bench-block" },
				el("h3", {}, "Next up"), el("p", { class: "psi-bench-next" }, next.title)) : null,
			el("section", { class: "psi-bench-block", "aria-label": "Attempt trail" },
				el("h3", {}, "Your attempts"),
				attempts.length ? trail : null,
				el("p", { class: "psi-bench-caption" },
					attempts.length ? trailCaption(attempts) : "No attempts yet. Misses count too.")),
			el("section", { class: "psi-bench-facts", "aria-label": "Progress" },
				el("div", { class: "psi-bench-block" },
					el("div", { class: "psi-bench-level" }, levelNumber, el("span", {}, level.toNextLabel)),
					meter(level.percent, `${level.label}, ${level.toNextLabel}`)),
				el("div", { class: "psi-bench-fact" },
					el("span", {}, hoursLabel(progress.minutesLogged)),
					meter(hoursPct, hoursLabel(progress.minutesLogged), true)),
				el("p", {}, streak || "Practice today to start a streak.")),
		));
	}

	const offs = [
		on("psi:attempt", (detail) => {
			const id = detail?.attempt?.id ?? detail?.id;
			if (id && id === lastAttemptId) return;
			lastAttemptId = id;
			const from = detail?.attempt?.skill ?? detail?.skill;
			const forOther = Boolean(skill && from && from !== skill);
			if (!forOther) void load({ animate: true, leveledUp: Boolean(detail?.leveledUp) });
		}),
		on("psi:lesson", () => { void load(); }),
		on("psi:status", () => { void load(); }),
		on("psi:skills-changed", () => { void load(); }),
	];
	void load();
	return {
		refresh: () => load(),
		get skill() { return current; },
		destroy() { disposed = true; offs.forEach((off) => off()); root.replaceChildren(); },
	};
}

function meter(percent, label, thin = false) {
	const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
	return el("progress", { class: `psi-meter${thin ? " is-thin" : ""}`, max: "100", value: String(value), "aria-label": label },
		`${value}%`);
}
