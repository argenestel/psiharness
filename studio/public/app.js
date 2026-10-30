"use strict";

const app = document.querySelector("#app");
const dialog = document.querySelector("#lightbox");
let generation = 0;
let reviewState;
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const enc = encodeURIComponent;
const titleOf = (id) => id.replace(/-/g, " ");
const empty = (text) => `<div class="empty">${escape(text)}</div>`;
const pct = (n) => Math.round(Math.min(1, Math.max(0, n || 0)) * 100);
async function api(path, options) {
	const response = await fetch(path, options);
	const data = await response.json();
	if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
	return data;
}
function route() {
	try {
		const [topic, view = "map"] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
		return { topic, view };
	} catch { return { topic: "", view: "map" }; }
}
function topicPath(topic, view) { return `#/${enc(topic)}/${view}`; }
function artwork() {
	return `<svg class="universe" viewBox="0 0 700 290" aria-hidden="true">
		<circle cx="535" cy="145" r="105" fill="#223259"/><ellipse cx="535" cy="145" rx="153" ry="43" fill="none" stroke="#7496e3" stroke-width="8" transform="rotate(-24 535 145)"/>
		<circle cx="535" cy="145" r="78" fill="#f4ac6c"/><path d="M475 112q65-38 124 15M461 150q79-35 149 14M478 192q58-23 110 7" fill="none" stroke="#e17d73" stroke-width="17"/>
		<circle cx="390" cy="56" r="19" fill="#70dfc1"/><circle cx="653" cy="238" r="9" fill="#ad9cf5"/>
		<path d="M330 202l8-17 8 17 18 4-18 5-8 17-8-17-18-5zM644 54l5-11 5 11 12 3-12 3-5 12-5-12-12-3z" fill="#ffda89"/>
		<g fill="#eaf0ff"><circle cx="288" cy="57" r="3"/><circle cx="394" cy="244" r="3"/><circle cx="677" cy="132" r="3"/><circle cx="455" cy="18" r="2"/></g>
	</svg>`;
}
async function render() {
	const token = ++generation;
	const { topic, view } = route();
	reviewState = undefined;
	app.setAttribute("aria-busy", "true");
	try {
		if (!topic) {
			const topics = await api("/api/topics");
			if (token !== generation) return;
			document.title = "ψ Studio · Your learning universe";
			app.innerHTML = `<section class="hero">${artwork()}<div><span class="eyebrow">YOUR LEARNING UNIVERSE</span><h1>Small steps.<br>Cosmic understanding.</h1><p>Explore the connections behind big ideas.<br>Let curiosity lead the way.</p></div></section>
				<div class="section-heading"><h2>Your topics</h2><span>${topics.length} worlds to explore</span></div>
				<section class="topic-grid">${topics.map((t) => {
					const progress = t.concepts ? pct(t.mastered / t.concepts) : 0;
					return `<a class="topic-card" href="${topicPath(t.topic, "map")}"><div class="card-top"><svg class="ring" viewBox="0 0 64 64" role="img" aria-label="${progress}% mastered"><circle class="ring-track" cx="32" cy="32" r="26"/><circle class="ring-value" cx="32" cy="32" r="26" pathLength="100" stroke-dasharray="${progress} 100"/><text x="32" y="37">${progress}%</text></svg><span class="badge">${t.due} due</span></div><h3>${escape(t.title)}</h3><p>${escape(t.bigIdea || "Discover the ideas that connect this topic.")}</p><div class="card-meta">${t.mastered}/${t.concepts} concepts mastered · ${t.artifacts} artifacts <span>↗</span></div></a>`;
				}).join("") || empty("No topics yet. Create a topic with /learn in psi, then return here.")}</section>`;
			return;
		}
		const base = `/api/topics/${enc(topic)}`;
		const [detail, artifacts] = await Promise.all([api(base), api(`${base}/artifacts`)]);
		if (token !== generation) return;
		const { graph, plan, learner, frontier } = detail;
		const concepts = graph?.concepts || [];
		const mastery = learner?.mastery || {};
		document.title = `${graph?.title || titleOf(topic)} · ψ Studio`;
		const views = [["map", "Concept map"], ["lessons", "Lesson path"], ["gallery", "Gallery"], ["review", "Review"], ["progress", "Progress"]];
		app.innerHTML = `<a class="back" href="#/">← All topics</a><div class="topic-heading"><div><span class="eyebrow">FOLLOW YOUR CURIOSITY</span><h1>${escape(graph?.title || titleOf(topic))}</h1><p>${escape(graph?.bigIdea || "Your next big idea starts here.")}</p></div></div>
			<nav class="tabs" aria-label="Topic views">${views.map(([id, label]) => `<a href="${topicPath(topic, id)}" ${id === view ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav><section id="view"></section>`;
		const container = document.querySelector("#view");
		if (view === "map") renderMap(container, concepts, mastery, frontier || [], artifacts, plan);
		else if (view === "lessons") renderLessons(container, plan, concepts, artifacts);
		else if (view === "gallery") renderGallery(container, artifacts);
		else if (view === "review") {
			const cards = await api(`${base}/cards/due`);
			if (token !== generation) return;
			reviewState = { topic, cards, index: 0, revealed: false, busy: false, token, reviewed: 0 };
			renderCard();
		} else if (view === "progress") {
			const reviews = await api(`${base}/reviews`);
			if (token !== generation) return;
			renderProgress(container, concepts, mastery, reviews);
		} else container.innerHTML = empty("This view does not exist. Choose a tab above.");
	} catch (error) {
		if (token === generation) {
			app.innerHTML = `<div class="empty"><h2>Couldn't open this view</h2><p>${escape(error.message)}</p><button id="retry">Try again</button> <a href="#/">Go home</a></div>`;
			document.querySelector("#retry").onclick = render;
		}
	} finally { if (token === generation) app.removeAttribute("aria-busy"); }
}
function conceptStatus(c, mastery, available) {
	if ((mastery[c.id]?.pKnown || 0) >= 0.95) return "mastered";
	if (mastery[c.id]?.attempts > 0) return "learning";
	return available.has(c.id) ? "frontier" : "locked";
}
function linkedArtifacts(c, artifacts, plan) {
	const paths = (plan?.lessons || []).filter((l) => l.conceptId === c.id)
		.flatMap((l) => l.visuals || []).map((v) => v.path?.split("/").pop()).filter(Boolean);
	return artifacts.filter((a) => paths.includes(a.name) || a.name.includes(c.id));
}
function renderMap(container, concepts, mastery, frontier, artifacts, plan) {
	if (!concepts.length) { container.innerHTML = empty("No concept graph yet. Your tutor can create one with /map."); return; }
	const available = new Set(frontier.map((c) => typeof c === "string" ? c : c.id));
	const byId = new Map(concepts.map((c) => [c.id, c]));
	const depths = new Map();
	function depth(id, visiting = new Set()) {
		if (depths.has(id)) return depths.get(id);
		if (visiting.has(id)) return 0;
		const c = byId.get(id);
		if (!c) return -1;
		const next = new Set(visiting).add(id);
		const d = Math.min(concepts.length, Math.max(-1, ...c.prerequisites.map((p) => depth(p, next))) + 1);
		depths.set(id, d); return d;
	}
	const layers = [];
	for (const c of concepts) (layers[depth(c.id)] ||= []).push(c);
	const width = Math.max(600, ...layers.map((l) => (l?.length || 0) * 190));
	const height = Math.max(340, layers.length * 145 + 50);
	const positions = new Map();
	layers.forEach((layer, level) => layer.forEach((c, i) => positions.set(c.id,
		{ x: (i + 0.5) * width / layer.length, y: 75 + level * 145 })));
	container.innerHTML = `<div class="legend">${["locked", "frontier", "learning", "mastered"].map((s) => `<span class="${s}">● ${s}</span>`).join("")}</div><div class="map-layout"><div class="map-scroll"><svg class="concept-map" viewBox="0 0 ${width} ${height}" aria-label="Concept prerequisite map"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>${concepts.flatMap((c) => c.prerequisites.map((p) => {
		const from = positions.get(p), to = positions.get(c.id);
		return from ? `<path class="edge" d="M${from.x} ${from.y + 29} C${from.x} ${from.y + 75},${to.x} ${to.y - 75},${to.x} ${to.y - 36}" marker-end="url(#arrow)"/>` : "";
	})).join("")}${concepts.map((c) => {
		const { x, y } = positions.get(c.id);
		return `<g class="node ${conceptStatus(c, mastery, available)}" data-id="${escape(c.id)}" role="button" tabindex="0" aria-label="${escape(c.title)}, ${conceptStatus(c, mastery, available)}" transform="translate(${x},${y})"><circle r="29"/><text class="node-symbol" y="7">${(mastery[c.id]?.pKnown || 0) >= 0.95 ? "✓" : "✦"}</text><text class="node-label" y="54">${escape(c.title.length > 24 ? c.title.slice(0, 22) + "…" : c.title)}</text><title>${escape(c.title)}</title></g>`;
	}).join("")}</svg></div><aside id="concept-detail" class="panel">${empty("Choose a concept to discover its story.")}</aside></div>`;
	function select(id) {
		const c = byId.get(id);
		const links = linkedArtifacts(c, artifacts, plan);
		document.querySelector("#concept-detail").innerHTML = `<span class="eyebrow">${conceptStatus(c, mastery, available)} · LEVEL ${c.difficulty}</span><h2>${escape(c.title)}</h2><p>${escape(c.summary)}</p>${c.intuition ? `<blockquote>${escape(c.intuition)}</blockquote>` : ""}${[["Watch out for", c.misconceptions], ["Picture this", c.visualHooks]].map(([label, items]) => items?.length ? `<h3>${label}</h3><ul>${items.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>` : "").join("")}<h3>Linked artifacts</h3>${links.length ? links.map((a, i) => `<button class="artifact-link" data-artifact="${i}">${escape(a.name)} ↗</button>`).join("") : "<p class=\"muted\">No linked visuals yet.</p>"}`;
		document.querySelectorAll("[data-artifact]").forEach((button) => button.onclick = () => openArtifact(links[Number(button.dataset.artifact)]));
		document.querySelectorAll(".node").forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.id === id)));
	}
	container.querySelectorAll(".node").forEach((node) => {
		node.onclick = () => select(node.dataset.id);
		node.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(node.dataset.id); } };
	});
}
function renderLessons(container, plan, concepts, artifacts) {
	if (!plan?.lessons?.length) { container.innerHTML = empty("Your lesson path is waiting to be planned. Use /learn in psi."); return; }
	container.innerHTML = `<p class="lead">${escape(plan.goal)}</p><ol class="lesson-list">${plan.lessons.map((lesson, i) => {
		const concept = concepts.find((c) => c.id === lesson.conceptId);
		return `<li class="panel"><span class="lesson-number">${i + 1}</span><div><span class="badge">${escape(lesson.status)}</span><h2>${escape(concept?.title || titleOf(lesson.conceptId))}</h2><p>${escape(lesson.objective)}</p><div class="beats">${(lesson.beats || []).map((b) => `<div><span class="eyebrow">${escape(b.kind)}</span><p>${escape(b.text)}</p></div>`).join("")}</div>${(lesson.visuals || []).map((v) => {
			const a = artifacts.find((a) => a.name === v.path?.split("/").pop());
			return a ? `<button data-open="${escape(a.name)}">▷ ${escape(v.title)}</button>` : `<p class="muted">${escape(v.title)} · ${escape(v.goal)} · visual planned</p>`;
		}).join("")}</div></li>`;
	}).join("")}</ol>`;
	container.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => openArtifact(artifacts.find((a) => a.name === b.dataset.open)));
}
function media(a, preview = false) {
	const url = escape(a.url);
	if (a.type.startsWith("text/html")) return `<iframe src="${url}" sandbox="allow-scripts" title="${escape(a.name)}" loading="lazy" ${preview ? 'tabindex="-1"' : ""}></iframe>`;
	if (a.type.startsWith("video/")) return `<video src="${url}" ${preview ? "muted preload=\"metadata\"" : "controls autoplay"} playsinline></video>`;
	if (a.type.startsWith("image/")) return `<img src="${url}" alt="${escape(a.name)}" loading="lazy">`;
	return `<div class="file-preview">◇<p>${escape(a.name)}</p></div>`;
}
function renderGallery(container, artifacts) {
	container.innerHTML = `<div class="section-heading"><h2>Ideas you can see</h2><span>${artifacts.length} artifacts</span></div><div class="gallery">${artifacts.map((a, i) => `<article class="artifact-card"><div class="preview">${media(a, true)}</div><button data-open="${i}"><span>${escape(a.name)}</span> ↗</button><small>${escape(a.type.split(";")[0])}</small></article>`).join("") || empty("No artifacts yet. Create an explainer with /visualize or /explore.")}</div>`;
	container.querySelectorAll("[data-open]").forEach((button) => button.onclick = () => openArtifact(artifacts[Number(button.dataset.open)]));
}
function openArtifact(a) {
	if (!a) return;
	document.querySelector("#lightbox-content").innerHTML = `<h2>${escape(a.name)}</h2><div class="lightbox-media">${media(a)}</div><a href="${escape(a.url)}" target="_blank" rel="noopener noreferrer">Open artifact ↗</a>`;
	dialog.showModal();
}
function closeArtifact() { dialog.close(); document.querySelector("#lightbox-content").replaceChildren(); }
function renderCard(message = "") {
	const s = reviewState;
	if (!s || s.token !== generation) return;
	const container = document.querySelector("#view");
	const card = s.cards[s.index];
	if (!card) {
		container.innerHTML = `<div class="review-complete panel"><span class="completion-star">✦</span><h2>${s.reviewed ? "A little stronger, a little clearer." : "You're all caught up."}</h2><p>${s.reviewed} cards reviewed. Come back when your next cards are due.</p><p role="status">${escape(message)}</p><a class="button" href="${topicPath(s.topic, "progress")}">See your progress →</a></div>`;
		return;
	}
	container.innerHTML = `<div class="review-wrap"><div class="section-heading"><span>${s.index + 1} / ${s.cards.length} cards</span><span>${escape(card.kind)}</span></div><article class="flashcard panel"><span class="eyebrow">${escape(titleOf(card.conceptId))}</span><h2>${escape(card.prompt)}</h2>${card.kind === "mcq" ? `<div class="choices">${(card.choices || []).map((choice, i) => `<button data-choice="${i}" ${s.revealed ? "disabled" : ""}>${escape(choice)}</button>`).join("")}</div>` : ""}${s.revealed ? `<div class="answer"><span class="eyebrow">ANSWER</span><p>${escape(card.answer)}</p><p class="muted">How well did you remember? Rate your recall.</p></div><div class="ratings">${["Again", "Hard", "Good", "Easy"].map((label, i) => `<button data-rating="${i + 1}" ${s.busy ? "disabled" : ""}><strong>${label}</strong><small>${i + 1}</small></button>`).join("")}</div>` : '<button id="reveal" class="primary">Reveal answer <small>Space</small></button>'}</article><p class="review-message" role="status">${escape(message)}</p></div>`;
	container.querySelector("#reveal")?.addEventListener("click", () => { s.revealed = true; renderCard(); });
	container.querySelectorAll("[data-choice]").forEach((button) => button.onclick = () => {
		s.revealed = true; renderCard(`Your choice: ${card.choices[Number(button.dataset.choice)]}`);
	});
	container.querySelectorAll("[data-rating]").forEach((button) => button.onclick = () => submitRating(Number(button.dataset.rating)));
}
async function submitRating(rating) {
	const s = reviewState;
	if (!s || !s.revealed || s.busy || !s.cards[s.index]) return;
	s.busy = true; renderCard();
	try {
		const card = s.cards[s.index];
		const updated = await api(`/api/topics/${enc(s.topic)}/cards/${enc(card.id)}/review`, {
			method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }),
		});
		if (s.token !== generation) return;
		const days = Math.max(0, (Date.parse(updated.fsrs.due) - Date.now()) / 86400000);
		const amount = days < 1 ? Math.max(1, Math.round(days * 1440)) : Math.round(days);
		const unit = days < 1 ? "minute" : "day";
		const interval = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
		s.index++; s.reviewed++; s.revealed = false; s.busy = false;
		renderCard(`Saved · Next review in ${interval}.`);
	} catch (error) { if (s.token === generation) { s.busy = false; renderCard(error.message); } }
}
function dayKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function renderProgress(container, concepts, mastery, reviews) {
	const counts = new Map();
	for (const review of reviews) {
		const date = new Date(review.reviewedAt);
		if (!Number.isNaN(date.getTime())) { const key = dayKey(date); counts.set(key, (counts.get(key) || 0) + 1); }
	}
	const today = new Date(); today.setHours(12, 0, 0, 0);
	const cursor = new Date(today);
	if (!counts.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
	let streak = 0;
	while (counts.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
	const days = Array.from({ length: 91 }, (_, i) => {
		const date = new Date(today); date.setDate(date.getDate() - 90 + i);
		const key = dayKey(date), count = counts.get(key) || 0;
		return `<div class="heat-day level-${Math.min(4, count)}" role="img" aria-label="${key}: ${count} reviews" title="${key}: ${count} reviews"></div>`;
	}).join("");
	const mastered = concepts.filter((c) => (mastery[c.id]?.pKnown || 0) >= 0.95).length;
	container.innerHTML = `<div class="stats"><div class="panel"><strong>${streak}</strong><span>day review streak</span></div><div class="panel"><strong>${reviews.length}</strong><span>retrievals practiced</span></div><div class="panel"><strong>${mastered}/${concepts.length}</strong><span>concepts mastered</span></div></div><section class="panel"><div class="section-heading"><h2>A little, often</h2><span>Last 13 weeks · local dates</span></div><div class="heatmap">${days}</div><p class="muted">Each square is a day. Brighter means more retrieval practice.</p></section><section class="panel mastery-panel"><h2>Your growing understanding</h2>${concepts.map((c) => {
		const m = mastery[c.id], value = pct(m?.pKnown);
		return `<div class="mastery-row"><div><span>${escape(c.title)}</span><small>${value}% · ${m?.attempts || 0} attempts</small></div><progress value="${value}" max="100" aria-label="${escape(c.title)} mastery">${value}%</progress></div>`;
	}).join("") || empty("No concepts to measure yet.")}</section>`;
}

document.querySelector("#close-lightbox").onclick = closeArtifact;
dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeArtifact(); });
dialog.addEventListener("click", (event) => { if (event.target === dialog) closeArtifact(); });
window.addEventListener("hashchange", () => { closeArtifact(); void render(); });
window.addEventListener("keydown", (event) => {
	if (dialog.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.altKey || event.ctrlKey || event.metaKey) return;
	if (reviewState && event.code === "Space" && !reviewState.revealed && reviewState.cards[reviewState.index]) {
		event.preventDefault(); reviewState.revealed = true; renderCard();
	} else if (reviewState && /^[1-4]$/.test(event.key)) { event.preventDefault(); void submitRating(Number(event.key)); }
});
const events = new EventSource("/api/events");
events.onopen = () => { document.querySelector("#connection").textContent = "● Live"; };
events.onerror = () => { document.querySelector("#connection").textContent = "Reconnecting…"; };
events.addEventListener("changed", () => {
	// Preserve an active answer and in-flight review; all other views refresh immediately.
	if (reviewState) { document.querySelector("#connection").textContent = "● Updates ready"; return; }
	void render();
});
void render();
