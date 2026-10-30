/** Parse shell hashes while retaining the original #/topic/view URLs. */
export function parseRoute(hash = "#/") {
	try {
		const raw = String(hash).replace(/^#\/?/, "");
		const index = raw.indexOf("?");
		const path = index < 0 ? raw : raw.slice(0, index);
		const query = new URLSearchParams(index < 0 ? "" : raw.slice(index + 1));
		const parts = path.split("/").map(decodeURIComponent);
		const [first, second] = parts;
		if (!first) return { route: "home", params: {} };
		if (first === "new") return { route: "new", params: {
			skill: query.get("skill") || "", topic: query.get("topic") || "", prompt: query.get("prompt") || "",
		} };
		if (first === "chat" && second) return { route: "chat", params: { chatId: second } };
		if (first === "skills" && second) return { route: "skill", params: { skill: second } };
		if (first === "memory" || first === "topics") return { route: first, params: {} };
		return { route: "topic", params: { topic: first, view: second || "map" } };
	} catch { return { route: "home", params: {} }; }
}

/** Clamp a ratio and round it to a whole percent for progress bars. */
export function barPercent(value, total) {
	const n = Number(value), max = Number(total);
	return Number.isFinite(n) && Number.isFinite(max) && max > 0
		? Math.round(Math.max(0, Math.min(1, n / max)) * 100) : 0;
}

/** Format the shared 20-hour goal and the core's quadratic XP level boundaries. */
export function formatBars(progress = {}) {
	const finite = (n) => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
	const xp = finite(progress?.xp);
	const level = Math.floor((1 + Math.sqrt(1 + 4 * xp / 25)) / 2);
	const start = 25 * (level - 1) * level;
	const hours = finite(progress?.minutesLogged) / 60;
	return { level, levelPercent: barPercent(xp - start, 50 * level),
		hours: `${Math.round(hours * 10) / 10}/20`, hoursPercent: barPercent(hours, 20) };
}

function init() {
const app = document.querySelector("#app");
const dialog = document.querySelector("#lightbox");
const connection = document.querySelector("#connection");
let generation = 0;
let reviewState;
let liveLabel = "Connecting…";
// Our own review writes echo back as filesystem change events; do not report those as external updates.
let ownWriteUntil = 0;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const enc = encodeURIComponent;
const titleOf = (id) => String(id).replace(/[-_]+/g, " ");
const empty = (text) => `<div class="empty">${escapeHtml(text)}</div>`;
const pct = (n) => Math.round(Math.min(1, Math.max(0, n || 0)) * 100);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** File name without directories or extension, used to match plan visuals to rendered artifacts. */
const stem = (path) => String(path || "").split("/").pop().replace(/\.[^.]+$/, "");
const pretty = (name) => {
	const words = titleOf(stem(name)).trim();
	return words ? words[0].toUpperCase() + words.slice(1) : name;
};
const kindOf = (a) => a.type.startsWith("text/html") ? "Interactive page" : a.type.startsWith("video/") ? "Video"
	: a.type.startsWith("image/") ? "Image" : "File";
function setConnection(text) { liveLabel = text; connection.textContent = text; }

async function api(path, options) {
	const response = await fetch(path, options);
	let data;
	try { data = await response.json(); } catch { data = {}; }
	if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
	return data;
}
function route() {
	const parsed = parseRoute(location.hash);
	return { topic: parsed.params.topic || "", view: parsed.params.view || "map" };
}
function topicPath(topic, view) { return `#/${enc(topic)}/${view}`; }
function artwork() {
	return `<svg class="universe" viewBox="0 0 700 290" aria-hidden="true">
		<circle cx="535" cy="145" r="105" fill="#223259"/>
		<ellipse cx="535" cy="145" rx="153" ry="43" fill="none" stroke="#7496e3" stroke-width="8"
			transform="rotate(-24 535 145)"/>
		<circle cx="535" cy="145" r="78" fill="#f4ac6c"/>
		<path d="M475 112q65-38 124 15M461 150q79-35 149 14M478 192q58-23 110 7" fill="none" stroke="#e17d73"
			stroke-width="17"/>
		<circle cx="390" cy="56" r="19" fill="#70dfc1"/><circle cx="653" cy="238" r="9" fill="#ad9cf5"/>
		<path d="M330 202l8-17 8 17 18 4-18 5-8 17-8-17-18-5zM644 54l5-11 5 11 12 3-12 3-5 12-5-12-12-3z" fill="#ffda89"/>
		<g fill="#eaf0ff"><circle cx="288" cy="57" r="3"/><circle cx="394" cy="244" r="3"/><circle cx="677" cy="132" r="3"/>
			<circle cx="455" cy="18" r="2"/></g>
	</svg>`;
}
function topicCard(t) {
	const progress = t.concepts ? pct(t.mastered / t.concepts) : 0;
	return `<a class="topic-card" href="${topicPath(t.topic, "map")}"><div class="card-top">
		<svg class="ring" viewBox="0 0 64 64" role="img" aria-label="${progress}% mastered">
			<circle class="ring-track" cx="32" cy="32" r="26"/>
			<circle class="ring-value" cx="32" cy="32" r="26" pathLength="100" stroke-dasharray="${progress} 100"/>
			<text x="32" y="37">${progress}%</text></svg>
		<span class="badge">${t.due} due</span></div>
		<h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.bigIdea || "Discover the ideas that connect this topic.")}</p>
		<div class="card-meta">${t.mastered}/${plural(t.concepts, "concept")} mastered · ${plural(t.artifacts, "artifact")}
			<span aria-hidden="true">↗</span></div></a>`;
}
const VIEWS = [["map", "Concept map", "Map"], ["lessons", "Lesson path", "Lessons"], ["gallery", "Gallery", "Gallery"],
	["review", "Review", "Review"], ["progress", "Progress", "Progress"]];
async function render() {
	const token = ++generation;
	const { topic, view } = route();
	reviewState = undefined;
	if (events?.readyState === EventSource.OPEN) setConnection("● Live");
	app.setAttribute("aria-busy", "true");
	try {
		if (!topic) {
			const topics = await api("/api/topics");
			if (token !== generation) return;
			document.title = "ψ Studio · Your learning universe";
			app.innerHTML = `<section class="hero">${artwork()}<div><span class="eyebrow">YOUR LEARNING UNIVERSE</span>
				<h1>Small steps.<br>Cosmic understanding.</h1>
				<p>Explore the connections behind big ideas.<br>Let curiosity lead the way.</p></div></section>
				<div class="section-heading"><h2>Your topics</h2>
				<span>${topics.length === 1 ? "1 world" : `${topics.length} worlds`} to explore</span></div>
				<section class="topic-grid">${topics.map(topicCard).join("")
					|| empty("No topics yet. Create a topic with /learn in psi, then return here.")}</section>`;
			return;
		}
		const base = `/api/topics/${enc(topic)}`;
		const [detail, artifacts] = await Promise.all([api(base), api(`${base}/artifacts`)]);
		if (token !== generation) return;
		const { graph, plan, learner, frontier } = detail;
		const concepts = graph?.concepts || [];
		const mastery = learner?.mastery || {};
		document.title = `${graph?.title || titleOf(topic)} · ψ Studio`;
		app.innerHTML = `<a class="back" href="#/topics">← All topics</a><div class="topic-heading">
			<span class="eyebrow">FOLLOW YOUR CURIOSITY</span><h1>${escapeHtml(graph?.title || titleOf(topic))}</h1>
			<p>${escapeHtml(graph?.bigIdea || "Your next big idea starts here.")}</p></div>
			<nav class="tabs" aria-label="Topic views">${VIEWS.map(([id, label, short]) => `<a href="${topicPath(topic, id)}"
				${id === view ? 'aria-current="page"' : ""}><span class="tab-long">${label}</span><span class="tab-short"
				aria-hidden="true">${short}</span></a>`).join("")}</nav><section id="view"></section>`;
		const container = document.querySelector("#view");
		if (view === "map") renderMap(container, concepts, mastery, frontier || [], artifacts, plan);
		else if (view === "lessons") renderLessons(container, plan, concepts, artifacts);
		else if (view === "gallery") renderGallery(container, artifacts);
		else if (view === "review") {
			const cards = await api(`${base}/cards/due`);
			if (token !== generation) return;
			reviewState = { topic, cards, index: 0, revealed: false, busy: false, token, reviewed: 0, choice: -1 };
			renderCard();
		} else if (view === "progress") {
			const reviews = await api(`${base}/reviews`);
			if (token !== generation) return;
			renderProgress(container, concepts, mastery, reviews);
		} else container.innerHTML = empty("This view does not exist. Choose a tab above.");
	} catch (error) {
		if (token === generation) {
			app.innerHTML = `<div class="empty"><h2>Couldn't open this view</h2><p>${escapeHtml(error.message)}</p>
				<button id="retry">Try again</button> <a class="button-link" href="#/">Go home</a></div>`;
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
	const stems = (plan?.lessons || []).filter((l) => l.conceptId === c.id)
		.flatMap((l) => l.visuals || []).map((v) => stem(v.path)).filter(Boolean);
	return artifacts.filter((a) => stems.includes(stem(a.name)) || a.name.includes(c.id));
}
/** Split a title into at most two lines of roughly `max` characters for SVG labels. */
function wrapLabel(text, max = 20) {
	const lines = [""];
	for (const word of String(text).split(/\s+/)) {
		const last = lines.length - 1;
		if (!lines[last]) lines[last] = word;
		else if ((lines[last] + " " + word).length <= max) lines[last] += " " + word;
		else lines.push(word);
	}
	if (lines.length > 2) lines.splice(1, lines.length, lines.slice(1).join(" "));
	return lines.map((line) => line.length > max + 2 ? line.slice(0, max) + "…" : line);
}
const COL = 190, ROW = 138, TOP = 56;
/** Layered prerequisite layout with a barycentre pass so edges cross less often. */
function layoutMap(concepts) {
	const byId = new Map(concepts.map((c) => [c.id, c]));
	const depths = new Map();
	function depth(id, visiting = new Set()) {
		if (depths.has(id)) return depths.get(id);
		if (visiting.has(id) || !byId.has(id)) return -1;
		const next = new Set(visiting).add(id);
		const d = Math.min(concepts.length, Math.max(-1, ...byId.get(id).prerequisites.map((p) => depth(p, next))) + 1);
		depths.set(id, d); return d;
	}
	const layers = [];
	for (const c of concepts) (layers[depth(c.id)] ||= []).push(c);
	const rows = layers.filter(Boolean);
	const width = Math.max(380, ...rows.map((l) => l.length * COL));
	const positions = new Map();
	const place = (layer, level) => layer.forEach((c, i) => positions.set(c.id,
		{ x: (i + 0.5) * width / layer.length, y: TOP + level * ROW }));
	rows.forEach(place);
	for (let pass = 0; pass < 2; pass++) rows.forEach((layer, level) => {
		if (!level) return;
		const key = (c) => {
			const xs = c.prerequisites.map((p) => positions.get(p)?.x).filter((x) => x !== undefined);
			return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : positions.get(c.id).x;
		};
		layer.sort((a, b) => key(a) - key(b));
		place(layer, level);
	});
	return { byId, positions, width, height: TOP + (rows.length - 1) * ROW + 100 };
}
function renderMap(container, concepts, mastery, frontier, artifacts, plan) {
	if (!concepts.length) {
		container.innerHTML = empty("No concept graph yet. Your tutor can create one with /map."); return;
	}
	const available = new Set(frontier.map((c) => typeof c === "string" ? c : c.id));
	const { byId, positions, width, height } = layoutMap(concepts);
	const edges = concepts.flatMap((c) => c.prerequisites.map((p) => {
		const from = positions.get(p), to = positions.get(c.id);
		if (!from) return "";
		const y1 = from.y + 76, y2 = to.y - 36, bend = Math.max(24, (y2 - y1) / 2);
		return `<path class="edge" d="M${from.x} ${y1} C${from.x} ${y1 + bend},${to.x} ${y2 - bend},${to.x} ${y2}"
			marker-end="url(#arrow)"/>`;
	})).join("");
	const nodes = concepts.map((c) => {
		const { x, y } = positions.get(c.id), status = conceptStatus(c, mastery, available);
		const label = wrapLabel(c.title)
			.map((line, i) => `<tspan x="0" dy="${i ? 16 : 0}">${escapeHtml(line)}</tspan>`).join("");
		return `<g class="node ${status}" data-id="${escapeHtml(c.id)}" role="button" tabindex="0"
			aria-label="${escapeHtml(c.title)}, ${status}" transform="translate(${x},${y})"><circle class="halo" r="36"/>
			<circle class="disc" r="28"/><text class="node-symbol" y="7">${status === "mastered" ? "✓" : "✦"}</text>
			<text class="node-label" y="52">${label}</text><title>${escapeHtml(c.title)}</title></g>`;
	}).join("");
	container.innerHTML = `<div class="legend">${["locked", "frontier", "learning", "mastered"]
		.map((s) => `<span class="${s}">● ${s}</span>`).join("")}</div>
		<div class="map-layout"><div class="map-scroll"><svg class="concept-map" width="${width}" height="${height}"
			viewBox="0 0 ${width} ${height}" aria-label="Concept prerequisite map"><defs><marker id="arrow"
			viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
			<path class="arrowhead" d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}</svg></div>
		<aside id="concept-detail" class="panel" aria-live="polite">${empty("Choose a concept to discover its story.")}
		</aside></div>`;
	// Large graphs scroll sideways on phones instead of shrinking labels below legibility (CSSOM is CSP-safe).
	const map = container.querySelector(".concept-map");
	map.style.minWidth = `${Math.min(width, Math.max(340, width * 0.6))}px`;
	map.style.width = "100%"; map.style.maxWidth = `${Math.round(width * 1.25)}px`;
	function select(id) {
		const c = byId.get(id);
		const links = linkedArtifacts(c, artifacts, plan);
		const detail = document.querySelector("#concept-detail");
		const lists = [["Watch out for", c.misconceptions], ["Picture this", c.visualHooks]]
			.map(([label, items]) => items?.length
				? `<h3>${label}</h3><ul>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : "").join("");
		const level = escapeHtml(c.difficulty);
		detail.innerHTML = `<span class="eyebrow">${conceptStatus(c, mastery, available)} · LEVEL ${level}</span>
			<h2>${escapeHtml(c.title)}</h2><p>${escapeHtml(c.summary)}</p>
			${c.intuition ? `<blockquote>${escapeHtml(c.intuition)}</blockquote>` : ""}${lists}<h3>Linked artifacts</h3>
			${links.length ? links.map((a, i) => `<button class="artifact-link" data-artifact="${i}">
				${escapeHtml(pretty(a.name))}
				<small>${kindOf(a)}</small></button>`).join("") : '<p class="muted">No linked visuals yet.</p>'}`;
		detail.querySelectorAll("[data-artifact]").forEach((button) => {
			button.onclick = () => openArtifact(links[Number(button.dataset.artifact)]);
		});
		document.querySelectorAll(".node")
			.forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.id === id)));
		// Below 900px the panel sits under the map; bring the story into view.
		if (matchMedia("(max-width: 900px)").matches) detail.scrollIntoView({ behavior: "smooth", block: "start" });
	}
	container.querySelectorAll(".node").forEach((node) => {
		node.onclick = () => select(node.dataset.id);
		node.onkeydown = (event) => {
			if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(node.dataset.id); }
		};
	});
}
function renderLessons(container, plan, concepts, artifacts) {
	if (!plan?.lessons?.length) {
		container.innerHTML = empty("Your lesson path is waiting to be planned. Use /learn in psi."); return;
	}
	const openable = [];
	const lessons = plan.lessons.map((lesson, i) => {
		const concept = concepts.find((c) => c.id === lesson.conceptId);
		const beats = (lesson.beats || []).map((b) => `<div><span class="eyebrow">${escapeHtml(b.kind)}</span>
			<p>${escapeHtml(b.text)}</p></div>`).join("");
		const visuals = (lesson.visuals || []).map((v) => {
			const a = v.path ? artifacts.find((item) => stem(item.name) === stem(v.path)) : undefined;
			if (a) {
				openable.push(a);
				return `<button class="visual-ref ready" data-open="${openable.length - 1}">
					<strong>▷ ${escapeHtml(v.title)}</strong>
					<span>${escapeHtml(v.goal)}</span></button>`;
			}
			return `<div class="visual-ref"><strong>◇ ${escapeHtml(v.title)}</strong><span>${escapeHtml(v.goal)}</span>
				<small>${escapeHtml(v.kind || "visual")} · planned</small></div>`;
		}).join("");
		return `<li class="panel"><span class="lesson-number">${i + 1}</span><div>
			<span class="badge">${escapeHtml(lesson.status)}</span>
			<h2>${escapeHtml(concept?.title || titleOf(lesson.conceptId))}</h2><p>${escapeHtml(lesson.objective)}</p>
			<div class="beats">${beats}</div>${visuals}</div></li>`;
	}).join("");
	container.innerHTML = `<p class="lead">${escapeHtml(plan.goal)}</p><ol class="lesson-list">${lessons}</ol>`;
	container.querySelectorAll("[data-open]").forEach((b) => {
		b.onclick = () => openArtifact(openable[Number(b.dataset.open)]);
	});
}
function media(a, preview = false) {
	const url = escapeHtml(a.url);
	if (a.type.startsWith("text/html")) {
		return `<iframe src="${url}" sandbox="allow-scripts" title="${escapeHtml(pretty(a.name))}" loading="lazy"
			${preview ? 'tabindex="-1" aria-hidden="true"' : ""}></iframe>`;
	}
	if (a.type.startsWith("video/")) {
		return `<video src="${url}" ${preview ? 'muted preload="metadata"' : "controls autoplay"} playsinline></video>`;
	}
	if (a.type.startsWith("image/")) return `<img src="${url}" alt="${escapeHtml(pretty(a.name))}" loading="lazy">`;
	return `<div class="file-preview">◇<p>${escapeHtml(a.name)}</p></div>`;
}
function renderGallery(container, artifacts) {
	container.innerHTML = `<div class="section-heading"><h2>Ideas you can see</h2>
		<span>${plural(artifacts.length, "artifact")}</span></div>
		<div class="gallery">${artifacts.map((a, i) => `<article class="artifact-card">
			<div class="preview">${media(a, true)}</div>
			<button data-open="${i}"><span>${escapeHtml(pretty(a.name))}</span><span aria-hidden="true">↗</span></button>
			<small>${kindOf(a)} · ${escapeHtml(a.name)}</small></article>`).join("")
			|| empty("No artifacts yet. Create an explainer with /visualize or /explore.")}</div>`;
	container.querySelectorAll("[data-open]").forEach((button) => {
		button.onclick = () => openArtifact(artifacts[Number(button.dataset.open)]);
	});
}
function openArtifact(a) {
	if (!a) return;
	document.querySelector("#lightbox-content").innerHTML = `<h2>${escapeHtml(pretty(a.name))}</h2>
		<div class="lightbox-media">${media(a)}</div>
		<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">
			Open ${escapeHtml(a.name)} in a new tab ↗</a>`;
	dialog.showModal();
}
function closeArtifact() {
	if (dialog.open) dialog.close();
	document.querySelector("#lightbox-content").replaceChildren();
}
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
function renderCard(message = "") {
	const s = reviewState;
	if (!s || s.token !== generation) return;
	const container = document.querySelector("#view");
	const card = s.cards[s.index];
	if (!card) {
		container.innerHTML = `<div class="review-complete panel"><span class="completion-star">✦</span>
			<h2>${s.reviewed ? "A little stronger, a little clearer." : "You're all caught up."}</h2>
			<p>${plural(s.reviewed, "card")} reviewed. Come back when your next cards are due.</p>
			<p role="status">${escapeHtml(message)}</p>
			<a class="button" href="${topicPath(s.topic, "progress")}">See your progress →</a></div>`;
		return;
	}
	const choices = card.kind === "mcq" ? `<div class="choices">${(card.choices || []).map((choice, i) => {
		const state = !s.revealed ? "" : same(choice, card.answer) ? "correct" : i === s.choice ? "wrong" : "";
		const verdict = state === "correct" ? '<span class="verdict">✓ answer</span>'
			: state === "wrong" ? '<span class="verdict">your pick</span>' : "";
		return `<button data-choice="${i}" class="${state}" ${s.revealed ? "disabled" : ""}>
			${escapeHtml(choice)}${verdict}</button>`;
	}).join("")}</div>` : "";
	const ratings = ["Again", "Hard", "Good", "Easy"].map((label, i) => `<button data-rating="${i + 1}"
		${s.busy ? "disabled" : ""}>
		<strong>${label}</strong><small>${i + 1}</small></button>`).join("");
	container.innerHTML = `<div class="review-wrap"><div class="section-heading">
		<span>${s.index + 1} / ${plural(s.cards.length, "card")}</span>
		<span class="badge">${escapeHtml(card.kind)}</span></div><article class="flashcard panel">
		<span class="eyebrow">${escapeHtml(titleOf(card.conceptId))}</span><h2>${escapeHtml(card.prompt)}</h2>${choices}
		${s.revealed ? `<div class="answer"><span class="eyebrow">ANSWER</span><p>${escapeHtml(card.answer)}</p>
			<p class="muted">How well did you remember? Rate your recall.</p></div><div class="ratings">${ratings}</div>`
			: '<button id="reveal" class="primary">Reveal answer <small>Space</small></button>'}</article>
		<p class="review-message" role="status">${escapeHtml(message)}</p></div>`;
	container.querySelector("#reveal")?.addEventListener("click", () => { s.revealed = true; renderCard(); });
	container.querySelectorAll("[data-choice]").forEach((button) => {
		button.onclick = () => {
			s.revealed = true; s.choice = Number(button.dataset.choice);
			renderCard(same(card.choices[s.choice], card.answer)
				? "Correct! Now rate how easy it felt." : "Not quite — compare with the answer.");
		};
	});
	container.querySelectorAll("[data-rating]").forEach((button) => {
		button.onclick = () => submitRating(Number(button.dataset.rating));
	});
	if (s.revealed) container.querySelector(".ratings")?.scrollIntoView({ block: "nearest" });
}
async function submitRating(rating) {
	const s = reviewState;
	if (!s || !s.revealed || s.busy || !s.cards[s.index]) return;
	s.busy = true; renderCard();
	try {
		const card = s.cards[s.index];
		ownWriteUntil = Date.now() + 2000;
		const updated = await api(`/api/topics/${enc(s.topic)}/cards/${enc(card.id)}/review`, {
			method: "POST", headers: { "Content-Type": "application/json", "X-Psi": "1" }, body: JSON.stringify({ rating }),
		});
		ownWriteUntil = Date.now() + 1000;
		if (s.token !== generation) return;
		const days = Math.max(0, (Date.parse(updated.fsrs.due) - Date.now()) / 86400000);
		const interval = days < 1 ? plural(Math.max(1, Math.round(days * 1440)), "minute") : plural(Math.round(days), "day");
		s.index++; s.reviewed++; s.revealed = false; s.busy = false; s.choice = -1;
		renderCard(`Saved · Next review in ${interval}.`);
	} catch (error) { if (s.token === generation) { s.busy = false; renderCard(error.message); } }
}
function dayKey(date) {
	const two = (n) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
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
		const key = dayKey(date), count = counts.get(key) || 0, label = `${key}: ${plural(count, "review")}`;
		return `<div class="heat-day level-${Math.min(4, count)}" role="img" aria-label="${label}" title="${label}"></div>`;
	}).join("");
	const mastered = concepts.filter((c) => (mastery[c.id]?.pKnown || 0) >= 0.95).length;
	const rows = concepts.map((c) => {
		const m = mastery[c.id], value = pct(m?.pKnown);
		return `<div class="mastery-row"><div><span>${escapeHtml(c.title)}</span>
			<small>${value}% · ${plural(m?.attempts || 0, "attempt")}</small>
			</div><progress value="${value}" max="100" aria-label="${escapeHtml(c.title)} mastery">${value}%</progress></div>`;
	}).join("");
	container.innerHTML = `<div class="stats">
		<div class="panel"><strong>${streak}</strong><span>day review streak</span></div>
		<div class="panel"><strong>${reviews.length}</strong><span>retrievals practiced</span></div>
		<div class="panel"><strong>${mastered}/${concepts.length}</strong><span>concepts mastered</span></div></div>
		<section class="panel"><div class="section-heading"><h2>A little, often</h2>
		<span>Last 13 weeks · local dates</span></div><div class="heatmap">${days}</div>
		<p class="muted">Each square is a day. Brighter means more retrieval practice.</p></section>
		<section class="panel mastery-panel"><h2>Your growing understanding</h2>
		${rows || empty("No concepts to measure yet.")}</section>`;
}

let events;
let mounted;
let shellGeneration = 0;
let sharedApi;
const navigate = (hash) => {
	if (location.hash === hash) void renderRoute();
	else location.hash = hash;
};
const closeDrawer = () => {
	document.body.classList.remove("psi-drawer-open");
	document.querySelector("#menu-toggle").setAttribute("aria-expanded", "false");
};
async function refreshChrome() {
	const token = ++shellGeneration;
	const client = sharedApi || (await import("./js/api.js").catch(() => null))?.api;
	if (!client || token !== shellGeneration) return;
	sharedApi = client;
	const list = async (path, selector, build, fallback) => {
		const el = document.querySelector(selector);
		try {
			const items = await client.get(path);
			if (token !== shellGeneration) return;
			el.replaceChildren();
			const nodes = await Promise.all(items.map(build));
			if (token !== shellGeneration) return;
			el.append(...nodes);
			if (!items.length) el.textContent = fallback;
		} catch { if (token === shellGeneration) el.textContent = "Unavailable right now"; }
	};
	const link = (text, href) => {
		const a = document.createElement("a"); a.textContent = text; a.href = href; return a;
	};
	await Promise.allSettled([
		list("/api/chat", "#saved-chats", (c) => link(c.title || "Untitled chat", `#/chat/${enc(c.id)}`),
			"Your next conversation starts here."),
		list("/api/skills", "#sidebar-skills", async (s) => {
			const slug = typeof s === "string" ? s : s.skill;
			const detail = typeof s === "string" ? await client.get(`/api/skills/${enc(slug)}`).catch(() => ({})) : s;
			const a = link(detail.plan?.title || detail.title || titleOf(slug), `#/skills/${enc(slug)}`);
			const p = detail.progress || {};
			const bar = formatBars(p);
			const small = document.createElement("small");
			small.textContent = `Level ${bar.level} · ${bar.hours}h`;
			const progress = document.createElement("progress");
			progress.max = 100; progress.value = bar.hoursPercent;
			progress.setAttribute("aria-label", `${titleOf(slug)} practice hours`);
			const levelProgress = document.createElement("progress");
			levelProgress.max = 100; levelProgress.value = bar.levelPercent;
			levelProgress.setAttribute("aria-label", `${titleOf(slug)} level progress`);
			a.append(small, levelProgress, progress); return a;
		}, "Build your first skill."),
		list("/api/topics", "#sidebar-topics", (t) => link(t.title, topicPath(t.topic, "map")), "No topics yet."),
		(async () => {
			const hud = document.querySelector("#skill-hud");
			try {
				const state = await client.get("/api/state");
				const data = state.activeSkill ? await client.get(`/api/skills/${enc(state.activeSkill)}`) : {};
				if (token !== shellGeneration) return;
				const bars = formatBars(data.progress);
				hud.innerHTML = `<span class="psi-hud-skill">${escapeHtml(data.plan?.title || state.activeSkill || "Ready to learn")}</span>
					<span class="psi-hud-level">Level ${bars.level}<progress max="100" value="${bars.levelPercent}"
					aria-label="Level progress">${bars.levelPercent}%</progress></span>
					<span>🔥 ${escapeHtml(data.progress?.streakDays || 0)}</span><span>${bars.hours}h</span>`;
			} catch { if (token === shellGeneration) hud.textContent = "Your progress will appear here · Level 1 · 🔥 0 · 0/20h"; }
		})(),
	]);
	if (token === shellGeneration) document.querySelectorAll("#sidebar a").forEach((a) => {
		if (a.hash === location.hash) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
	});
}
async function renderRoute() {
	closeDrawer(); closeArtifact();
	mounted?.destroy?.(); mounted = undefined;
	const token = ++generation;
	reviewState = undefined;
	const parsed = parseRoute(location.hash);
	void refreshChrome();
	if (parsed.route === "topic" || parsed.route === "topics") return render();
	app.replaceChildren();
	const host = document.createElement("div"); app.append(host);
	host.innerHTML = empty("Opening your learning space…");
	document.title = "ψ Studio · Learn by doing";
	app.setAttribute("aria-busy", "true");
	try {
		let view;
		if (parsed.route === "home") {
			const { mountHome } = await import("./js/home.js");
			if (token !== generation) return;
			view = mountHome(host, { navigate });
		} else if (parsed.route === "memory") {
			const { mountMemory } = await import("./js/memory.js");
			if (token !== generation) return;
			view = mountMemory(host);
		} else if (parsed.route === "skill") {
			const { mountPractice } = await import("./js/practice.js");
			if (token !== generation) return;
			view = mountPractice(host, { skill: parsed.params.skill, navigate });
		} else if (parsed.route === "chat" || parsed.route === "new") {
			const { api: client } = await import("./js/api.js");
			const { mountChat } = await import("./js/chat.js");
			if (token !== generation) return;
			let chatId = parsed.params.chatId;
			if (parsed.route === "new") {
				host.innerHTML = empty("Starting a conversation…");
				const { skill, topic, prompt } = parsed.params;
				const created = await client.post("/api/chat", { ...(skill && { skill }), ...(topic && { topic }) });
				chatId = created.id;
				// Seed before mounting SSE; the chat endpoint replays its saved records on connection.
				if (prompt) await client.post(`/api/chat/${enc(chatId)}/prompt`, { message: prompt });
				if (token !== generation) return;
				history.replaceState(null, "", `#/chat/${enc(chatId)}`);
				void refreshChrome();
			}
			view = await mountChat(host, { chatId, skill: parsed.params.skill, topic: parsed.params.topic,
				onChatCreated: (id) => navigate(`#/chat/${enc(id)}`) });
		} else host.innerHTML = empty("This page does not exist. Choose a view in the sidebar.");
		if (token === generation) mounted = view;
		else view?.destroy?.();
	} catch (error) {
		if (token === generation) {
			host.innerHTML = `<div class="empty"><h2>Couldn't open this view</h2><p>${escapeHtml(error.message)}</p>
				<button id="shell-retry">Try again</button></div>`;
			host.querySelector("#shell-retry").onclick = renderRoute;
		}
	} finally { if (token === generation) app.removeAttribute("aria-busy"); }
}
document.querySelector("#close-lightbox").onclick = closeArtifact;
dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeArtifact(); });
dialog.addEventListener("click", (event) => { if (event.target === dialog) closeArtifact(); });
document.querySelector("#menu-toggle").onclick = () => {
	const open = document.body.classList.toggle("psi-drawer-open");
	document.querySelector("#menu-toggle").setAttribute("aria-expanded", String(open));
};
document.querySelector("#drawer-shade").onclick = closeDrawer;
document.querySelector("#sidebar").addEventListener("click", (event) => {
	if (event.target.closest("a")) closeDrawer();
});
document.querySelector(".psi-skip").onclick = (event) => { event.preventDefault(); app.focus(); };
window.addEventListener("hashchange", () => { void renderRoute(); });
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape") closeDrawer();
	if (dialog.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
	if (event.altKey || event.ctrlKey || event.metaKey) return;
	if (reviewState && event.code === "Space" && !reviewState.revealed && reviewState.cards[reviewState.index]) {
		event.preventDefault(); reviewState.revealed = true; renderCard();
	} else if (reviewState && /^[1-4]$/.test(event.key)) { event.preventDefault(); void submitRating(Number(event.key)); }
});
events = new EventSource("/api/events");
events.onopen = () => setConnection("● Live");
events.onerror = () => setConnection("Reconnecting…");
events.addEventListener("changed", () => {
	void refreshChrome();
	if (Date.now() < ownWriteUntil) return;
	if (reviewState) { setConnection("● Updates ready"); return; }
	// Keep live conversations and form drafts intact during filesystem updates.
	if (["topic", "topics"].includes(parseRoute(location.hash).route)) void render();
});
window.addEventListener("focus", () => { void refreshChrome(); });
void renderRoute();
}

if (typeof document !== "undefined") {
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
	else init();
}
