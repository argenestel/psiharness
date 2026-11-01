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
		if (first === "memory" || first === "topics" || first === "you") return { route: first, params: {} };
		if (first === "paths") return { route: "paths", params: second ? { id: second } : {} };
		// Node ids may contain "/" (subskill:sql-lab/joins); rejoin in case the id arrived unencoded.
		if (first === "graph") return { route: "graph", params: { nodeId: parts.slice(1).join("/") } };
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

/** Chats newest first by updatedAt (unparseable dates last), stable for ties. */
export function sortChats(chats) {
	const time = (c) => { const t = Date.parse(c?.updatedAt ?? ""); return Number.isFinite(t) ? t : -Infinity; };
	return (Array.isArray(chats) ? chats : []).map((c, i) => [c, i])
		.sort(([a, i], [b, j]) => time(b) - time(a) || i - j).map(([c]) => c);
}

/** Routes whose layout includes the progress bench (only when a skill is active). */
export function benchRoute(route) {
	return route === "home" || route === "chat" || route === "new";
}

/** The shell's own route key for #app[data-route]: chat and new share the full-height chat layout. */
export function layoutRoute(route) {
	return route === "new" ? "chat" : route;
}

/** Concept-map node state from BKT mastery and the frontier. */
export function conceptStatus(concept, mastery = {}, available = new Set()) {
	if ((mastery[concept.id]?.pKnown || 0) >= 0.95) return "mastered";
	if (mastery[concept.id]?.attempts > 0) return "learning";
	return available.has(concept.id) ? "frontier" : "locked";
}

/** True when a view's script couldn't be loaded (psi web restarted or went offline), not when the view failed. */
export function isModuleLoadError(error) {
	return /dynamically imported module|importing a module script failed|error loading dynamically imported|module script/i
		.test(String(error?.message ?? error ?? ""));
}

const CHAT_LIMIT = 12;

function init() {
const app = /** @type {HTMLElement} */ (document.querySelector("#app"));
const dialog = /** @type {HTMLDialogElement} */ (document.querySelector("#lightbox"));
const connection = /** @type {HTMLElement} */ (document.querySelector("#connection"));
const benchEl = /** @type {HTMLElement} */ (document.querySelector("#bench"));
const benchToggle = /** @type {HTMLButtonElement} */ (document.querySelector("#bench-toggle"));
const menuToggle = /** @type {HTMLButtonElement} */ (document.querySelector("#menu-toggle"));
const shade = /** @type {HTMLElement} */ (document.querySelector("#drawer-shade"));
let generation = 0;
let reviewState;
// Our own review writes echo back as filesystem change events; do not report those as external updates.
let ownWriteUntil = 0;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const enc = encodeURIComponent;
const titleOf = (id) => String(id).replace(/[-_]+/g, " ");
const capital = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const empty = (text) => `<p class="empty">${escapeHtml(text)}</p>`;
const pct = (n) => Math.round(Math.min(1, Math.max(0, n || 0)) * 100);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A rule track with a highlighter fill (a native <progress>: no inline styles, which the CSP forbids). */
const meter = (value, label, thin = true) => `<progress class="psi-meter${thin ? " is-thin" : ""}" max="100" value="${value}"
	aria-label="${escapeHtml(label)}">${value}%</progress>`;
/** File name without directories or extension, used to match plan visuals to rendered artifacts. */
const stem = (path) => /** @type {string} */ (String(path || "").split("/").pop()).replace(/\.[^.]+$/, "");
const pretty = (name) => capital(titleOf(stem(name)).trim()) || name;
const kindOf = (a) => a.type.startsWith("text/html") ? "Interactive page" : a.type.startsWith("video/") ? "Video"
	: a.type.startsWith("image/") ? "Image" : "File";

try {
	const theme = localStorage.getItem("psi-theme");
	if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch { /* Storage can be blocked; the system theme still applies. */ }
// The game layer this browser last used, applied before anything renders; the profile (GET /api/me) confirms it.
try {
	const game = localStorage.getItem("psi-game");
	document.documentElement.dataset.game = game === "quiet" || game === "off" ? game : "on";
} catch { document.documentElement.dataset.game = "on"; }

function setConnection(text, isError = false) {
	connection.textContent = text;
	connection.hidden = !text;
	connection.classList.toggle("is-error", isError);
}

let uiModule;
const ui = () => uiModule ??= import("./js/ui.js");

async function api(path, options) {
	const response = await fetch(path, options);
	let data;
	try { data = await response.json(); } catch { data = {}; }
	if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
	return data;
}
function route() {
	const parsed = parseRoute(location.hash);
	return { topic: parsed.params.topic || "", view: parsed.params.view || "map" };
}
function topicPath(topic, view) { return `#/${enc(topic)}/${view}`; }
/** A topic's display name: its graph title, or the slug in words when the tutor hasn't titled it yet. */
const topicTitle = (t) => t.title && t.title !== t.topic ? t.title : capital(titleOf(t.topic));
function topicRow(t) {
	const progress = t.concepts ? pct(t.mastered / t.concepts) : 0;
	const title = topicTitle(t);
	const meta = t.concepts ? `${t.mastered} of ${plural(t.concepts, "concept")} mastered${t.due
		? `, ${t.due} ${t.due === 1 ? "card" : "cards"} due` : ""}` : "Notes only, no concept map yet";
	return `<li><div><h3><a href="${topicPath(t.topic, "map")}">${escapeHtml(title)}</a></h3>
		${t.bigIdea ? `<p>${escapeHtml(t.bigIdea)}</p>` : ""}
		<p class="psi-row-meta">${meta}</p>
		${progress > 0 ? meter(progress, `${title}: ${progress}% mastered`) : ""}</div>
		${t.due ? `<a class="button psi-row-action" href="${topicPath(t.topic, "review")}">Review</a>` : ""}</li>`;
}
const VIEWS = [["map", "Map"], ["lessons", "Lessons"], ["gallery", "Gallery"], ["review", "Review"], ["progress", "Progress"]];
async function render() {
	const token = ++generation;
	const { topic, view } = route();
	reviewState = undefined;
	app.dataset.route = "concepts";
	setBenchAvailable(false);
	app.setAttribute("aria-busy", "true");
	try {
		if (!topic) {
			const topics = await api("/api/topics");
			if (token !== generation) return;
			document.title = "Concepts · psi";
			setTopbar("Concepts");
			app.innerHTML = `<div class="psi-view psi-concepts"><header><h1>Concepts</h1>
				<p>Concept maps, lessons and review cards your tutor has built with <code>/learn</code>.</p></header>
				${topics.length ? `<ul class="psi-rows">${topics.map(topicRow).join("")}</ul>`
					: empty("No concept maps yet. Start a chat and ask psi to explain a concept.")}</div>`;
			return;
		}
		const base = `/api/topics/${enc(topic)}`;
		const [detail, artifacts] = await Promise.all([api(base), api(`${base}/artifacts`)]);
		if (token !== generation) return;
		const { graph, plan, learner, frontier } = detail;
		const concepts = graph?.concepts || [];
		const mastery = learner?.mastery || {};
		const title = graph?.title || capital(titleOf(topic));
		document.title = `${title} · psi`;
		setTopbar(title);
		app.innerHTML = `<div class="psi-view psi-concepts"><a class="psi-back" href="#/topics">All concepts</a>
			<header><h1>${escapeHtml(title)}</h1>${graph?.bigIdea ? `<p>${escapeHtml(graph.bigIdea)}</p>` : ""}</header>
			<nav class="psi-tabs" aria-label="Topic views">${VIEWS.map(([id, label]) => `<a href="${topicPath(topic, id)}"
				${id === view ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav><section id="view"></section></div>`;
		const container = /** @type {HTMLElement} */ (document.querySelector("#view"));
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
		} else container.innerHTML = empty("This view doesn't exist. Pick a tab above.");
	} catch (error) {
		if (token === generation) {
			app.innerHTML = `<div class="psi-view empty"><h2>Couldn't open this page</h2><p>${escapeHtml(error.message)}</p>
				<button id="retry" type="button">Try again</button> <a class="button-link" href="#/">Go home</a></div>`;
			(/** @type {HTMLButtonElement} */ (document.querySelector("#retry"))).onclick = render;
		}
	} finally { if (token === generation) app.removeAttribute("aria-busy"); }
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
const COL = 180, ROW = 128, TOP = 48;
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
	const width = Math.max(360, ...rows.map((l) => l.length * COL));
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
	return { byId, positions, width, height: TOP + (rows.length - 1) * ROW + 90 };
}
function renderMap(container, concepts, mastery, frontier, artifacts, plan) {
	if (!concepts.length) {
		container.innerHTML = empty("No concept map yet. Ask your tutor for one with /map."); return;
	}
	const available = new Set(frontier.map((c) => typeof c === "string" ? c : c.id));
	const { byId, positions, width, height } = layoutMap(concepts);
	const edges = concepts.flatMap((c) => c.prerequisites.map((p) => {
		const from = positions.get(p), to = positions.get(c.id);
		if (!from) return "";
		const y1 = from.y + 62, y2 = to.y - 24, bend = Math.max(20, (y2 - y1) / 2);
		return `<path class="edge" d="M${from.x} ${y1} C${from.x} ${y1 + bend},${to.x} ${y2 - bend},${to.x} ${y2}"
			marker-end="url(#arrow)"/>`;
	})).join("");
	const nodes = concepts.map((c) => {
		const { x, y } = positions.get(c.id), status = conceptStatus(c, mastery, available);
		const label = wrapLabel(c.title)
			.map((line, i) => `<tspan x="0" dy="${i ? 16 : 0}">${escapeHtml(line)}</tspan>`).join("");
		return `<g class="node ${status}" data-id="${escapeHtml(c.id)}" role="button" tabindex="0"
			aria-label="${escapeHtml(c.title)}, ${status}" transform="translate(${x},${y})"><circle class="halo" r="22"/>
			<circle class="disc" r="16"/>${status === "learning" ? '<path class="half" d="M0 -16 A16 16 0 0 1 0 16 Z"/>' : ""}
			<text class="node-label" y="38">${label}</text><title>${escapeHtml(c.title)}</title></g>`;
	}).join("");
	container.innerHTML = `<div class="psi-concepts"><p class="psi-legend">${["locked", "frontier", "learning", "mastered"]
		.map((s) => `<span class="${s}"><i aria-hidden="true"></i>${s === "frontier" ? "ready to learn" : s}</span>`).join("")}</p>
		<div class="psi-map-layout"><div class="psi-map-scroll"><svg class="concept-map" width="${width}" height="${height}"
			viewBox="0 0 ${width} ${height}" aria-label="Concept prerequisite map"><defs><marker id="arrow"
			viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
			<path class="arrowhead" d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}</svg></div>
		<aside id="concept-detail" class="psi-concept-detail" aria-live="polite">${empty("Pick a concept on the map to read about it.")}
		</aside></div></div>`;
	// Large graphs scroll sideways on phones instead of shrinking labels below legibility (CSSOM is CSP-safe).
	const map = container.querySelector(".concept-map");
	map.style.minWidth = `${Math.min(width, Math.max(320, width * 0.6))}px`;
	map.style.width = "100%"; map.style.maxWidth = `${Math.round(width * 1.25)}px`;
	function select(id) {
		const c = byId.get(id);
		const links = linkedArtifacts(c, artifacts, plan);
		const detail = /** @type {HTMLElement} */ (document.querySelector("#concept-detail"));
		const lists = [["Watch out for", c.misconceptions], ["Picture this", c.visualHooks]]
			.map(([label, items]) => items?.length
				? `<h3>${label}</h3><ul>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : "").join("");
		const status = conceptStatus(c, mastery, available);
		detail.innerHTML = `<h2>${escapeHtml(c.title)}</h2>
			<p class="psi-row-meta">${capital(status === "frontier" ? "ready to learn" : status)}, difficulty ${escapeHtml(c.difficulty)} of 5</p>
			<p>${escapeHtml(c.summary)}</p>
			${c.intuition ? `<blockquote>${escapeHtml(c.intuition)}</blockquote>` : ""}${lists}
			${links.length ? `<h3>Visuals</h3>${links.map((a, i) => `<button class="psi-artifact-link" type="button" data-artifact="${i}">
				${escapeHtml(pretty(a.name))}<small>${kindOf(a)}</small></button>`).join("")}` : ""}`;
		/** @type {NodeListOf<HTMLButtonElement>} */ (detail.querySelectorAll("[data-artifact]")).forEach((button) => {
			button.onclick = () => openArtifact(links[Number(button.dataset.artifact)]);
		});
		/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".node"))
			.forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.id === id)));
		if (matchMedia("(max-width: 767px)").matches) detail.scrollIntoView({ block: "start" });
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
		container.innerHTML = empty("No lessons planned yet. Ask your tutor to plan them with /learn."); return;
	}
	const openable = [];
	const lessons = plan.lessons.map((lesson) => {
		const concept = concepts.find((c) => c.id === lesson.conceptId);
		const beats = (lesson.beats || []).map((b) => `<li><strong>${escapeHtml(capital(String(b.kind)))}</strong>
			${escapeHtml(b.text)}</li>`).join("");
		const visuals = (lesson.visuals || []).map((v) => {
			const a = v.path ? artifacts.find((item) => stem(item.name) === stem(v.path)) : undefined;
			if (a) {
				openable.push(a);
				return `<button type="button" data-open="${openable.length - 1}" title="${escapeHtml(v.goal)}">
					Open ${escapeHtml(v.title)}</button>`;
			}
			return `<span>${escapeHtml(v.title)} (planned)</span>`;
		}).join("");
		return `<li><div><p class="psi-row-meta">${escapeHtml(capital(String(lesson.status || "planned")))}</p>
			<h2>${escapeHtml(concept?.title || capital(titleOf(lesson.conceptId)))}</h2>
			<p class="psi-objective">${escapeHtml(lesson.objective)}</p>
			${beats ? `<ul class="psi-beats">${beats}</ul>` : ""}${visuals ? `<div class="psi-visuals">${visuals}</div>` : ""}</div></li>`;
	}).join("");
	container.innerHTML = `<div class="psi-concepts">${plan.goal ? `<p>${escapeHtml(plan.goal)}</p>` : ""}
		<ol class="psi-lessons">${lessons}</ol></div>`;
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
	return `<div class="file-preview"><p>${escapeHtml(a.name)}</p></div>`;
}
function renderGallery(container, artifacts) {
	container.innerHTML = artifacts.length ? `<ul class="psi-gallery">${artifacts.map((a, i) => `<li>
			<div class="preview">${media(a, true)}</div>
			<button type="button" data-open="${i}">${escapeHtml(pretty(a.name))}</button>
			<small>${kindOf(a)}, ${escapeHtml(a.name)}</small></li>`).join("")}</ul>`
		: empty("No visuals yet. Ask your tutor to /visualize or /explore an idea.");
	container.querySelectorAll("[data-open]").forEach((button) => {
		button.onclick = () => openArtifact(artifacts[Number(button.dataset.open)]);
	});
}
function openArtifact(a) {
	if (!a) return;
	(/** @type {HTMLElement} */ (document.querySelector("#lightbox-content"))).innerHTML = `<h2>${escapeHtml(pretty(a.name))}</h2>
		<div class="lightbox-media">${media(a)}</div>
		<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a>`;
	dialog.showModal();
}
function closeArtifact() {
	if (dialog.open) dialog.close();
	(/** @type {HTMLElement} */ (document.querySelector("#lightbox-content"))).replaceChildren();
}
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
function renderCard(message = "") {
	const s = reviewState;
	if (!s || s.token !== generation) return;
	const container = /** @type {HTMLElement} */ (document.querySelector("#view"));
	const card = s.cards[s.index];
	if (!card) {
		container.innerHTML = `<div class="psi-review"><h2>${s.reviewed ? "Review done" : "Nothing due right now"}</h2>
			<p>${s.reviewed ? `You reviewed ${plural(s.reviewed, "card")}.` : "You're caught up."} Come back when the next cards are due.</p>
			<p class="psi-review-message" role="status">${escapeHtml(message)}</p>
			<a class="button" href="${topicPath(s.topic, "progress")}">See progress</a></div>`;
		return;
	}
	const choices = card.kind === "mcq" ? `<div class="psi-choices">${(card.choices || []).map((choice, i) => {
		const state = !s.revealed ? "" : same(choice, card.answer) ? "correct" : i === s.choice ? "wrong" : "";
		const verdict = state === "correct" ? '<span class="verdict">Answer</span>'
			: state === "wrong" ? '<span class="verdict">Your pick</span>' : "";
		return `<button type="button" data-choice="${i}" class="${state}" ${s.revealed ? "disabled" : ""}>
			<span>${escapeHtml(choice)}</span>${verdict}</button>`;
	}).join("")}</div>` : "";
	const ratings = ["Again", "Hard", "Good", "Easy"].map((label, i) => `<button type="button" data-rating="${i + 1}"
		${s.busy ? "disabled" : ""}>${label}<small>Key ${i + 1}</small></button>`).join("");
	container.innerHTML = `<div class="psi-review"><p class="psi-review-count">Card ${s.index + 1} of ${s.cards.length}</p>
		<article class="psi-flashcard"><p class="psi-row-meta">${escapeHtml(capital(titleOf(card.conceptId)))}</p>
		<h2>${escapeHtml(card.prompt)}</h2>${choices}
		${s.revealed ? `<div class="psi-answer"><strong>Answer</strong><p>${escapeHtml(card.answer)}</p>
			<p class="muted">How well did you remember it?</p><div class="psi-ratings">${ratings}</div></div>`
			: '<div><button id="reveal" type="button" class="primary">Show answer</button></div>'}</article>
		<p class="psi-review-message" role="status">${escapeHtml(message)}</p></div>`;
	container.querySelector("#reveal")?.addEventListener("click", () => { s.revealed = true; renderCard(); });
	/** @type {NodeListOf<HTMLButtonElement>} */ (container.querySelectorAll("[data-choice]")).forEach((button) => {
		button.onclick = () => {
			s.revealed = true; s.choice = Number(button.dataset.choice);
			renderCard(same(card.choices[s.choice], card.answer)
				? "Right. Now rate how easy it felt." : "Not this time. Compare with the answer, then rate it.");
		};
	});
	/** @type {NodeListOf<HTMLButtonElement>} */ (container.querySelectorAll("[data-rating]")).forEach((button) => {
		button.onclick = () => submitRating(Number(button.dataset.rating));
	});
	if (s.revealed) container.querySelector(".psi-ratings")?.scrollIntoView({ block: "nearest" });
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
		renderCard(`Saved. You'll see that card again in ${interval}.`);
	} catch (error) { if (s.token === generation) { s.busy = false; renderCard(`Couldn't save that rating. ${error.message}`); } }
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
		const attempts = m?.attempts || 0;
		return `<li><span>${escapeHtml(c.title)}</span><span>${attempts ? `${value}%, ${plural(attempts, "attempt")}` : "Not started"}</span>
			${value > 0 ? meter(value, `${c.title} mastery`) : ""}</li>`;
	}).join("");
	container.innerHTML = `<div class="psi-concepts"><div class="psi-stats">
		<div><strong>${streak}</strong><span>${streak === 1 ? "day" : "days"} in a row</span></div>
		<div><strong>${reviews.length}</strong><span>cards reviewed</span></div>
		<div><strong>${mastered} of ${concepts.length}</strong><span>concepts mastered</span></div></div>
		<section class="psi-progress-section"><h2>Reviews, last 13 weeks</h2><div class="psi-heatmap">${days}</div>
		<p class="muted">Each square is a day. The more yellow, the more cards you reviewed.</p></section>
		<section class="psi-progress-section"><h2>Mastery by concept</h2>
		${rows ? `<ul class="psi-mastery">${rows}</ul>` : empty("No concepts to measure yet.")}</section></div>`;
}

/* ---------- Shell: sidebar, top bar, bench, routing ---------- */
let events;
let mounted;
let bench;
let benchWanted = false;
let shellGeneration = 0;
let sharedApi;
let offlineRetried = false;
const navigate = (hash) => {
	if (location.hash === hash) void renderRoute();
	else location.hash = hash;
};
function syncShade() {
	const open = document.body.classList.contains("psi-drawer-open") || document.body.classList.contains("psi-bench-open");
	shade.hidden = !open;
}
const closeDrawer = () => {
	document.body.classList.remove("psi-drawer-open");
	menuToggle.setAttribute("aria-expanded", "false");
	syncShade();
};
const closeBench = () => {
	const wasOpen = document.body.classList.contains("psi-bench-open");
	document.body.classList.remove("psi-bench-open");
	benchToggle.setAttribute("aria-expanded", "false");
	syncShade();
	if (wasOpen && !benchToggle.hidden) benchToggle.focus();
};
function setTopbar(title, sub = "") {
	(/** @type {HTMLElement} */ (document.querySelector("#topbar-title"))).textContent = title || "psi";
	const subEl = /** @type {HTMLElement} */ (document.querySelector("#topbar-sub"));
	subEl.textContent = sub; subEl.hidden = !sub;
}
/** The bench column shows only on bench routes with an active skill. */
function setBenchAvailable(available) {
	const show = Boolean(available && benchWanted);
	document.body.dataset.bench = show ? "on" : "off";
	benchToggle.hidden = !show;
	if (!show) closeBench();
}
function ensureBench() {
	if (bench) return;
	bench = { pending: true };
	import("./js/bench.js").then(({ mountBench }) => {
		bench = mountBench(benchEl, {
			onChange: (has) => { setBenchAvailable(has); void topbarForSkill(); },
			onClose: closeBench,
		});
	}).catch(() => { bench = undefined; setBenchAvailable(false); });
}
async function topbarForSkill() {
	const route = parseRoute(location.hash).route;
	if (!benchRoute(route) || !bench?.skill || !sharedApi) return;
	try {
		const data = await sharedApi.get(`/api/skills/${enc(bench.skill)}`);
		if (!benchRoute(parseRoute(location.hash).route)) return;
		const { formatLevel, gameRules, currentGameLayer } = await ui();
		// Under the skill name, so "Skill level 4" is this skill's level; hidden when the game layer is off.
		setTopbar(data.plan?.title || capital(titleOf(bench.skill)),
			gameRules(currentGameLayer()).numbers ? formatLevel(data.progress?.xp).skillLabel : "");
	} catch { /* The top bar keeps its last title. */ }
}
function link(href, title, meta) {
	const a = document.createElement("a");
	a.className = "psi-nav-row"; a.href = href;
	const t = document.createElement("span"); t.className = "psi-row-title"; t.textContent = title; a.append(t);
	if (meta) {
		// A hidden comma keeps "Mental math, Level 2" apart in text and the accessible name (the grid hides the gap).
		const gap = document.createElement("span"); gap.className = "psi-sr-only"; gap.textContent = ", ";
		const m = document.createElement("span"); m.className = "psi-row-meta"; m.textContent = meta; a.append(gap, m);
	}
	return a;
}
function note(text) {
	const p = document.createElement("p"); p.className = "psi-nav-note"; p.textContent = text; return p;
}
async function refreshChrome() {
	const token = ++shellGeneration;
	const client = sharedApi || (await import("./js/api.js").catch(() => null))?.api;
	if (!client || token !== shellGeneration) return;
	sharedApi = client;
	const { relativeTime, chatTitle, formatLevel, hoursLabel } = await ui();
	const fill = async (selector, load, build, fallback) => {
		const el = document.querySelector(selector);
		try {
			const items = await load();
			if (token !== shellGeneration) return;
			const nodes = await Promise.all(items.map(build));
			if (token !== shellGeneration) return;
			el.replaceChildren(...(nodes.length ? nodes : [note(fallback)]));
		} catch {
			// Keep what the list showed; the one "Reconnecting to psi…" line under the sidebar covers the outage.
			if (token === shellGeneration && !el.querySelector("a")) el.replaceChildren();
		}
	};
	await Promise.allSettled([
		fill("#saved-chats", async () => sortChats(await client.get("/api/chat")).slice(0, CHAT_LIMIT),
			(c) => link(`#/chat/${enc(c.id)}`, chatTitle(c.title || "New chat"), relativeTime(c.updatedAt)),
			"No chats yet."),
		fill("#sidebar-skills", () => client.get("/api/skills"), async (s) => {
			const slug = typeof s === "string" ? s : s.skill;
			const detail = typeof s === "string" ? await client.get(`/api/skills/${enc(slug)}`).catch(() => ({})) : s;
			const title = detail.plan?.title || detail.title || capital(titleOf(slug));
			const p = detail.progress || {};
			const a = link(`#/skills/${enc(slug)}`, title, formatLevel(p.xp).label);
			a.classList.add("psi-skill-row");
			// The row's level is game layer: hidden (with its separator) when the learner turns the layer off.
			a.querySelectorAll(".psi-row-meta, .psi-sr-only").forEach((n) => n.classList.add("psi-game"));
			// The hours fill appears only once there are hours to show; an empty track reads as an underline.
			if (Number(p.minutesLogged) > 0) {
				const hours = Math.max(1, barPercent(Number(p.minutesLogged) / 60, 20));
				a.insertAdjacentHTML("beforeend", meter(hours, `${title}: ${hoursLabel(p.minutesLogged)}`));
			}
			return a;
		}, "No skills yet. Add one from Home."),
		fill("#sidebar-topics", () => client.get("/api/topics"), (t) => link(topicPath(t.topic, "map"),
			topicTitle(t)), "")
			.then(() => {
				const nav = /** @type {HTMLElement} */ (document.querySelector("#sidebar-topics"));
				nav.querySelector(".psi-nav-note")?.remove();
				nav.append(link("#/topics", "All concepts"));
			}),
	]);
	if (token === shellGeneration) markCurrent();
}
function markCurrent() {
	const hash = location.hash || "#/";
	/** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll("#sidebar a")).forEach((a) => {
		const topic = parseRoute(hash).route === "topic" && a.hash === `#/${hash.slice(2).split("/")[0]}/map`;
		const paths = a.hash === "#/paths" && /^#\/paths(?:[/?]|$)/.test(hash);
		const graph = a.hash === "#/graph" && /^#\/graph(?:[/?]|$)/.test(hash);
		if (a.hash === hash || topic || paths || graph) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
	});
}
async function renderRoute() {
	closeDrawer(); closeBench(); closeArtifact();
	mounted?.destroy?.(); mounted = undefined;
	const token = ++generation;
	reviewState = undefined;
	const parsed = parseRoute(location.hash);
	benchWanted = benchRoute(parsed.route);
	if (benchWanted) { ensureBench(); if (bench?.skill) setBenchAvailable(true); }
	else setBenchAvailable(false);
	markCurrent();
	void refreshChrome();
	if (parsed.route === "topic" || parsed.route === "topics") return render();
	app.dataset.route = layoutRoute(parsed.route);
	app.replaceChildren();
	const host = document.createElement("div"); host.className = "psi-view-host"; app.append(host);
	host.innerHTML = `<p class="empty psi-view">Opening…</p>`;
	document.title = "psi";
	setTopbar(parsed.route === "memory" ? "Memory" : parsed.route === "you" ? "You" : parsed.route === "paths" ? "Learning paths"
		: parsed.route === "graph" ? "Graph"
		: parsed.route === "skill" ? capital(titleOf(parsed.params.skill)) : "psi");
	if (benchWanted) void topbarForSkill();
	app.setAttribute("aria-busy", "true");
	try {
		let view;
		if (parsed.route === "home") {
			const { mountHome } = await import("./js/home.js");
			if (token !== generation) return;
			view = mountHome(host, { navigate });
		} else if (parsed.route === "you") {
			const { mountYou } = await import("./js/you.js");
			if (token !== generation) return;
			document.title = "You · psi";
			view = mountYou(host);
		} else if (parsed.route === "memory") {
			const { mountMemory } = await import("./js/memory.js");
			if (token !== generation) return;
			document.title = "Memory · psi";
			view = mountMemory(host);
		} else if (parsed.route === "skill") {
			const { mountPractice } = await import("./js/practice.js");
			if (token !== generation) return;
			view = mountPractice(host, { skill: parsed.params.skill, navigate });
			// The top bar starts from the slug ("Sql lab"); swap in the plan's own title ("SQL Lab").
			void import("./js/api.js").then(({ api: client }) => client.get(`/api/skills/${enc(/** @type {string} */ (parsed.params.skill))}`))
				.then((data) => {
					if (token !== generation || !data?.plan?.title) return;
					setTopbar(data.plan.title); document.title = `${data.plan.title} · psi`;
				}).catch(() => {});
		} else if (parsed.route === "graph") {
			const { mountGraph } = await import("./js/graph.js");
			if (token !== generation) return;
			document.title = "Graph · psi";
			view = mountGraph(host, { navigate, focus: parsed.params.nodeId || undefined });
		} else if (parsed.route === "paths") {
			const { mountPaths } = await import("./js/paths.js");
			if (token !== generation) return;
			document.title = "Learning paths · psi";
			view = mountPaths(host, { navigate, id: parsed.params.id });
		} else if (parsed.route === "chat" || parsed.route === "new") {
			host.className = "psi-view-host psi-view";
			const { api: client } = await import("./js/api.js");
			const { mountChat } = await import("./js/chat.js");
			if (token !== generation) return;
			let chatId = parsed.params.chatId;
			if (parsed.route === "new") {
				host.innerHTML = `<p class="empty">Starting a chat…</p>`;
				const { skill, topic, prompt } = parsed.params;
				const model = await import("./js/models.js").then((m) => m.getPreferredModel()).catch(() => undefined);
				const created = await client.post("/api/chat", { ...(skill && { skill }), ...(topic && { topic }),
					...(model && { model }) });
				chatId = created.id;
				// Seed before mounting SSE; the chat endpoint replays its saved records on connection.
				if (prompt) await client.post(`/api/chat/${enc(/** @type {string} */ (chatId))}/prompt`, { message: prompt });
				if (token !== generation) return;
				history.replaceState(null, "", `#/chat/${enc(/** @type {string} */ (chatId))}`);
				markCurrent();
				void refreshChrome();
			}
			view = await mountChat(host, { chatId, skill: parsed.params.skill, topic: parsed.params.topic,
				onChatCreated: (id) => navigate(`#/chat/${enc(id)}`) });
		} else host.innerHTML = `<div class="psi-view">${empty("This page doesn't exist. Pick something in the sidebar.")}</div>`;
		if (token === generation) mounted = view;
		else view?.destroy?.();
	} catch (error) {
		if (token === generation) {
			if (isModuleLoadError(error)) { showOffline(host, token); return; }
			host.innerHTML = `<div class="psi-view empty"><h2>Couldn't open this page</h2>
				<p>${escapeHtml(String(error.message).replace(/\.$/, ""))}. Check that psi web is running, then try again.</p>
				<button id="shell-retry" type="button">Try again</button></div>`;
			(/** @type {HTMLButtonElement} */ (host.querySelector("#shell-retry"))).onclick = renderRoute;
		}
	} finally { if (token === generation) app.removeAttribute("aria-busy"); }
}
/** One clear message when the page's own scripts can't load; reloads by itself once psi web answers again. */
function showOffline(host, token) {
	host.innerHTML = `<div class="psi-view empty" role="alert"><h2>psi web restarted or is offline</h2>
		<p>Reload the page to carry on. Your chats and progress are saved.</p>
		<button id="shell-reload" type="button" class="primary">Reload</button></div>`;
	host.querySelector("#shell-reload").onclick = () => location.reload();
	if (offlineRetried) return;
	offlineRetried = true;
	setTimeout(async () => {
		if (token !== generation) return;
		try {
			const response = await fetch("/api/state", { cache: "no-store" });
			if (response.ok && token === generation) location.reload();
		} catch { /* Still offline: the message and its Reload button stay. */ }
	}, 2000);
}
(/** @type {HTMLButtonElement} */ (document.querySelector("#close-lightbox"))).onclick = closeArtifact;
dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeArtifact(); });
dialog.addEventListener("click", (event) => { if (event.target === dialog) closeArtifact(); });
menuToggle.onclick = () => {
	closeBench();
	const open = document.body.classList.toggle("psi-drawer-open");
	menuToggle.setAttribute("aria-expanded", String(open));
	syncShade();
	if (open) (/** @type {HTMLElement} */ (document.querySelector("#sidebar .psi-brand")))?.focus();
};
benchToggle.onclick = () => {
	closeDrawer();
	const open = document.body.classList.toggle("psi-bench-open");
	benchToggle.setAttribute("aria-expanded", String(open));
	syncShade();
	if (open) (/** @type {HTMLElement} */ (benchEl.querySelector("a, button")))?.focus();
};
shade.onclick = () => { closeDrawer(); closeBench(); };
(/** @type {HTMLElement} */ (document.querySelector("#sidebar"))).addEventListener("click", (event) => {
	if ((/** @type {Element} */ (event.target)).closest("a")) closeDrawer();
});
(/** @type {HTMLAnchorElement} */ (document.querySelector(".psi-skip"))).onclick = (event) => { event.preventDefault(); app.focus(); };
window.addEventListener("hashchange", () => { void renderRoute(); });
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		const drawer = document.body.classList.contains("psi-drawer-open");
		closeDrawer(); closeBench();
		if (drawer) menuToggle.focus();
	}
	if (dialog.open || /INPUT|TEXTAREA|SELECT/.test((/** @type {HTMLElement} */ (event.target)).tagName)
		|| (/** @type {HTMLElement} */ (event.target)).isContentEditable) return;
	if (event.altKey || event.ctrlKey || event.metaKey) return;
	if (reviewState && event.code === "Space" && !reviewState.revealed && reviewState.cards[reviewState.index]) {
		event.preventDefault(); reviewState.revealed = true; renderCard();
	} else if (reviewState && /^[1-4]$/.test(event.key)) { event.preventDefault(); void submitRating(Number(event.key)); }
});
for (const name of ["psi:skills-changed", "psi:chats-changed", "psi:attempt"]) {
	window.addEventListener(name, () => { void refreshChrome(); });
}
window.addEventListener("psi:bench", (event) => {
	const open = (/** @type {CustomEvent} */ (event)).detail?.open ?? !document.body.classList.contains("psi-bench-open");
	if (open && !benchToggle.hidden) benchToggle.click(); else if (!open) closeBench();
});
events = new EventSource("/api/events");
events.onopen = () => setConnection("");
events.onerror = () => setConnection("Reconnecting to psi…", true);
events.addEventListener("changed", () => {
	void refreshChrome();
	bench?.refresh?.();
	if (Date.now() < ownWriteUntil) return;
	if (reviewState) return;
	// Keep live conversations and form drafts intact during filesystem updates.
	if (["topic", "topics"].includes(parseRoute(location.hash).route)) void render();
});
window.addEventListener("focus", () => { void refreshChrome(); });
window.addEventListener("psi:game", () => { void topbarForSkill(); });
// Settings in the sidebar footer: the game layer control, and the profile's layer applied on load.
import("./js/settings.js").then(({ gameLayerControl, loadGameLayer }) => {
	document.querySelector("#settings-body")?.append(gameLayerControl({ id: "sidebar-game-layer", compact: true }));
	void loadGameLayer();
}).catch(() => { /* The app works without settings; the cached layer stays applied. */ });
void renderRoute();
}

if (typeof document !== "undefined") {
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
	else init();
}
