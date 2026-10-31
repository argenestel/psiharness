import { api } from "./api.js";
import { el, emit, toast } from "./ui.js";
import { firstSentence } from "./bench.js";

/** Built-in first problem for a learner with no packs imported; graded locally. */
export const SAMPLE_CHALLENGE = Object.freeze({
	type: "challenge", id: "sample-len-psi", skill: "sample", kind: "predict", level: 1, format: "choice",
	prompt: "What does this Python print?\n\n```python\nprint(len('psi'))\n```",
	choices: ["2", "3", "psi", "TypeError"], hintsCount: 2,
});
const SAMPLE_KEY = { expected: "3", hints: ["`len` counts the items in a sequence.", "A string is a sequence of characters: p, s, i."] };

/** First unattempted challenge that answers without the code lab (the hero must be quick). */
export function pickHeroChallenge(challenges) {
	const open = (Array.isArray(challenges) ? challenges : [])
		.filter((c) => c && c.format !== "code" && !c.attempted && (c.lastOutcome ?? null) === null);
	const rank = (c) => ({ choice: 0, number: 1 })[c.format] ?? 2;
	return open.map((c, i) => [c, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)[0]?.[0] ?? null;
}

/** Order imported skills so the active one is tried first. */
export function heroSkillOrder(skills, active) {
	const list = (Array.isArray(skills) ? skills : []).map((s) => typeof s === "string" ? s : s?.skill).filter(Boolean);
	return active && list.includes(active) ? [active, ...list.filter((s) => s !== active)] : list;
}

/** Most recent session recap, or undefined. */
export function latestRecap(recaps) {
	return [...(Array.isArray(recaps) ? recaps : [])].filter((r) => r && r.date)
		.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
}

/** A grader for the built-in sample so it works before any pack is imported. */
function sampleApi() {
	return {
		get: async (path) => {
			const n = Number(new URL(path, "https://psi.invalid").searchParams.get("n")) || 0;
			return { hint: SAMPLE_KEY.hints[n] ?? null, n, total: SAMPLE_KEY.hints.length };
		},
		post: async (path, body) => {
			if (/\/lesson$/.test(path)) return { bonus: 5 };
			const ok = String(body?.answer ?? "").trim() === SAMPLE_KEY.expected;
			return {
				attempt: { id: `sample-${Date.now()}`, challengeId: SAMPLE_CHALLENGE.id, outcome: ok ? "success" : "fail", xp: ok ? 10 : 4 },
				progress: { xp: ok ? 10 : 4 }, leveledUp: false, badges: [],
			};
		},
	};
}

/** Mount the home page: a problem to try now (or Continue), the goal input, and skill packs. */
export function mountHome(root, { navigate }) {
	let disposed = false;
	const enc = encodeURIComponent;
	const hero = el("section", { class: "psi-home-hero", "aria-labelledby": "home-title" });
	const goal = goalForm(navigate);
	const packs = el("section", { class: "psi-home-section", "aria-labelledby": "home-packs" },
		el("h2", { id: "home-packs" }, "Skill packs"), el("p", { class: "muted" }, "Loading skill packs…"));
	root.replaceChildren(el("div", { class: "psi-home psi-view" }, hero, goal, packs));

	async function loadHero() {
		const [memory, state, skills] = await Promise.all([
			api.get("/api/memory").catch(() => ({})), api.get("/api/state").catch(() => ({})),
			api.get("/api/skills").catch(() => []),
		]);
		if (disposed) return;
		const recap = latestRecap(memory.recaps);
		if (recap) { renderContinue(recap); return; }
		for (const slug of heroSkillOrder(skills, state.activeSkill)) {
			const data = await api.get(`/api/skills/${enc(slug)}?unattempted=1`).catch(() => null);
			if (disposed) return;
			const challenge = pickHeroChallenge(data?.challenges);
			if (challenge) {
				await renderChallenge({ type: "challenge", ...challenge, skill: slug }, data.plan?.title || slug, api);
				return;
			}
		}
		await renderChallenge(SAMPLE_CHALLENGE, "", sampleApi());
	}

	async function renderChallenge(widget, skillTitle, client) {
		const after = el("div", { class: "psi-home-after", "aria-live": "polite" });
		const sheet = el("div", { class: "psi-home-sheet" });
		hero.replaceChildren(
			el("h1", { id: "home-title" }, "Try one now"),
			el("p", {}, skillTitle
				? `A problem from ${skillTitle}. Missing it still counts as practice.`
				: "Missing it still counts as practice."),
			sheet, after);
		const ctx = {
			api: {
				get: (path) => client.get(path),
				post: async (path, body) => {
					const result = await client.post(path, body);
					if (!disposed && /\/attempt$/.test(path)) afterAttempt(widget, result, after);
					return result;
				},
			},
			// The sheet's own "Next challenge" asks the chat for another; on home, load the next one here.
			send: async (message) => { if (!disposed && /^next challenge$/i.test(String(message).trim())) void loadHero(); },
			toast: (message) => toast(message),
		};
		try {
			const { renderToolWidget } = await import("./widgets.js");
			if (disposed) return;
			const node = renderToolWidget("psi_challenge", {}, { details: { widget } }, ctx);
			if (node) sheet.replaceChildren(node);
			else sheet.replaceChildren(el("p", { class: "muted" }, "This problem couldn't be shown. Start a skill below instead."));
		} catch {
			sheet.replaceChildren(el("p", { class: "muted" }, "This problem couldn't be shown. Start a skill below instead."));
		}
	}

	function afterAttempt(widget, result, after) {
		if (widget.skill !== "sample") { emit("psi:attempt", result); emit("psi:skills-changed"); }
		after.replaceChildren(widget.skill === "sample"
			? el("button", { type: "button", onclick: () => document.querySelector("#learning-goal")?.focus() }, "Start a skill")
			: el("a", { class: "button", href: `#/skills/${enc(widget.skill)}` }, "Open skill"));
	}

	function renderContinue(recap) {
		const label = recap.skill || recap.topic || "Your last session";
		const go = () => {
			const q = new URLSearchParams({ prompt: recap.next || "/practice" });
			if (recap.skill) q.set("skill", recap.skill);
			if (recap.topic) q.set("topic", recap.topic);
			navigate(`#/new?${q}`);
		};
		hero.className = "psi-home-section";
		hero.replaceChildren(
			el("h1", { id: "home-title" }, "Welcome back"),
			el("div", { class: "psi-continue" },
				el("div", {},
					el("h3", {}, label.replace(/[-_]+/g, " ")),
					recap.summary ? el("p", {}, firstSentence(recap.summary, 200)) : null,
					recap.next ? el("p", { class: "psi-continue-next" }, `Next: ${recap.next}`) : null),
				el("button", { type: "button", class: "primary", onclick: go }, "Continue")));
	}

	async function loadPacks() {
		let list;
		try { list = await api.get("/api/packs"); } catch (error) {
			if (!disposed) packs.lastElementChild.replaceWith(el("p", { class: "muted" },
				`Couldn't load skill packs. ${error.message}`));
			return;
		}
		if (disposed) return;
		const rows = el("ul", { class: "psi-rows" });
		for (const pack of list) rows.append(packRow(pack));
		packs.lastElementChild.replaceWith(list.length ? rows
			: el("p", { class: "muted" }, "No skill packs here yet. Start a skill above and psi will plan it with you."));
	}

	function packRow(pack) {
		const slug = pack.slug || pack.skill;
		const status = el("p", { class: "psi-row-status", role: "status" });
		const open = () => el("a", { class: "button psi-row-action", href: `#/skills/${enc(pack.skill || slug)}` }, "Open skill");
		const action = pack.imported ? open() : el("button", { type: "button", class: "psi-row-action", onclick: async () => {
			action.disabled = true;
			try {
				const result = await api.post(`/api/packs/${enc(slug)}/import`, {});
				if (disposed) return;
				emit("psi:skills-changed");
				navigate(`#/skills/${enc(result.skill || slug)}`);
			} catch (error) {
				if (!disposed) { status.textContent = `Couldn't add this skill. ${error.message}`; action.disabled = false; }
			}
		} }, "Add skill");
		const count = Number(pack.challenges) || 0;
		return el("li", {},
			el("div", {},
				el("h3", {}, pack.title || slug.replace(/[-_]+/g, " ")),
				pack.targetPerformance ? el("p", {}, firstSentence(pack.targetPerformance, 140)) : null,
				el("p", { class: "psi-row-meta" }, `${count} ${count === 1 ? "challenge" : "challenges"}`)),
			action, status);
	}

	void loadHero().catch(() => { if (!disposed) void renderChallenge(SAMPLE_CHALLENGE, "", sampleApi()); });
	void loadPacks();
	return { destroy() { disposed = true; root.replaceChildren(); } };
}

function goalForm(navigate) {
	const input = el("input", { id: "learning-goal", name: "goal", maxlength: "2000", autocomplete: "off",
		placeholder: "e.g. SQL joins, derivatives, Spanish for cafés" });
	const form = el("form", { class: "psi-goal" },
		el("label", { for: "learning-goal" }, "What do you want to get good at?"),
		input,
		el("div", { class: "psi-goal-actions" },
			el("button", { type: "submit", class: "primary", dataset: { mode: "skill" } }, "Start a skill"),
			el("button", { type: "submit", dataset: { mode: "concept" } }, "Explain a concept")));
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const text = input.value.trim();
		if (!text) { input.focus(); return; }
		const command = event.submitter?.dataset.mode === "concept" ? "/learn" : "/skill";
		navigate(`#/new?prompt=${encodeURIComponent(`${command} ${text}`)}`);
	});
	return form;
}
