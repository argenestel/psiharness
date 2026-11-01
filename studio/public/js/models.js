/**
 * Model choice for psi web: a quiet "Model: grok-4.6" control that opens a searchable list grouped by provider.
 *
 * API
 * - `loadModels({ refresh? })` → Promise<{ default, models: [{ id, provider, name, context?, reasoning? }] }>
 *   (GET /api/models, cached for the page's lifetime; `?fixture=1` serves a fixture when the route is missing).
 * - `getPreferredModel()` → Promise<string | undefined>: localStorage "psi-model", else the server default.
 * - `setPreferredModel(id)` remembers the choice in this browser.
 * - `modelPicker({ value?, onChange?, chatId?, placement? = "up" })` → HTMLElement with `.setModel(id)`.
 *   With `chatId`, choosing calls POST /api/chat/:id/model and reports failures with ui.toast; otherwise only
 *   `onChange(id)` runs. Either way the choice becomes the preferred model.
 * - Pure helpers (Node-tested): `shortModelName`, `contextLabel`, `groupModels`, `filterModels`, `normalizeModels`.
 */
import { api } from "./api.js";
import { el, toast } from "./ui.js";

const STORAGE_KEY = "psi-model";
const why = (error) => String(error?.message ?? error).replace(/\.$/, "");

/** The part after the provider (and any account/router prefix): "xai/grok-4.6" → "grok-4.6". */
export function shortModelName(id) {
	const parts = String(id ?? "").split("/").filter(Boolean);
	return parts.at(-1) ?? "";
}

/** Context window in plain words: 262144 → "262K context", 1000000 → "1M context"; "" when unknown. */
export function contextLabel(context) {
	if (typeof context === "string" && context.trim()) return `${context.trim()} context`;
	const n = Number(context);
	if (!Number.isFinite(n) || n <= 0) return "";
	const round = (value) => String(Math.round(value * 10) / 10);
	if (n >= 1e6) return `${round(n / 1e6)}M context`;
	if (n >= 1e3) return `${Math.round(n / 1e3)}K context`;
	return `${n} context`;
}

/** Accept `{ default, models }` or a bare array; fill provider/name from the id when missing. */
export function normalizeModels(data) {
	const list = Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
	const models = list.filter((m) => m && typeof m.id === "string" && m.id).map((m) => {
		const slash = m.id.indexOf("/");
		return { ...m, provider: m.provider || (slash > 0 ? m.id.slice(0, slash) : "other"),
			name: m.name || (slash > 0 ? m.id.slice(slash + 1) : m.id) };
	});
	return { default: typeof data?.default === "string" ? data.default : "", models,
		...(data?.error ? { error: String(data.error) } : {}) };
}

/** Group by provider in first-seen order, with the provider of `first` (the current model) leading. */
export function groupModels(models, first) {
	const groups = new Map();
	for (const model of Array.isArray(models) ? models : []) {
		const provider = model.provider || "other";
		if (!groups.has(provider)) groups.set(provider, []);
		groups.get(provider).push(model);
	}
	const lead = first ? String(first).split("/")[0] : "";
	return [...groups].map(([provider, items]) => ({ provider, models: items }))
		.sort((a, b) => /** @type {number} */ (/** @type {unknown} */ (b.provider === lead))
			- /** @type {number} */ (/** @type {unknown} */ (a.provider === lead)));
}

/** Every whitespace-separated term must appear in the id, name or provider (case-insensitive). */
export function filterModels(models, query) {
	const terms = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	const list = Array.isArray(models) ? models : [];
	if (!terms.length) return list;
	return list.filter((m) => {
		const hay = `${m.id} ${m.name ?? ""} ${m.provider ?? ""}`.toLowerCase();
		return terms.every((term) => hay.includes(term));
	});
}

/** True when the page was opened with ?fixture=1 (in the search or the hash query). */
export function fixtureMode() {
	if (typeof location === "undefined") return false;
	const hashQuery = location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?") + 1) : "";
	const flag = (query) => new URLSearchParams(query).get("fixture") === "1";
	return flag(location.search) || flag(hashQuery);
}

const FIXTURE_MODELS = {
	default: "xai/grok-4.6",
	models: [
		{ id: "xai/grok-4.6", provider: "xai", name: "grok-4.6", context: 2000000, reasoning: true },
		{ id: "xai/grok-4.6-fast", provider: "xai", name: "grok-4.6-fast", context: 2000000, reasoning: false },
		{ id: "anthropic/claude-opus-5-5", provider: "anthropic", name: "claude-opus-5-5", context: 1000000 },
		{ id: "openai/gpt-6.1-sol", provider: "openai", name: "gpt-6.1-sol", context: 400000, reasoning: true },
		{ id: "fireworks/accounts/fireworks/models/kimi-k3", provider: "fireworks",
			name: "accounts/fireworks/models/kimi-k3", context: 1000000 },
	],
};

let cached;
/** GET /api/models once per page (a failed load is retried on the next call). */
export function loadModels({ refresh = false } = {}) {
	if (!cached || refresh) {
		cached = api.get("/api/models").then(normalizeModels).catch((error) => {
			cached = undefined;
			if (fixtureMode()) return normalizeModels(FIXTURE_MODELS);
			throw error;
		});
	}
	return cached;
}

function stored() {
	try { return localStorage.getItem(STORAGE_KEY) || undefined; } catch { return undefined; }
}

/** The learner's last choice in this browser, else the server default (undefined when neither is known). */
export async function getPreferredModel() {
	const mine = stored();
	if (mine) return mine;
	try { return (await loadModels()).default || undefined; } catch { return undefined; }
}

/** Remember a model choice in this browser. */
export function setPreferredModel(id) {
	try {
		if (id) localStorage.setItem(STORAGE_KEY, String(id));
		else localStorage.removeItem(STORAGE_KEY);
	} catch { /* Storage can be blocked; the choice then lasts for this page only. */ }
}

let pickerCount = 0;
/** The composer/New chat model control.
 * @param {{value?: string, onChange?: (id: string) => void, chatId?: string, placement?: string}} [options] */
export function modelPicker({ value, onChange, chatId, placement = "up" } = {}) {
	const uid = `psi-model-${++pickerCount}`;
	let current = value || "";
	let models = [], open = false, active = 0, visible = [], busy = false;

	const label = el("span", { class: "psi-model-label" });
	const trigger = el("button", { type: "button", class: "psi-model-button", "aria-haspopup": "dialog",
		"aria-expanded": "false", "aria-controls": `${uid}-pop` }, label);
	const search = el("input", { type: "search", class: "psi-model-search", placeholder: "Search models",
		autocomplete: "off", spellcheck: "false", role: "combobox", "aria-expanded": "true",
		"aria-controls": `${uid}-list`, "aria-autocomplete": "list", "aria-label": "Search models" });
	const list = el("ul", { class: "psi-model-list", id: `${uid}-list`, role: "listbox", "aria-label": "Models" });
	const note = el("p", { class: "psi-model-note", role: "status" });
	const heading = el("h2", { class: "psi-model-heading", id: `${uid}-title` }, "Choose a model");
	const pop = el("div", { class: "psi-model-pop", id: `${uid}-pop`, role: "dialog", "aria-modal": "false",
		"aria-labelledby": `${uid}-title`, hidden: true, dataset: { placement } }, heading, search, list, note);
	const shade = el("div", { class: "psi-model-shade", hidden: true, onclick: () => close() });
	const root = el("div", { class: "psi-model" }, trigger, shade, pop);

	function setLabel() {
		label.textContent = current ? `Model: ${shortModelName(current)}` : "Model: default";
		trigger.title = current || "The server's default model";
		trigger.setAttribute("aria-label", `Model: ${current || "default"}. Change model`);
	}
	setLabel();
	if (!current) getPreferredModel().then((id) => { if (id && !current) { current = id; setLabel(); } });

	function renderList() {
		visible = filterModels(models, search.value);
		active = Math.max(0, Math.min(active, visible.length - 1));
		const rows = [];
		for (const group of groupModels(visible, current)) {
			const gid = `${uid}-g-${rows.length}`;
			rows.push(el("li", { class: "psi-model-group", role: "group", "aria-labelledby": gid },
				el("p", { class: "psi-model-provider", id: gid }, group.provider),
				el("ul", { role: "presentation" }, group.models.map((m) => {
					const index = visible.indexOf(m);
					const context = contextLabel(m.context);
					return el("li", { id: `${uid}-o-${index}`, role: "option",
						class: `psi-model-option${index === active ? " is-active" : ""}`,
						"aria-selected": String(m.id === current), dataset: { index: String(index) },
						onmousedown: (event) => event.preventDefault(), onclick: () => choose(m.id),
						onmousemove: () => { if (active !== index) { active = index; markActive(); } } },
					el("span", { class: "psi-model-check", "aria-hidden": "true" }),
					el("span", { class: "psi-model-name" }, shortModelName(m.id)),
					context ? el("span", { class: "psi-model-context" }, context) : null);
				}))));
		}
		list.replaceChildren(...rows);
		note.textContent = !models.length ? note.textContent : visible.length ? ""
			: `No models match “${search.value.trim()}”.`;
		markActive();
	}
	function markActive() {
		for (const option of list.querySelectorAll("[role=option]")) {
			const on = Number(option.dataset.index) === active;
			option.classList.toggle("is-active", on);
			if (on) option.scrollIntoView?.({ block: "nearest" });
		}
		if (visible.length) search.setAttribute("aria-activedescendant", `${uid}-o-${active}`);
		else search.removeAttribute("aria-activedescendant");
	}

	async function show() {
		if (open) return;
		open = true; pop.hidden = false; shade.hidden = false;
		trigger.setAttribute("aria-expanded", "true"); root.classList.add("is-open");
		search.value = ""; note.textContent = "Loading models…"; list.replaceChildren();
		search.focus();
		document.addEventListener("pointerdown", outside, true);
		try {
			const data = await loadModels();
			if (!open) return;
			models = data.models;
			if (!current && data.default) { current = data.default; setLabel(); }
			if (current && !models.some((m) => m.id === current)) {
				const slash = current.indexOf("/");
				const provider = slash > 0 ? current.slice(0, slash) : "other";
				models = [{ id: current, provider, name: current }, ...models];
			}
			note.textContent = models.length ? "" : "No models are available. Check that pi is signed in, then retry.";
			const ordered = groupModels(models, current).flatMap((g) => g.models);
			models = ordered; active = Math.max(0, ordered.findIndex((m) => m.id === current));
			renderList();
		} catch (error) {
			if (open) note.textContent = `Couldn't load the model list. ${why(error)}.`;
		}
	}
	function close(focus = true) {
		if (!open) return;
		open = false; pop.hidden = true; shade.hidden = true;
		trigger.setAttribute("aria-expanded", "false"); root.classList.remove("is-open");
		document.removeEventListener("pointerdown", outside, true);
		if (focus) trigger.focus();
	}
	function outside(event) { if (!root.contains(event.target)) close(false); }

	async function choose(id) {
		if (busy) return;
		if (id === current) { close(); return; }
		if (chatId) {
			busy = true; root.classList.add("is-busy"); label.textContent = `Switching to ${shortModelName(id)}…`;
			try {
				await api.post(`/api/chat/${encodeURIComponent(chatId)}/model`, { model: id });
			} catch (error) {
				busy = false; root.classList.remove("is-busy"); setLabel();
				toast(`Couldn't switch to ${shortModelName(id)}. ${why(error)}.`, { kind: "error" });
				return;
			}
			busy = false; root.classList.remove("is-busy");
		}
		current = id; setLabel(); setPreferredModel(id);
		close();
		onChange?.(id);
	}

	trigger.addEventListener("click", () => { if (open) close(); else void show(); });
	search.addEventListener("input", () => { active = 0; renderList(); });
	pop.addEventListener("keydown", (event) => {
		if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
		if (!visible.length) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			active = (active + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length; markActive();
		} else if ((event.key === "Home" || event.key === "End") && event.target !== search) {
			event.preventDefault(); active = event.key === "Home" ? 0 : visible.length - 1; markActive();
		} else if (event.key === "Enter") { event.preventDefault(); void choose(visible[active].id); }
		else if (event.key === "Tab") { event.preventDefault(); search.focus(); }
	});

	/** Reflect a model change that came from elsewhere (a psi_model_switched record, the chat's state). */
	root.setModel = (id) => { if (id && id !== current) { current = id; setLabel(); if (open) renderList(); } };
	root.close = () => close(false);
	return root;
}
