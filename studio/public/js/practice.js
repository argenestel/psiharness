import { api } from "./api.js";
import { formatBars } from "../app.js";

/** Mount a skill dashboard and reuse the chat's interactive challenge renderer. */
export function mountPractice(el, { skill, navigate }) {
	let disposed = false;
	const cleanups = [];
	const enc = encodeURIComponent;
	const make = (tag, text = "", className = "") => {
		const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
	};
	el.replaceChildren(make("p", "Opening your practice space…", "empty"));
	const openTutor = (message) => navigate(`#/new?${new URLSearchParams({ skill: skill || "", prompt: message })}`);
	const load = async () => {
		try {
			if (!skill) {
				el.replaceChildren(make("h1", "Choose a skill to practice"));
				const skills = await api.get("/api/skills");
				if (disposed) return;
				for (const item of skills) {
					const slug = typeof item === "string" ? item : item.skill;
					const a = make("a", item.title || slug, "psi-card"); a.href = `#/skills/${enc(slug)}`; el.append(a);
				}
				return;
			}
			const data = await api.get(`/api/skills/${enc(skill)}?unattempted=1`);
			if (disposed) return;
			const plan = data.plan || {}, progress = data.progress || {}, bars = formatBars(progress);
			el.replaceChildren();
			const root = make("section", "", "psi-practice"); el.append(root);
			root.append(make("span", "YOUR FIRST 20 HOURS", "eyebrow"), make("h1", plan.title || skill));
			root.append(make("p", plan.targetPerformance || "Build a little more confidence with every attempt.", "psi-target"));
			const tutor = make("button", "Practice with tutor →", "primary"); tutor.onclick = () => openTutor("/practice");
			root.append(tutor);
			const stats = make("div", "", "psi-practice-stats psi-section"); root.append(stats);
			const metric = (title, value, percent) => {
				const card = make("div", "", "psi-card"); card.append(make("strong", value), make("span", title));
				if (percent !== undefined) {
					const bar = make("progress"); bar.max = 100; bar.value = percent; bar.setAttribute("aria-label", title); card.append(bar);
				}
				stats.append(card);
			};
			metric("Experience", `${progress.xp || 0} XP`);
			metric("Level", String(bars.level), bars.levelPercent);
			metric("Day streak", `🔥 ${progress.streakDays || 0}`);
			metric("Hours practiced", `${bars.hours}h`, bars.hoursPercent);
			const badges = make("div", "", "psi-chips psi-badges");
			for (const badge of progress.badges || []) badges.append(make("span", `✦ ${badge.replaceAll("-", " ")}`, "badge"));
			if (!progress.badges?.length) badges.append(make("p", "Your first badge is one attempt away.", "muted"));
			root.append(badges);
			const map = make("section", "", "psi-card psi-section"); map.append(make("h2", "Your skill, broken into small steps"));
			const list = make("ol", "", "psi-subskills"); map.append(list); root.append(map);
			const subskills = plan.subskills || [];
			for (const sub of [...subskills].sort((a, b) => a.priority - b.priority)) {
				const row = make("li");
				row.append(make("span", `P${sub.priority} · ${sub.status}`, "badge"), make("h3", sub.title), make("p", sub.why));
				const prereqs = (sub.prerequisites || []).map((id) => subskills.find((s) => s.id === id)?.title || id);
				row.append(make("small", `Prerequisites: ${prereqs.join(", ") || "None — start here"}`, "muted"));
				list.append(row);
			}
			if (!subskills.length) map.append(make("p", "Ask your tutor to deconstruct this skill into a practice plan."));
			const challenges = make("section", "", "psi-section"); challenges.append(make("h2", "Give it a try"));
			challenges.append(make("p", "Mistakes count. You earn XP for trying, and more for reflecting on what you learned."));
			root.append(challenges);
			const pending = (data.challenges || []).filter((c) => !c.attempted && !c.attemptedAt);
			if (!pending.length) { challenges.append(make("p", "No open challenges. Practice with your tutor to get your next one.", "psi-card")); return; }
			try {
				const { renderToolWidget } = await import("./widgets.js");
				if (disposed) return;
				for (const challenge of pending) {
					// Answer keys never enter widget arguments, results, fallback text, or tutor prompts.
					const { expected, acceptable, ...safe } = challenge;
					const card = make("div", "", "psi-challenge-host"); challenges.append(card);
					const context = { api, skill, send: async (message) => openTutor(String(message)),
						toast: (message) => { if (!disposed) notice.textContent = String(message); } };
					const notice = make("p", "", "muted"); notice.setAttribute("role", "status");
					try {
						const widget = await renderToolWidget("psi_challenge", {},
							{ details: { widget: { ...safe, hintsCount: safe.hintsCount ?? safe.hints?.length ?? 0, type: "challenge" } } }, context);
						if (disposed) { widget?.destroy?.(); return; }
						if (widget instanceof Node) card.append(widget);
						else if (widget?.el instanceof Node) { card.append(widget.el); cleanups.push(() => widget.destroy?.()); }
						else throw new Error("Challenge widget is unavailable");
					} catch (error) {
						if (disposed) return;
						card.append(make("p", safe.prompt), make("p", error.message, "muted"));
						const ask = make("button", "Try with tutor"); ask.onclick = () => openTutor(safe.prompt); card.append(ask);
					}
					card.append(notice);
				}
			} catch (error) { if (!disposed) challenges.append(make("p", `Challenge widgets could not load. ${error.message}`, "psi-card")); }
		} catch (error) {
			if (!disposed) {
				el.replaceChildren(make("h1", "Could not open this skill"), make("p", error.message));
				const retry = make("button", "Try again"); retry.onclick = load; el.append(retry);
			}
		}
	};
	void load();
	return { destroy() { disposed = true; for (const cleanup of cleanups) cleanup(); el.replaceChildren(); } };
}
