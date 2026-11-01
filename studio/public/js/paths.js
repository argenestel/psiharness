/**
 * Learning paths (#/paths, #/paths/:id): ordered routes through the knowledge graph toward a goal.
 *
 * API
 * - `mountPaths(el, { navigate, id? })` → `{ destroy() }`. Without `id`: the list of paths and the New path form.
 *   With `id`: the path page (steps checklist, Continue this path, Edit steps, rename, delete).
 * - Pure helpers (Node-tested): `isDone`, `pathProgress`, `moveStep`, `removeStep`, `addStep`, `searchNodes`,
 *   `kindLabel`, `statusLabel`, `stepHref`, `continuePrompt`, `graphHash`, `chatContext`.
 *
 * Endpoints: GET /api/graph, GET/POST /api/paths, GET/PUT/DELETE /api/paths/:id. With `?fixture=1` the view falls
 * back to an in-memory fixture when those routes are missing.
 */
import { el, emit, relativeTime, toast } from "./ui.js";
import { fixtureMode } from "./models.js";

const enc = encodeURIComponent;
const why = (error) => String(error?.message ?? error).replace(/\.$/, "");

/** A step counts as done when its node is solid (subskill) or mastered (concept). */
export function isDone(node) {
	return node?.status === "solid" || node?.status === "mastered";
}

/** Done/total for a path's steps, the first unfinished step, and the "4 of 9 steps done" label. */
export function pathProgress(path, byId = new Map()) {
	const steps = Array.isArray(path?.steps) ? path.steps : [];
	const done = steps.filter((id) => isDone(byId.get(id))).length;
	const total = steps.length;
	const nextId = steps.find((id) => !isDone(byId.get(id)));
	const label = !total ? "No steps yet" : done === total ? `All ${total} ${total === 1 ? "step" : "steps"} done`
		: `${done} of ${total} ${total === 1 ? "step" : "steps"} done`;
	return { done, total, nextId, percent: total ? Math.round(done / total * 100) : 0, label };
}

/** A copy of `steps` with the item at `from` moved to `to` (indexes are clamped). */
export function moveStep(steps, from, to) {
	const list = [...(Array.isArray(steps) ? steps : [])];
	if (from < 0 || from >= list.length) return list;
	const target = Math.max(0, Math.min(list.length - 1, to));
	const [item] = list.splice(from, 1);
	list.splice(target, 0, item);
	return list;
}

/** A copy of `steps` without the item at `index`. */
export function removeStep(steps, index) {
	return (Array.isArray(steps) ? steps : []).filter((_, i) => i !== index);
}

/** A copy of `steps` with `id` appended (or inserted at `at`); a step already on the path is not repeated. */
export function addStep(steps, id, at) {
	const list = Array.isArray(steps) ? [...steps] : [];
	if (!id || list.includes(id)) return list;
	list.splice(at === undefined ? list.length : Math.max(0, Math.min(list.length, at)), 0, id);
	return list;
}

/**
 * Rank graph nodes for a search box: title prefix, then a word in the title starting with a term, then a match
 * anywhere in title/summary/tags. Every term must match somewhere. Notes are left out unless `notes` is set.
 */
export function searchNodes(nodes, query, { exclude = [], limit = 8, notes = false } = {}) {
	const terms = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return [];
	const skip = new Set(exclude);
	const scored = [];
	for (const node of Array.isArray(nodes) ? nodes : []) {
		if (!node || skip.has(node.id) || (!notes && node.kind === "note")) continue;
		const title = String(node.title ?? "").toLowerCase();
		const rest = `${node.summary ?? ""} ${(node.tags ?? []).join(" ")} ${node.id}`.toLowerCase();
		if (!terms.every((term) => title.includes(term) || rest.includes(term))) continue;
		const words = title.split(/[^\p{L}\p{N}]+/u);
		let score = 0;
		if (title.startsWith(terms.join(" "))) score += 100;
		for (const term of terms) {
			if (words.some((word) => word.startsWith(term))) score += 20;
			else if (title.includes(term)) score += 10;
			else score += 1;
		}
		if (node.kind === "skill" || node.kind === "topic") score += 2;
		scored.push([score, node]);
	}
	return scored.sort((a, b) => b[0] - a[0] || String(a[1].title).localeCompare(String(b[1].title)))
		.slice(0, limit).map(([, node]) => node);
}

/** What a node is, in words; `parent` is the containing skill/topic title when known. */
export function kindLabel(node, parent) {
	switch (node?.kind) {
		case "skill": return "Skill";
		case "subskill": return parent ? `Part of ${parent}` : "Part of a skill";
		case "topic": return "Topic";
		case "concept": return parent ? `Concept in ${parent}` : "Concept";
		case "note": return "Note";
		default: return node ? "Step" : "Missing from your graph";
	}
}

/** A node's progress status in words. */
export function statusLabel(node) {
	if (!node) return "Removed";
	return ({ solid: "Done", mastered: "Mastered", next: "Up next", practising: "Practising", locked: "Locked",
		new: "Not started" })[node.status] ?? "Not started";
}

/** Where a step links: the node's own page when it has one, else its place on the graph. */
export function stepHref(node, id) {
	return node?.href || `#/graph/${enc(node?.id ?? id)}`;
}

/** The tutor prompt behind "Continue this path". */
export function continuePrompt(path, byId = new Map()) {
	const { nextId } = pathProgress(path, byId);
	const next = nextId ? byId.get(nextId)?.title ?? nextId : "";
	return next ? `Continue my learning path ${path.title}: next step ${next}`
		: `Continue my learning path ${path.title}: every step is done. What should I do next?`;
}

/** "See it on the graph": the first unfinished step (else the last step) with this path's overlay selected. */
export function graphHash(path, byId = new Map()) {
	const { nextId } = pathProgress(path, byId);
	const focus = nextId ?? path?.steps?.at(-1) ?? path?.targetId;
	return `${focus ? `#/graph/${enc(focus)}` : "#/graph"}?path=${enc(path?.id ?? "")}`;
}

/** Skill or topic slug for a node id ("subskill:sql-lab/joins" → { skill: "sql-lab" }) so the chat opens in context. */
export function chatContext(id) {
	const match = /^(skill|subskill|topic|concept):([^/]+)/.exec(String(id ?? ""));
	if (!match) return {};
	return match[1] === "skill" || match[1] === "subskill" ? { skill: match[2] } : { topic: match[2] };
}

/** Hash for a new tutor chat with a seeded prompt (and skill/topic context when known). */
export function newChatHash(prompt, context = {}) {
	const q = new URLSearchParams({ prompt });
	if (context.skill) q.set("skill", context.skill);
	if (context.topic) q.set("topic", context.topic);
	return `#/new?${q}`;
}

/* ---------- Data ---------- */

async function request(method, path, body) {
	const response = await fetch(path, {
		method, headers: { "X-Psi": "1", "Content-Type": "application/json", Accept: "application/json" },
		...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
	});
	let data;
	try { data = await response.json(); } catch { data = {}; }
	if (!response.ok) {
		const error = /** @type {Error & {status?: number}} */
			(new Error(data.message || data.error || `Request failed (${response.status})`));
		error.status = response.status;
		throw error;
	}
	return data;
}
const live = {
	get: (path) => request("GET", path), post: (path, body) => request("POST", path, body),
	put: (path, body) => request("PUT", path, body), del: (path) => request("DELETE", path),
};

/** In-memory graph + paths for ?fixture=1 while the backend routes are missing. */
function fixtureClient() {
	const node = (id, kind, title, status, extra = {}) => ({ id, kind, title, status, ...extra });
	const nodes = [
		node("skill:sql-lab", "skill", "SQL lab", "practising", { href: "#/skills/sql-lab" }),
		node("subskill:sql-lab/select", "subskill", "SELECT and WHERE", "solid"),
		node("subskill:sql-lab/order", "subskill", "Sorting and limits", "solid"),
		node("subskill:sql-lab/aggregate", "subskill", "GROUP BY and aggregates", "practising"),
		node("subskill:sql-lab/joins", "subskill", "Inner and outer joins", "next"),
		node("subskill:sql-lab/subqueries", "subskill", "Subqueries", "locked"),
		node("topic:fourier-transform", "topic", "Fourier transform", "new"),
		node("concept:fourier-transform/orthogonality", "concept", "Orthogonality", "mastered"),
	];
	const edges = [
		...nodes.filter((n) => n.kind === "subskill")
			.map((n) => ({ from: "skill:sql-lab", to: n.id, kind: "contains" })),
		{ from: "topic:fourier-transform", to: "concept:fourier-transform/orthogonality", kind: "contains" },
	];
	const now = new Date().toISOString();
	const paths = new Map([["path-fixture", { id: "path-fixture", title: "Join tables like an analyst",
		goal: "Answer business questions that need data from several tables.", source: "learner", createdAt: now,
		updatedAt: now, steps: ["subskill:sql-lab/select", "subskill:sql-lab/order", "subskill:sql-lab/aggregate",
			"subskill:sql-lab/joins", "subskill:sql-lab/subqueries"] }]]);
	const save = (draft, id = `path-${Date.now().toString(36)}`) => {
		const steps = draft.steps ?? (draft.targetId ? ["subskill:sql-lab/select", draft.targetId] : []);
		const value = { source: "learner", createdAt: new Date().toISOString(), ...paths.get(id), ...draft, id, steps,
			updatedAt: new Date().toISOString() };
		paths.set(id, value); return value;
	};
	return {
		get: async (path) => {
			if (path === "/api/graph") return { nodes, edges, builtAt: now };
			if (path === "/api/paths") return [...paths.values()];
			const found = paths.get(decodeURIComponent(path.split("/").pop()));
			if (!found) throw Object.assign(new Error("Path not found"), { status: 404 });
			return found;
		},
		post: async (_path, body) => save(body),
		put: async (path, body) => save(body, decodeURIComponent(path.split("/").pop())),
		del: async (path) => { paths.delete(decodeURIComponent(path.split("/").pop())); return { ok: true }; },
	};
}

let fixture;
/** Use the live API; in fixture mode, switch to the fixture once a route turns out to be missing. */
async function call(method, path, body) {
	if (fixture) return fixture[method](path, body);
	try { return await live[method](path, body); } catch (error) {
		// A missing route (or no server) switches to the fixture; a missing path is a real answer.
		const missingRoute = error.status === undefined
			|| (error.status === 404 && !/^path not found/i.test(error.message));
		if (fixtureMode() && missingRoute) {
			fixture = fixtureClient();
			return fixture[method](path, body);
		}
		throw error;
	}
}

function indexGraph(graph) {
	const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
	const parent = new Map();
	for (const edge of graph?.edges ?? []) {
		// "Fourier Transform: seeing the rotating ingredients…" reads as "Fourier Transform" in a step's kind line.
		if (edge.kind === "contains" && byId.has(edge.from) && !parent.has(edge.to)) {
			parent.set(edge.to, String(byId.get(edge.from).title ?? "").split(/:\s/)[0]);
		}
	}
	return { nodes: graph?.nodes ?? [], byId, parent };
}

/* ---------- View ---------- */

/** Mount the paths list (no id) or one path page.
 * @param {HTMLElement} root
 * @param {{navigate?: (hash: string) => void, id?: string}} [options]
 */
export function mountPaths(root, { navigate, id } = {}) {
	let disposed = false;
	const go = (hash) => (navigate ? navigate(hash) : (location.hash = hash));
	const view = el("div", { class: "psi-view psi-pa" }, el("p", { class: "muted" }, "Loading your paths…"));
	root.replaceChildren(view);
	let graph = indexGraph();

	async function loadGraph() {
		try { graph = indexGraph(await call("get", "/api/graph")); } catch { graph = indexGraph(); }
	}

	function failure(error, retry) {
		view.replaceChildren(el("div", { class: "empty", role: "alert" },
			el("h2", {}, id ? "Couldn't open this path" : "Couldn't load your paths"),
			el("p", {}, `${why(error)}. Check that psi web is running, then try again.`),
			el("button", { type: "button", onclick: retry }, "Try again"),
			id ? el("a", { class: "button-link", href: "#/paths" }, "All paths") : null));
	}

	/* ----- List ----- */
	async function renderList() {
		document.title = "Learning paths · psi";
		let paths;
		try { [paths] = await Promise.all([call("get", "/api/paths"), loadGraph()]); }
		catch (error) { if (!disposed) failure(error, renderList); return; }
		if (disposed) return;
		const formHost = el("div", { class: "psi-pa-form-host" });
		const newButton = el("button", { type: "button", class: "primary", onclick: () => openForm() }, "New path");
		const head = el("header", { class: "psi-pa-head" },
			el("div", {}, el("h1", {}, "Learning paths"),
				paths.length ? el("p", { class: "muted" }, "Ordered routes to things you want to be able to do.")
					: null),
			paths.length ? newButton : null);
		const sorted = [...paths].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
		const body = paths.length ? el("ul", { class: "psi-pa-rows" }, sorted.map(pathRow))
			: el("div", { class: "psi-pa-empty" },
				el("p", {}, "A path is an ordered route to something you want to be able to do."),
				el("button", { type: "button", class: "primary", onclick: () => openForm() }, "Make your first path"));
		view.replaceChildren(head, formHost, body);
		function openForm() {
			if (formHost.firstChild) { formHost.querySelector("input")?.focus(); return; }
			body.hidden = !paths.length;
			newButton.hidden = true;
			formHost.append(newPathForm(() => {
				formHost.replaceChildren(); body.hidden = false; newButton.hidden = false;
				(paths.length ? newButton : body.querySelector("button"))?.focus();
			}));
			formHost.querySelector("input")?.focus();
		}
	}

	function pathRow(path) {
		const progress = pathProgress(path, graph.byId);
		const updated = relativeTime(path.updatedAt);
		return el("li", {},
			el("div", { class: "psi-pa-row-main" },
				el("h3", {}, el("a", { href: `#/paths/${enc(path.id)}` }, path.title)),
				path.goal && path.goal !== path.title ? el("p", { class: "psi-pa-goal" }, path.goal) : null,
				el("p", { class: "psi-pa-count" }, progress.label),
				meter(progress.percent, `${path.title}: ${progress.label}`)),
			updated ? el("p", { class: "psi-pa-updated" }, `Updated ${updated}`) : null);
	}

	/* ----- New path ----- */
	function newPathForm(onCancel) {
		const goalId = "psi-pa-goal";
		const goal = el("input", { id: goalId, name: "goal", maxlength: "300", autocomplete: "off",
			placeholder: "e.g. Answer business questions with SQL joins" });
		const error = el("p", { class: "psi-pa-error", role: "status" });
		const picker = el("div", { class: "psi-pa-pick", hidden: true });
		const pickButton = el("button", { type: "button", class: "primary", onclick: () => showPicker() },
			"Pick where it ends");
		const askButton = el("button", { type: "button", onclick: () => ask() }, "Ask the tutor to build it");
		const form = el("form", { class: "psi-pa-new", "aria-label": "New path" },
			el("label", { for: goalId }, "What do you want to be able to do?"), goal,
			el("div", { class: "psi-pa-actions" }, pickButton, askButton,
				el("button", { type: "button", class: "quiet", onclick: onCancel }, "Cancel")),
			error, picker);
		form.addEventListener("submit", (event) => { event.preventDefault(); if (picker.hidden) showPicker(); });
		form.addEventListener("keydown", (event) => {
			if (event.key === "Escape") { event.preventDefault(); onCancel(); }
		});
		const text = () => goal.value.replace(/\s+/g, " ").trim();
		const needGoal = () => {
			if (text()) { error.textContent = ""; return false; }
			error.textContent = "Write what you want to be able to do first."; goal.focus(); return true;
		};
		function ask() {
			if (needGoal()) return;
			go(newChatHash(`/path new ${text()}`));
		}
		function showPicker() {
			if (needGoal()) return;
			if (!picker.hidden) { picker.querySelector("input")?.focus(); return; }
			picker.hidden = false;
			picker.replaceChildren(
				el("p", { class: "muted" },
					"Choose the skill, step or concept the path should end at. psi works out the steps before it."),
				nodeSearch({ label: "Where should it end?", exclude: [], onPick: (node) => create(node) }));
			picker.querySelector("input")?.focus();
		}
		async function create(node) {
			error.textContent = "";
			picker.classList.add("is-busy");
			// The path is named after where it ends; the goal sentence says why. Rename it any time.
			const goalText = text()[0].toUpperCase() + text().slice(1);
			try {
				const draft = { title: node.title || goalText, goal: goalText, targetId: node.id };
				const saved = await call("post", "/api/paths", draft);
				if (disposed) return;
				emit("psi:paths-changed", { id: saved.id });
				go(`#/paths/${enc(saved.id)}`);
			} catch (failed) {
				if (disposed) return;
				picker.classList.remove("is-busy");
				error.textContent = `Couldn't make that path. ${why(failed)}.`;
			}
		}
		return form;
	}

	/** A search field over graph nodes with a keyboard-navigable result list. */
	function nodeSearch({ label, exclude, onPick, placeholder = "Search skills, steps and concepts" }) {
		const uid = `psi-pa-s-${Math.random().toString(36).slice(2, 8)}`;
		const input = el("input", { id: uid, type: "search", autocomplete: "off", placeholder, role: "combobox",
			"aria-expanded": "false", "aria-controls": `${uid}-list`, "aria-autocomplete": "list" });
		const list = el("ul", { class: "psi-pa-results", id: `${uid}-list`, role: "listbox", "aria-label": label });
		const status = el("p", { class: "psi-pa-results-note", role: "status" });
		let results = [], active = 0;
		function render() {
			const query = input.value.trim();
			results = searchNodes(graph.nodes, query, { exclude: typeof exclude === "function" ? exclude() : exclude });
			active = Math.min(active, Math.max(0, results.length - 1));
			list.replaceChildren(...results.map((node, i) => el("li", { id: `${uid}-${i}`, role: "option",
				class: i === active ? "is-active" : "", "aria-selected": String(i === active),
				onmousedown: (event) => event.preventDefault(), onclick: () => onPick(node) },
			el("span", { class: "psi-pa-result-title" }, node.title),
			el("span", { class: "psi-pa-result-kind" }, kindLabel(node, graph.parent.get(node.id))))));
			input.setAttribute("aria-expanded", String(results.length > 0));
			if (results.length) input.setAttribute("aria-activedescendant", `${uid}-${active}`);
			else input.removeAttribute("aria-activedescendant");
			const emptyGraph = graph.nodes.length ? "" : "Your graph is empty. Add a skill from Home first.";
			status.textContent = !query ? emptyGraph
				: results.length ? "" : `Nothing in your graph matches “${query}”.`;
		}
		input.addEventListener("input", () => { active = 0; render(); });
		input.addEventListener("keydown", (event) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				if (!results.length) return;
				event.preventDefault();
				active = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length; render();
				list.children[active]?.scrollIntoView?.({ block: "nearest" });
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (results[active]) onPick(results[active]);
			}
		});
		render();
		const wrap = el("div", { class: "psi-pa-search" }, el("label", { for: uid }, label), input, status, list);
		wrap.reset = () => { input.value = ""; active = 0; render(); input.focus(); };
		return wrap;
	}

	/* ----- Path page ----- */
	let path, editing = false, draft = [], announcer;

	async function renderPage() {
		try {
			[path] = await Promise.all([call("get", `/api/paths/${enc(/** @type {string} */ (id))}`), loadGraph()]);
		} catch (error) {
			if (disposed) return;
			if (error.status === 404) {
				view.replaceChildren(el("div", { class: "empty" }, el("h2", {}, "This path doesn't exist"),
					el("p", {}, "It may have been deleted. Your other paths are still there."),
					el("a", { class: "button", href: "#/paths" }, "All paths")));
			} else failure(error, renderPage);
			return;
		}
		if (disposed) return;
		drawPage();
	}

	function drawPage(focusSelector) {
		document.title = `${path.title} · psi`;
		const progress = pathProgress(path, graph.byId);
		announcer = el("p", { class: "psi-sr-only", "aria-live": "polite" });
		const header = el("header", { class: "psi-pa-page-head" },
			el("a", { class: "psi-back", href: "#/paths" }, "All paths"),
			titleBlock(),
			path.goal && path.goal !== path.title ? el("p", { class: "psi-pa-goal" }, path.goal) : null,
			el("div", { class: "psi-pa-progress" }, el("p", {}, progress.label),
				meter(progress.percent, `${path.title}: ${progress.label}`)),
			editing ? null : el("div", { class: "psi-pa-actions" },
				el("button", { type: "button", class: "primary", disabled: !path.steps.length, onclick: () => {
					const next = progress.nextId ?? path.steps.at(-1);
					go(newChatHash(continuePrompt(path, graph.byId), chatContext(next)));
				} }, "Continue this path"),
				el("a", { class: "button", href: graphHash(path, graph.byId) }, "See it on the graph"),
				el("button", { type: "button", onclick: () => startEdit() }, "Edit steps")));
		const steps = editing ? editList() : stepList(progress);
		const section = el("section", { class: "psi-pa-steps-block", "aria-labelledby": "psi-pa-steps-h" },
			el("h2", { id: "psi-pa-steps-h" }, editing ? "Edit steps" : "Steps"), steps);
		view.replaceChildren(...[header, section, editing ? null : deleteBlock(), announcer].filter(Boolean));
		if (focusSelector) view.querySelector(focusSelector)?.focus();
	}

	function titleBlock() {
		const h1 = el("h1", { class: "psi-pa-title", tabindex: "-1" }, path.title);
		const rename = el("button", { type: "button", class: "quiet psi-pa-rename",
			"aria-label": `Rename ${path.title}`, onclick: () => startRename() }, "Rename");
		const block = el("div", { class: "psi-pa-title-row" }, h1, rename);
		function startRename() {
			const input = el("input", { class: "psi-pa-title-input", value: path.title, maxlength: "120",
				"aria-label": "Path title" });
			const save = el("button", { type: "submit", class: "primary" }, "Save");
			const back = () => drawPage(".psi-pa-rename");
			const cancel = el("button", { type: "button", class: "quiet", onclick: back }, "Cancel");
			const form = el("form", { class: "psi-pa-title-form" }, input, save, cancel);
			form.addEventListener("keydown", (event) => {
				if (event.key === "Escape") { event.preventDefault(); back(); }
			});
			form.addEventListener("submit", async (event) => {
				event.preventDefault();
				const title = input.value.replace(/\s+/g, " ").trim();
				if (!title) { input.focus(); return; }
				if (title === path.title) { back(); return; }
				save.disabled = true;
				try {
					path = await savePath({ title });
					if (!disposed) { drawPage(".psi-pa-title"); emit("psi:paths-changed", { id }); }
				} catch (error) {
					save.disabled = false;
					toast(`Couldn't rename this path. ${why(error)}.`, { kind: "error" });
				}
			});
			block.replaceWith(form); input.focus(); input.select();
		}
		return block;
	}

	function savePath(patch) {
		const body = { title: path.title, goal: path.goal, steps: path.steps,
			...(path.targetId ? { targetId: path.targetId } : {}), ...patch };
		if (body.targetId && !body.steps.includes(body.targetId)) delete body.targetId;
		return call("put", `/api/paths/${enc(/** @type {string} */ (id))}`, body);
	}

	function stepList(progress) {
		if (!path.steps.length) {
			return el("p", { class: "muted" }, "This path has no steps yet. Use Edit steps to add some.");
		}
		return el("ol", { class: "psi-pa-steps" }, path.steps.map((stepId) => {
			const node = graph.byId.get(stepId);
			const state = !node ? "is-missing" : isDone(node) ? "is-done" : stepId === progress.nextId ? "is-next"
				: node.status === "locked" ? "is-locked" : "";
			return el("li", { class: `psi-pa-step ${state}` },
				el("span", { class: "psi-pa-check", "aria-hidden": "true" }),
				el("div", { class: "psi-pa-step-body" },
					node ? el("a", { class: "psi-pa-step-title", href: stepHref(node, stepId) }, node.title)
						: el("span", { class: "psi-pa-step-title" }, stepId),
					el("span", { class: "psi-pa-step-kind" }, kindLabel(node, graph.parent.get(stepId)))),
				el("span", { class: "psi-pa-status" },
					node && stepId === progress.nextId ? "Up next" : statusLabel(node)));
		}));
	}

	function cancelEdit() { editing = false; drawPage(".psi-pa-actions button"); }
	function startEdit() { editing = true; draft = [...path.steps]; drawPage(".psi-pa-edit-row button"); }

	function editList() {
		const titleOf = (stepId) => graph.byId.get(stepId)?.title ?? stepId;
		const list = el("ol", { class: "psi-pa-steps is-editing", "aria-describedby": "psi-pa-edit-help" });
		let dragFrom = -1;
		function move(from, to, focusClass) {
			if (to < 0 || to >= draft.length || from === to) return;
			draft = moveStep(draft, from, to);
			paint(`[data-index="${to}"] ${focusClass}`);
			announcer.textContent = `Moved ${titleOf(draft[to])} to position ${to + 1} of ${draft.length}.`;
		}
		function remove(i, title) {
			draft = removeStep(draft, i);
			const at = Math.min(i, draft.length - 1);
			paint(draft.length ? `[data-index="${at}"] .psi-pa-remove` : ".psi-pa-search input");
			announcer.textContent = `Removed ${title}.`;
		}
		function paint(focusSelector) {
			list.replaceChildren(...draft.map((stepId, i) => {
				const node = graph.byId.get(stepId);
				const title = titleOf(stepId);
				const row = el("li", { class: "psi-pa-step psi-pa-edit-row", draggable: "true", tabindex: "-1",
					dataset: { index: String(i) } },
				el("span", { class: "psi-pa-grip", "aria-hidden": "true", title: "Drag to reorder" }),
				el("div", { class: "psi-pa-step-body" },
					el("span", { class: "psi-pa-step-title" }, title),
					el("span", { class: "psi-pa-step-kind" }, kindLabel(node, graph.parent.get(stepId)))),
				el("div", { class: "psi-pa-edit-actions" },
					el("button", { type: "button", class: "psi-pa-up", disabled: i === 0,
						"aria-label": `Move ${title} up`, onclick: () => move(i, i - 1, ".psi-pa-up") }, "Up"),
					el("button", { type: "button", class: "psi-pa-down", disabled: i === draft.length - 1,
						"aria-label": `Move ${title} down`, onclick: () => move(i, i + 1, ".psi-pa-down") }, "Down"),
					el("button", { type: "button", class: "quiet psi-pa-remove", "aria-label": `Remove ${title}`,
						onclick: () => remove(i, title) }, "Remove")));
				row.addEventListener("keydown", (event) => {
					if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
					event.preventDefault();
					const cls = event.target.classList.contains("psi-pa-remove") ? ".psi-pa-remove"
						: event.key === "ArrowUp" ? ".psi-pa-up" : ".psi-pa-down";
					move(i, i + (event.key === "ArrowUp" ? -1 : 1), cls);
				});
				row.addEventListener("dragstart", (event) => {
					dragFrom = i; row.classList.add("is-dragging");
					event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", stepId);
				});
				row.addEventListener("dragend", () => {
					dragFrom = -1; row.classList.remove("is-dragging"); clearDrop();
				});
				row.addEventListener("dragover", (event) => {
					if (dragFrom < 0) return;
					event.preventDefault(); clearDrop();
					row.classList.add(dragFrom < i ? "is-drop-after" : "is-drop-before");
				});
				row.addEventListener("drop", (event) => {
					event.preventDefault(); const from = dragFrom; clearDrop(); move(from, i, ".psi-pa-up");
				});
				return row;
			}));
			if (!draft.length) list.append(el("li", { class: "psi-pa-step psi-pa-none" }, "No steps. Add one below."));
			if (focusSelector) {
				let target = list.querySelector(focusSelector) ?? view.querySelector(focusSelector);
				// A step moved to an end disables the button just used: keep focus on the same row.
				const row = target?.closest("li");
				if (target?.disabled) target = row?.querySelector("button:not(:disabled)") ?? row;
				target?.focus();
			}
		}
		const clearDrop = () => list.querySelectorAll(".is-drop-before, .is-drop-after")
			.forEach((row) => row.classList.remove("is-drop-before", "is-drop-after"));
		paint();
		const onPick = (node) => {
			draft = addStep(draft, node.id); paint(); search.reset();
			announcer.textContent = `Added ${node.title} as step ${draft.length}.`;
		};
		const search = nodeSearch({ label: "Add a step", placeholder: "Search your graph", exclude: () => draft,
			onPick });
		const saveButton = el("button", { type: "button", class: "primary", onclick: async () => {
			saveButton.disabled = true;
			try {
				path = await savePath({ steps: draft });
				if (disposed) return;
				editing = false; drawPage(".psi-pa-actions button"); toast("Saved your steps.");
				emit("psi:paths-changed", { id });
			} catch (error) {
				saveButton.disabled = false;
				toast(`Couldn't save these steps. ${why(error)}.`, { kind: "error" });
			}
		} }, "Save steps");
		return el("div", { class: "psi-pa-editor" },
			el("p", { id: "psi-pa-edit-help", class: "muted" },
				"Drag steps, or use Up and Down (Alt+arrow keys), to change the order."),
			list, search,
			el("div", { class: "psi-pa-actions" }, saveButton,
				el("button", { type: "button", onclick: () => cancelEdit() }, "Cancel")));
	}

	function deleteBlock() {
		const block = el("div", { class: "psi-pa-delete" });
		const ask = () => {
			const yes = el("button", { type: "button", class: "psi-pa-danger", onclick: async () => {
				yes.disabled = true;
				try {
					await call("del", `/api/paths/${enc(/** @type {string} */ (id))}`);
					if (disposed) return;
					emit("psi:paths-changed", { id, deleted: true });
					toast(`Deleted “${path.title}”.`);
					go("#/paths");
				} catch (error) {
					yes.disabled = false;
					toast(`Couldn't delete this path. ${why(error)}.`, { kind: "error" });
				}
			} }, "Delete path");
			const keepIt = () => { paintIdle(); block.querySelector("button")?.focus(); };
			const keep = el("button", { type: "button", onclick: keepIt }, "Keep it");
			block.replaceChildren(el("p", { role: "alert" },
				"Delete this path? The steps stay in your graph, and so does your progress on them."),
				el("div", { class: "psi-pa-actions" }, yes, keep));
			keep.focus();
		};
		const paintIdle = () => block.replaceChildren(
			el("button", { type: "button", class: "quiet", onclick: ask }, "Delete path"));
		paintIdle();
		return block;
	}

	if (id) void renderPage(); else void renderList();
	return { destroy() { disposed = true; root.replaceChildren(); } };
}

/** A rule track with a highlighter fill (native <progress>, so no inline styles under the CSP). */
function meter(percent, label) {
	return el("progress", { class: "psi-meter is-thin psi-pa-meter", max: "100", value: String(percent),
		"aria-label": label }, `${percent}%`);
}
