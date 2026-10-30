import { api } from "./api.js";

/** Mount editable, local learner memory and recent session recaps. */
export function mountMemory(el) {
	let disposed = false;
	let version = 0;
	el.innerHTML = `<section class="psi-memory"><span class="eyebrow">YOUR LEARNING COMPANION</span>
		<h1>A memory that grows with you.</h1><p>psi stores this only on your machine. You decide what it remembers.</p>
		<form class="psi-memory-form psi-card"><h2>Remember something about me</h2>
		<div class="psi-form-row"><label>Kind<select name="kind"></select></label>
		<label class="psi-grow">Memory<input name="text" required maxlength="4000" placeholder="I learn best with concrete examples"></label>
		<button class="primary" type="submit">Add memory</button></div></form>
		<p class="psi-memory-status" role="status"></p><div class="psi-memory-columns">
		<section><h2>What psi remembers</h2><div id="memory-items">Loading memories…</div></section>
		<section><div class="psi-card"><h2>Learner profile</h2><pre id="memory-summary">Loading profile…</pre></div>
		<div class="psi-section"><h2>Recent sessions</h2><div id="memory-recaps">Loading recaps…</div></div></section></div></section>`;
	const kinds = ["goal", "background", "preference", "strength", "struggle", "misconception", "insight", "motivation", "constraint"];
	const select = el.querySelector("select");
	for (const kind of kinds) { const option = document.createElement("option"); option.value = kind; option.textContent = kind; select.append(option); }
	const status = el.querySelector(".psi-memory-status");
	const append = (parent, tag, value, className = "") => {
		const node = document.createElement(tag); node.textContent = value; node.className = className;
		parent.append(node); return node;
	};
	const load = async () => {
		const token = ++version;
		try {
			const data = await api.get("/api/memory");
			if (disposed || token !== version) return;
			const items = el.querySelector("#memory-items"); items.replaceChildren();
			const groups = new Map();
			for (const item of data.items || []) {
				if (!groups.has(item.kind)) groups.set(item.kind, []);
				groups.get(item.kind).push(item);
			}
			if (!groups.size) append(items, "p", "Nothing saved yet. Add a goal or learning preference above.", "psi-card");
			for (const [kind, memories] of groups) {
				const section = append(items, "section", "", "psi-card psi-memory-group");
				append(section, "h3", kind);
				for (const memory of memories) {
					const row = append(section, "div", "", "psi-memory-item");
					append(row, "p", memory.text);
					const confidence = Math.round(Math.max(0, Math.min(1, Number(memory.confidence) || 0)) * 100);
					append(row, "small", `${memory.source || "learner"} · ${confidence}% confidence`, "muted");
					const button = append(row, "button", "Delete"); button.type = "button";
					button.setAttribute("aria-label", `Delete memory: ${memory.text}`);
					button.onclick = async () => {
						if (!confirm("Delete this memory?")) return;
						button.disabled = true;
						try { await api.del(`/api/memory/${encodeURIComponent(memory.id)}`); if (!disposed) { status.textContent = "Memory deleted."; await load(); } }
						catch (error) { if (!disposed) { status.textContent = error.message; button.disabled = false; } }
					};
				}
			}
			el.querySelector("#memory-summary").textContent = data.summary || "Your learner profile will appear as psi gets to know you.";
			const recaps = el.querySelector("#memory-recaps"); recaps.replaceChildren();
			for (const recap of [...(data.recaps || [])].sort((a, b) => b.date.localeCompare(a.date))) {
				const card = append(recaps, "article", "", "psi-card psi-recap");
				const time = append(card, "time", new Date(recap.date).toLocaleDateString()); time.dateTime = recap.date;
				append(card, "h3", recap.skill || recap.topic || "Learning session");
				append(card, "p", recap.summary);
				if (recap.wins?.length) append(card, "p", `Wins: ${recap.wins.join(" · ")}`);
				if (recap.next) append(card, "p", `Next: ${recap.next}`);
			}
			if (!data.recaps?.length) append(recaps, "p", "Your session recaps will collect here.", "muted");
		} catch (error) {
			if (!disposed && token === version) {
				status.textContent = `Could not load memory. ${error.message}`;
				for (const selector of ["#memory-items", "#memory-summary", "#memory-recaps"]) {
					el.querySelector(selector).textContent = "Unavailable right now. Your saved memories are unchanged.";
				}
			}
		}
	};
	el.querySelector("form").onsubmit = async (event) => {
		event.preventDefault();
		const input = el.querySelector("input"); const text = input.value.trim();
		if (!text) { input.focus(); return; }
		const button = el.querySelector("button[type=submit]"); button.disabled = true;
		try {
			await api.post("/api/memory", { kind: select.value, text });
			if (!disposed) { input.value = ""; status.textContent = "Memory saved."; await load(); }
		} catch (error) { if (!disposed) status.textContent = error.message; }
		finally { if (!disposed) button.disabled = false; }
	};
	void load();
	return { destroy() { disposed = true; version++; el.replaceChildren(); } };
}
