import { api } from "./api.js";
import { el } from "./ui.js";

const reason = (error) => String(error?.message ?? error).replace(/[.\s]+$/, "");
/** "What happened, what to do" for a failed request. */
const failure = (error) => error instanceof TypeError || /failed to fetch|network/i.test(error?.message ?? "")
	? "psi web didn't answer. Check that it's running, then try again." : `${reason(error)}.`;

/** PATCH through api.js when it has a helper, otherwise with the same X-Psi + JSON conventions. */
async function patch(path, body) {
	if (typeof api.patch === "function") return api.patch(path, body);
	const response = await fetch(path, { method: "PATCH", body: JSON.stringify(body ?? {}),
		headers: { "X-Psi": "1", "Content-Type": "application/json", Accept: "application/json" } });
	let data;
	try { data = await response.json(); } catch { data = {}; }
	if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
	return data;
}

/** Plain-language groups, in display order; the first kind is what a new item in that group is saved as. */
export const MEMORY_GROUPS = [
	{ name: "Goals", kinds: ["goal"] },
	{ name: "How you like to learn", kinds: ["preference"] },
	{ name: "What clicked", kinds: ["insight", "strength"] },
	{ name: "Where you get stuck", kinds: ["struggle", "misconception"] },
	{ name: "Background", kinds: ["background"] },
	{ name: "Constraints", kinds: ["constraint"] },
	{ name: "Motivation", kinds: ["motivation"] },
];

/** Group name for a memory kind. */
export function groupFor(kind) {
	return MEMORY_GROUPS.find((g) => g.kinds.includes(kind)) ?? MEMORY_GROUPS[0];
}

/** Where a memory came from, in words. */
export function sourceWords(source) {
	return source === "observed" || source === "inferred" ? "psi noticed" : "You told psi";
}

function kindSelect(selected, label) {
	const select = el("select", { "aria-label": label },
		MEMORY_GROUPS.map((g) => el("option", { value: g.kinds[0] }, g.name)));
	select.value = groupFor(selected).kinds[0];
	return select;
}

function dateWords(iso) {
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) return "";
	const days = Math.floor((Date.now() - d.getTime()) / 86400000);
	if (days < 1 && d.getDate() === new Date().getDate()) return "Today";
	if (days < 2) return "Yesterday";
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric",
		...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

/** Mount #/memory: what psi knows about the learner, editable inline. */
export function mountMemory(host) {
	let disposed = false, version = 0;
	const status = el("p", { class: "psi-mem-status", role: "status", "aria-live": "polite" });
	const say = (text) => { if (!disposed) status.textContent = text; };
	const list = el("div", { class: "psi-mem-groups" }, el("p", { class: "psi-sk-quiet" }, "Loading what psi knows…"));
	const recaps = el("section", { class: "psi-mem-recaps", "aria-labelledby": "psi-mem-recaps-h", hidden: true });

	const input = el("textarea", { name: "text", rows: "2", maxlength: "400", required: true,
		"aria-label": "Something about you",
		placeholder: "I learn best from a worked example before the theory." });
	const kind = kindSelect("preference", "What kind of thing is this");
	const add = el("button", { type: "submit", class: "primary" }, "Remember this");
	const form = el("form", { class: "psi-mem-add" },
		el("label", { class: "psi-mem-add-label", for: "psi-mem-add-text" }, "Tell psi something"),
		Object.assign(input, { id: "psi-mem-add-text" }),
		el("div", { class: "psi-mem-add-row" }, kind, add));
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const text = input.value.trim();
		if (!text) { input.focus(); return; }
		add.disabled = true;
		try {
			await api.post("/api/memory", { kind: kind.value, text });
			if (disposed) return;
			input.value = ""; say("Saved. psi will use this from your next message.");
			await load();
			input.focus();
		} catch (error) { say(`Couldn't save that. ${failure(error)}`); }
		finally { if (!disposed) add.disabled = false; }
	});

	host.replaceChildren(el("section", { class: "psi-mem psi-view" },
		el("header", { class: "psi-mem-head" },
			el("h1", {}, "What psi knows about you"),
			el("p", { class: "psi-sk-quiet" }, "Stored only on this machine, in your psi folder.")),
		form, status, list, recaps));

	function itemRow(item) {
		const row = el("li", { class: "psi-mem-item", dataset: { id: item.id } });
		const view = () => {
			row.classList.remove("is-editing", "is-confirming");
			row.replaceChildren(
				el("div", { class: "psi-mem-item-main" },
					el("p", { class: "psi-mem-text" }, item.text),
					el("span", { class: "psi-sk-quiet psi-mem-source" }, sourceWords(item.source))),
				el("div", { class: "psi-mem-actions" },
					el("button", { type: "button", class: "quiet", "aria-label": `Edit: ${item.text}`, onclick: edit }, "Edit"),
					el("button", { type: "button", class: "quiet", "aria-label": `Remove: ${item.text}`, onclick: confirm },
						"Remove")));
		};
		const edit = () => {
			row.classList.add("is-editing");
			const text = el("textarea", { rows: "2", maxlength: "400", "aria-label": "Edit this memory" });
			text.value = item.text;
			const group = kindSelect(item.kind, "What kind of thing is this");
			const save = el("button", { type: "submit", class: "primary" }, "Save");
			const editForm = el("form", { class: "psi-mem-edit" }, text,
				el("div", { class: "psi-mem-add-row" }, group, save,
					el("button", { type: "button", onclick: () => { view(); row.querySelector("button")?.focus(); } }, "Cancel")));
			text.addEventListener("keydown", (event) => {
				if (event.key === "Escape") { event.preventDefault(); view(); row.querySelector("button")?.focus(); }
				if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
					event.preventDefault(); editForm.requestSubmit();
				}
			});
			editForm.addEventListener("submit", async (event) => {
				event.preventDefault();
				const value = text.value.trim();
				if (!value) { text.focus(); return; }
				const changes = {};
				if (value !== item.text) changes.text = value;
				if (groupFor(item.kind) !== groupFor(group.value)) changes.kind = group.value;
				if (!Object.keys(changes).length) { view(); return; }
				save.disabled = true;
				try {
					await patch(`/api/memory/${encodeURIComponent(item.id)}`, changes);
					if (disposed) return;
					say("Updated.");
					await load();
					focusRow(item.id);
				} catch (error) { save.disabled = false; say(`Couldn't update that. ${failure(error)}`); }
			});
			row.replaceChildren(editForm);
			text.focus(); text.setSelectionRange(text.value.length, text.value.length);
		};
		const confirm = () => {
			row.classList.add("is-confirming");
			const back = () => { view(); row.querySelector("button")?.focus(); };
			const keep = el("button", { type: "button", onclick: back }, "Keep it");
			const remove = el("button", { type: "button", class: "psi-mem-remove", onclick: async () => {
				remove.disabled = true;
				try {
					await api.del(`/api/memory/${encodeURIComponent(item.id)}`);
					if (disposed) return;
					const neighbour = (row.nextElementSibling ?? row.previousElementSibling)?.dataset.id;
					say("Removed. psi won't use it again.");
					await load();
					focusRow(neighbour);
				} catch (error) { remove.disabled = false; say(`Couldn't remove that. ${failure(error)}`); }
			} }, "Remove");
			row.replaceChildren(
				el("div", { class: "psi-mem-item-main" },
					el("p", { class: "psi-mem-text" }, item.text),
					el("span", { class: "psi-mem-ask" }, "Remove this from psi's memory?")),
				el("div", { class: "psi-mem-actions" }, remove, keep));
			keep.focus();
		};
		view();
		return row;
	}

	/** Keep keyboard focus on the page after a re-render: the row's first button, else the add box. */
	function focusRow(id) {
		const target = id && list.querySelector(`.psi-mem-item[data-id="${CSS.escape(id)}"] button`);
		(target || input).focus({ preventScroll: Boolean(target) });
	}

	function renderItems(items) {
		list.replaceChildren();
		if (!items.length) {
			list.append(el("div", { class: "psi-mem-empty" },
				el("p", {}, "psi doesn't know anything about you yet."),
				el("p", { class: "psi-sk-quiet" }, "Tell psi one thing about how you like to learn.")));
			kind.value = "preference";
			return;
		}
		for (const group of MEMORY_GROUPS) {
			const mine = items.filter((item) => group.kinds.includes(item.kind))
				.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
			if (!mine.length) continue;
			const id = `psi-mem-${group.kinds[0]}`;
			list.append(el("section", { class: "psi-mem-group", "aria-labelledby": id },
				el("h2", { id }, group.name), el("ul", { class: "psi-mem-list" }, mine.map(itemRow))));
		}
	}

	function renderRecaps(items) {
		const recent = [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5);
		recaps.hidden = !recent.length;
		recaps.replaceChildren(el("h2", { id: "psi-mem-recaps-h" }, "Recent sessions"),
			el("ul", { class: "psi-mem-list" }, recent.map((r) => el("li", { class: "psi-mem-recap" },
				el("time", { class: "psi-sk-quiet", datetime: r.date }, dateWords(r.date)),
				el("div", {},
					el("p", { class: "psi-mem-text" }, r.summary),
					r.next ? el("p", { class: "psi-mem-next" }, el("strong", {}, "Next: "), r.next) : null)))));
	}

	async function load() {
		const token = ++version;
		try {
			const data = await api.get("/api/memory");
			if (disposed || token !== version) return;
			renderItems(data.items ?? []);
			renderRecaps(data.recaps ?? []);
		} catch (error) {
			if (disposed || token !== version) return;
			list.replaceChildren(el("div", { class: "psi-mem-empty" },
				el("p", { class: "psi-sk-error" }, `Couldn't load your memory. ${failure(error)}`),
				el("button", { type: "button", onclick: () => void load() }, "Try again")));
		}
	}

	void load();
	return { destroy() { disposed = true; version++; host.replaceChildren(); } };
}
