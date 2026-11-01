/**
 * Knowledge graph ("second brain") view for psi web: a force-directed canvas over GET /api/graph.
 *
 * API
 * - `mountGraph(el, { navigate, focus? })` → `{ destroy() }`. `focus` is a node id to select on open
 *   (from `#/graph/<id>`). Selecting a node rewrites the URL to `#/graph/<id>` with replaceState.
 * - Dev fixtures: `?fixture=1` falls back to `js/graph-fixture.json` when the graph API fails; `?fixture=only`
 *   always uses it; `?fixture=500` uses a synthetic 500-node graph (performance checks). Off by default.
 * - Pure helpers exported for tests: hashString, seededRandom, degreeMap, clusterOf, seedLayout, buildQuadtree,
 *   repulsion, createSimulation, neighbourhood, filterGraph, nearestInDirection, pathPolyline, catmullRom,
 *   searchNodes, shortKind, kindWords, statusWords, progressWords, nodeRadius, practiseRoute, askRoute, localPathTo,
 *   layoutFor, mergeLayout, syntheticGraph.
 * - Settled node positions persist in localStorage `psi-graph-layout` as `{ wide: { id: [x, y] }, tall: {…} }`
 *   (one layout per screen shape, because centring follows the stage's aspect).
 *
 * Styling follows studio/DESIGN.md "Knowledge graph and learning paths": ink and pencil only, highlighter for
 * mastered halos and the selected learning path (the one bold stroke).
 */
import { el, toast } from "./ui.js";
import { api } from "./api.js";

/** @typedef {{ s: any, t: any, spring: { length: number, strength: number }, bias: number, strength: number }} SimLink */
/** @typedef {[string, (edge: any) => boolean, "from" | "to" | "other"]} LinkGroup */

export const LAYOUT_KEY = "psi-graph-layout";
const KIND_ORDER = { skill: 0, topic: 1, subskill: 2, concept: 3, note: 4 };
const SPRING = {
	contains: { length: 44, strength: 1 },
	prerequisite: { length: 56, strength: 0.7 },
	about: { length: 30, strength: 1 },
	link: { length: 120, strength: 0.25 },
	related: { length: 170, strength: 0.08 },
};
const enc = encodeURIComponent;

/* ───────────────────────────── pure helpers ───────────────────────────── */

/** FNV-1a 32-bit hash of a string. */
export function hashString(text) {
	let h = 0x811c9dc5;
	const s = String(text);
	for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
	return h >>> 0;
}

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function seededRandom(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Undirected degree per node id. */
export function degreeMap(edges) {
	const map = new Map();
	for (const e of edges) {
		map.set(e.from, (map.get(e.from) ?? 0) + 1);
		map.set(e.to, (map.get(e.to) ?? 0) + 1);
	}
	return map;
}

/** Split "subskill:sql-lab/joins" into { kind, owner: "sql-lab", leaf: "joins" }. */
export function parseId(id) {
	const s = String(id);
	const colon = s.indexOf(":");
	const kind = colon < 0 ? "" : s.slice(0, colon);
	const rest = colon < 0 ? s : s.slice(colon + 1);
	const slash = rest.indexOf("/");
	return { kind, owner: slash < 0 ? rest : rest.slice(0, slash), leaf: slash < 0 ? "" : rest.slice(slash + 1) };
}

/** The skill or topic a node belongs to ("skill:x" / "topic:x"); notes follow what they are about. */
export function clusterOf(node, aboutTarget) {
	const { owner } = parseId(node.id);
	if (node.kind === "skill" || node.kind === "subskill") return `skill:${owner}`;
	if (node.kind === "topic" || node.kind === "concept") return `topic:${owner}`;
	if (aboutTarget && aboutTarget.kind !== "note") return clusterOf(aboutTarget);
	return "notes";
}

/**
 * Deterministic starting positions. Saved positions win; new nodes start next to a saved neighbour; the rest are
 * placed around their skill/topic on a golden-angle spiral of clusters, offset by a hash of their id.
 */
export function seedLayout(nodes, edges, saved = {}) {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const neighbours = new Map();
	for (const e of edges) {
		if (!byId.has(e.from) || !byId.has(e.to)) continue;
		(neighbours.get(e.from) ?? neighbours.set(e.from, []).get(e.from)).push(e.to);
		(neighbours.get(e.to) ?? neighbours.set(e.to, []).get(e.to)).push(e.from);
	}
	const aboutOf = new Map();
	// The smallest target id, so edge order never changes where a note starts.
	for (const e of edges) {
		if (e.kind !== "about" || !byId.has(e.to)) continue;
		const prev = aboutOf.get(e.from);
		if (!prev || e.to < prev.id) aboutOf.set(e.from, byId.get(e.to));
	}
	const pos = new Map();
	const valid = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
	for (const n of nodes) if (valid(saved[n.id])) pos.set(n.id, { x: saved[n.id][0], y: saved[n.id][1] });
	const offset = (id, min, spread) => {
		const rnd = seededRandom(hashString(id));
		const angle = rnd() * Math.PI * 2, r = min + rnd() * spread;
		return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r };
	};
	// New nodes join an already placed neighbour so a returning learner's map doesn't move.
	if (pos.size) {
		for (const n of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
			if (pos.has(n.id)) continue;
			const anchor = (neighbours.get(n.id) ?? []).find((id) => pos.has(id));
			if (!anchor) continue;
			const p = pos.get(anchor), { dx, dy } = offset(n.id, 26, 24);
			pos.set(n.id, { x: p.x + dx, y: p.y + dy });
		}
	}
	const clusters = [...new Set(nodes.map((n) => clusterOf(n, aboutOf.get(n.id))))].sort();
	const centre = new Map();
	clusters.forEach((key, i) => {
		const angle = i * 2.399963229728653, radius = 230 * Math.sqrt(i + 0.6);
		centre.set(key, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
	});
	const ordered = [...nodes].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (a.id < b.id ? -1 : 1));
	for (const n of ordered) {
		if (pos.has(n.id)) continue;
		const about = aboutOf.get(n.id);
		if (n.kind === "note" && about && pos.has(about.id)) {
			const p = pos.get(about.id), { dx, dy } = offset(n.id, 22, 18);
			pos.set(n.id, { x: p.x + dx, y: p.y + dy });
			continue;
		}
		const c = centre.get(clusterOf(n, about)) ?? { x: 0, y: 0 };
		const root = n.kind === "skill" || n.kind === "topic";
		const { dx, dy } = offset(n.id, root ? 0 : 50, root ? 6 : 90);
		pos.set(n.id, { x: c.x + dx, y: c.y + dy });
	}
	return pos;
}

function cell(x, y, size) { return { x, y, size, mass: 0, cx: 0, cy: 0, points: null, kids: null }; }
function insertPoint(c, p, depth) {
	if (!c.kids) {
		if (!c.points) { c.points = [p]; return; }
		if (depth >= 18) { c.points.push(p); return; }
		const old = c.points;
		c.points = null; c.kids = [null, null, null, null];
		for (const q of old) insertKid(c, q, depth);
	}
	insertKid(c, p, depth);
}
function insertKid(c, p, depth) {
	const h = c.size / 2;
	const i = (p.x >= c.x + h ? 1 : 0) + (p.y >= c.y + h ? 2 : 0);
	if (!c.kids[i]) c.kids[i] = cell(c.x + (i & 1) * h, c.y + (i >> 1) * h, h);
	insertPoint(c.kids[i], p, depth + 1);
}
function summarise(c) {
	let mass = 0, cx = 0, cy = 0;
	if (c.points) for (const p of c.points) { const m = p.mass ?? 1; mass += m; cx += p.x * m; cy += p.y * m; }
	else for (const k of c.kids) {
		if (!k) continue;
		summarise(k);
		mass += k.mass; cx += k.cx * k.mass; cy += k.cy * k.mass;
	}
	c.mass = mass; c.cx = mass ? cx / mass : c.x; c.cy = mass ? cy / mass : c.y;
}

/** Barnes-Hut quadtree over points `{ x, y, mass? }`; returns the root cell (or null for no points). */
export function buildQuadtree(points) {
	if (!points.length) return null;
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const p of points) {
		if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
		if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
	}
	const root = cell(x0, y0, Math.max(x1 - x0, y1 - y0, 1) * 1.0001 + 1e-6);
	for (const p of points) insertPoint(root, p, 0);
	summarise(root);
	return root;
}

/**
 * Inverse-distance repulsion on `p` from every other point in `tree` (Barnes-Hut with `theta`). Returns
 * `{ fx, fy }` where each source contributes `strength · mass · d / |d|²` (so magnitude ∝ 1/|d|).
 */
export function repulsion(tree, p, { theta = 0.9, strength = 1, minDistance = 2, maxDistance = Infinity } = {}) {
	let fx = 0, fy = 0;
	if (!tree) return { fx, fy };
	const theta2 = theta * theta, min2 = minDistance * minDistance, max2 = maxDistance * maxDistance;
	const push = (dx, dy, mass, salt) => {
		let d2 = dx * dx + dy * dy;
		if (d2 >= max2) return;
		if (d2 === 0) { dx = ((salt % 7) - 3 || 1) * 0.01; dy = ((salt % 5) - 2 || 1) * 0.01; d2 = dx * dx + dy * dy; }
		if (d2 < min2) d2 = min2;
		const f = strength * mass / d2;
		fx += dx * f; fy += dy * f;
	};
	const stack = [tree];
	while (stack.length) {
		const c = stack.pop();
		if (!c || !c.mass) continue;
		if (c.kids) {
			const dx = p.x - c.cx, dy = p.y - c.cy;
			const d2 = dx * dx + dy * dy;
			const inside = p.x >= c.x && p.x < c.x + c.size && p.y >= c.y && p.y < c.y + c.size;
			if (!inside && d2 > 0 && (c.size * c.size) / d2 < theta2) push(dx, dy, c.mass, 1);
			else for (const k of c.kids) if (k) stack.push(k);
		} else {
			for (const q of c.points) if (q !== p) push(p.x - q.x, p.y - q.y, q.mass ?? 1, (q.index ?? 0) + (p.index ?? 0));
		}
	}
	return { fx, fy };
}

/**
 * Force simulation over `nodes` ({ id, x, y }) and `edges` ({ from, to, kind }): Barnes-Hut repulsion, springs
 * per edge kind, mild centring and cooling. Mutates node x/y/vx/vy; `fx`/`fy` pin a node. `tick()` → alpha.
 */
export function createSimulation(nodes, edges, { alpha = 1, charge = 180, gravity = 0.08, maxDistance = 360, aspect = 1 } = {}) {
	const byId = new Map(nodes.map((n, i) => { n.index = i; n.vx ??= 0; n.vy ??= 0; return [n.id, n]; }));
	const count = new Map();
	/** @type {SimLink[]} */
	const links = [];
	for (const e of edges) {
		const s = byId.get(e.from), t = byId.get(e.to);
		if (!s || !t || s === t) continue;
		count.set(s, (count.get(s) ?? 0) + 1); count.set(t, (count.get(t) ?? 0) + 1);
		links.push(/** @type {SimLink} */ ({ s, t, spring: SPRING[e.kind] ?? SPRING.link }));
	}
	for (const n of nodes) n.mass = 1 + Math.sqrt(count.get(n) ?? 0) * 0.35;
	for (const l of links) {
		const cs = count.get(l.s), ct = count.get(l.t);
		l.bias = cs / (cs + ct);
		l.strength = l.spring.strength / Math.min(cs, ct);
	}
	const sim = {
		alpha, aspect, alphaTarget: 0, alphaMin: 0.003, alphaDecay: 1 - Math.pow(0.003, 1 / 300), velocityDecay: 0.42,
		nodes, links,
		get settled() { return sim.alpha < sim.alphaMin && sim.alphaTarget === 0; },
		reheat(value = 0.3) { sim.alpha = Math.max(sim.alpha, value); },
		tick() {
			sim.alpha += (sim.alphaTarget - sim.alpha) * sim.alphaDecay;
			const a = sim.alpha;
			const tree = buildQuadtree(nodes);
			// Anisotropic centring spreads the graph to the stage's shape (wide screens get a wide graph).
			const r = Math.sqrt(Math.max(0.5, Math.min(2.5, sim.aspect)));
			const gx = gravity / r, gy = gravity * r;
			for (const n of nodes) {
				const { fx, fy } = repulsion(tree, n, { strength: charge, minDistance: 6, maxDistance });
				n.vx += fx * a; n.vy += fy * a;
				n.vx -= n.x * gx * a; n.vy -= n.y * gy * a;
			}
			for (const l of links) {
				let x = l.t.x + l.t.vx - l.s.x - l.s.vx, y = l.t.y + l.t.vy - l.s.y - l.s.vy;
				const d = Math.hypot(x, y) || 0.01;
				const k = (d - l.spring.length) / d * a * l.strength;
				x *= k; y *= k;
				l.t.vx -= x * l.bias; l.t.vy -= y * l.bias;
				l.s.vx += x * (1 - l.bias); l.s.vy += y * (1 - l.bias);
			}
			for (const n of nodes) {
				if (n.fx != null) { n.x = n.fx; n.vx = 0; } else { n.vx *= 1 - sim.velocityDecay; n.x += n.vx; }
				if (n.fy != null) { n.y = n.fy; n.vy = 0; } else { n.vy *= 1 - sim.velocityDecay; n.y += n.vy; }
			}
			return sim.alpha;
		},
	};
	return sim;
}

/** Ids within `depth` undirected hops of `id` over `edges` (including `id`). */
export function neighbourhood(edges, id, depth = 1) {
	const adj = new Map();
	for (const e of edges) {
		(adj.get(e.from) ?? adj.set(e.from, new Set()).get(e.from)).add(e.to);
		(adj.get(e.to) ?? adj.set(e.to, new Set()).get(e.to)).add(e.from);
	}
	const seen = new Set([id]);
	let frontier = [id];
	for (let d = 0; d < depth && frontier.length; d++) {
		const next = [];
		for (const v of frontier) for (const w of adj.get(v) ?? []) if (!seen.has(w)) { seen.add(w); next.push(w); }
		frontier = next;
	}
	return seen;
}

/**
 * Apply toolbar filters: `{ skills, topics, notes, related }` booleans (missing = shown), plus an optional
 * `{ local: { id, depth } }` neighbourhood. Returns `{ nodes, edges }` with edges between kept nodes only.
 */
export function filterGraph(graph, filters = {}) {
	const show = (n) => !((filters.skills === false && (n.kind === "skill" || n.kind === "subskill"))
		|| (filters.topics === false && (n.kind === "topic" || n.kind === "concept"))
		|| (filters.notes === false && n.kind === "note"));
	let nodes = graph.nodes.filter(show);
	let ids = new Set(nodes.map((n) => n.id));
	let edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (filters.related !== false || e.kind !== "related"));
	if (filters.local?.id && ids.has(filters.local.id)) {
		const keep = neighbourhood(edges, filters.local.id, filters.local.depth ?? 1);
		nodes = nodes.filter((n) => keep.has(n.id));
		ids = keep;
		edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
	}
	return { nodes, edges };
}

const DIRECTIONS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
/**
 * The candidate closest to `from` in `direction` ("left" | "right" | "up" | "down"), within a ~63° cone either
 * side. Candidates are `{ id, x, y }`; returns the id or undefined.
 */
export function nearestInDirection(from, candidates, direction) {
	const v = DIRECTIONS[direction];
	if (!v || !from) return undefined;
	let best, bestScore = Infinity;
	for (const c of candidates) {
		if (c.id === from.id) continue;
		const dx = c.x - from.x, dy = c.y - from.y;
		const along = dx * v[0] + dy * v[1];
		if (along <= 0) continue;
		const across = Math.abs(dx * v[1] - dy * v[0]);
		if (across > along * 2) continue;
		const score = Math.hypot(dx, dy) * (1 + across / along);
		if (score < bestScore) { bestScore = score; best = c.id; }
	}
	return best;
}

/** Points `{ id, x, y }` for a path's steps in order, skipping steps without a position and repeats. */
export function pathPolyline(steps, positions) {
	const out = [];
	for (const id of steps ?? []) {
		const p = positions.get(id);
		if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
		if (out.length && out[out.length - 1].id === id) continue;
		out.push({ id, x: p.x, y: p.y });
	}
	return out;
}

/**
 * Cubic Bézier segments of a Catmull-Rom spline through every point (so the stroke passes through each step).
 * Returns `[{ c1: {x,y}, c2: {x,y}, to: {x,y} }]`, one per gap; empty for fewer than two points.
 */
export function catmullRom(points, tension = 0.5) {
	const segs = [];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
		const t = tension / 3;
		segs.push({
			c1: { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t },
			c2: { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t },
			to: { x: p2.x, y: p2.y },
		});
	}
	return segs;
}

/** Title search: prefix, then word start, then substring, then summary matches; skills/topics first on ties. */
export function searchNodes(nodes, query, limit = 8) {
	const q = String(query ?? "").trim().toLowerCase();
	if (!q) return [];
	const scored = [];
	for (const n of nodes) {
		const title = String(n.title ?? "").toLowerCase();
		let score = -1;
		if (title.startsWith(q)) score = 0;
		else if (title.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) score = 1;
		else if (title.includes(q)) score = 2;
		else if (q.length >= 3 && String(n.summary ?? "").toLowerCase().includes(q)) score = 3;
		if (score >= 0) scored.push({ n, score });
	}
	scored.sort((a, b) => a.score - b.score || (KIND_ORDER[a.n.kind] ?? 9) - (KIND_ORDER[b.n.kind] ?? 9)
		|| String(a.n.title).localeCompare(String(b.n.title)));
	return scored.slice(0, limit).map((s) => s.n);
}

/** One word for a node's kind ("Skill", "Step", "Topic", "Concept", "Note"). */
export function shortKind(node) {
	return { skill: "Skill", subskill: "Step", topic: "Topic", concept: "Concept", note: "Note" }[node?.kind] ?? "Node";
}

/** Kind in words, naming the owning skill or topic when its title is known. */
export function kindWords(node, ownerTitle) {
	switch (node?.kind) {
		case "skill": return "Skill";
		case "subskill": return ownerTitle ? `Step in ${ownerTitle}` : "Step in a skill";
		case "topic": return "Topic";
		case "concept": return ownerTitle ? `Concept in ${ownerTitle}` : "Concept";
		case "note": return "Note from memory";
		default: return "Node";
	}
}

/** Progress status in words; "" when absent. */
export function statusWords(status) {
	return {
		locked: "Locked until its prerequisites are solid", next: "Next up", practising: "Practising",
		solid: "Solid", mastered: "Mastered", new: "Not started",
	}[status] ?? "";
}

/** Progress (0 … 1) in words for the node's kind; "" when it doesn't apply. */
export function progressWords(node) {
	const p = Number(node?.progress);
	if (!Number.isFinite(p)) return "";
	const v = Math.max(0, Math.min(1, p));
	if (node.kind === "skill") return `${Math.round(v * 200) / 10} of 20 hours`;
	if (node.kind === "subskill") return `${Math.round(v * 100)}% of its challenges solved`;
	if (node.kind === "concept") return `${Math.round(v * 100)}% likely known`;
	if (node.kind === "topic") return `${Math.round(v * 100)}% of concepts mastered`;
	return "";
}

/** World-space radius: skills largest, topics next, steps and concepts small, notes smallest; grows with degree. */
export function nodeRadius(kind, degree = 0) {
	const d = Math.sqrt(Math.max(0, degree));
	if (kind === "skill") return Math.min(17, 10 + d * 1.1);
	if (kind === "topic") return Math.min(15, 8.5 + d * 1);
	if (kind === "note") return 3.5;
	return Math.min(8, 4 + d * 0.55);
}

/** "Practise this" destination: a new tutor chat with the right command; "" for notes. */
export function practiseRoute(node) {
	const { owner } = parseId(node.id);
	if (node.kind === "skill") return `#/new?skill=${enc(owner)}&prompt=${enc("/practice")}`;
	if (node.kind === "subskill") return `#/new?skill=${enc(owner)}&prompt=${enc(`/practice ${node.title}`)}`;
	if (node.kind === "concept" || node.kind === "topic") return `#/new?topic=${enc(owner)}&prompt=${enc(`Teach me ${node.title}`)}`;
	return "";
}

/** "Ask the tutor" destination: a new chat scoped to the node's skill or topic. */
export function askRoute(node) {
	const { owner } = parseId(node.id);
	const scope = node.kind === "skill" || node.kind === "subskill" ? `skill=${enc(owner)}&`
		: node.kind === "topic" || node.kind === "concept" ? `topic=${enc(owner)}&` : "";
	const prompt = node.kind === "note"
		? `About my note "${node.summary || node.title}": what should I do with this?`
		: `Help me understand "${node.title}" and how it connects to what I already know.`;
	return `#/new?${scope}prompt=${enc(prompt)}`;
}

/** Unfinished prerequisite ancestors of `targetId` in topological order, ending at the target (fixture mode). */
export function localPathTo(graph, targetId) {
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	if (!byId.has(targetId)) return [];
	const before = new Map();
	for (const e of graph.edges) if (e.kind === "prerequisite") (before.get(e.to) ?? before.set(e.to, []).get(e.to)).push(e.from);
	const order = [], seen = new Set();
	const visit = (id) => {
		if (seen.has(id)) return;
		seen.add(id);
		for (const p of [...(before.get(id) ?? [])].sort()) visit(p);
		order.push(id);
	};
	visit(targetId);
	return order.filter((id) => id === targetId || !["solid", "mastered"].includes(byId.get(id)?.status ?? ""));
}

/** The saved `{ id: [x, y] }` layout for a screen shape ("wide" | "tall") from the stored `{ wide, tall }` object. */
export function layoutFor(stored, shape) {
	const layout = stored && typeof stored === "object" ? stored[shape] : undefined;
	return layout && typeof layout === "object" && !Array.isArray(layout) ? layout : {};
}

/** Merge live positions into a saved layout object `{ id: [x, y] }` (rounded to 0.1). */
export function mergeLayout(saved, nodes) {
	const out = { ...(saved && typeof saved === "object" ? saved : {}) };
	for (const n of nodes) if (Number.isFinite(n.x) && Number.isFinite(n.y)) out[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10];
	return out;
}

/** A deterministic synthetic graph of about `size` nodes for performance checks (`?fixture=500`). */
export function syntheticGraph(size = 500) {
	const rnd = seededRandom(42);
	const nodes = [], edges = [];
	const skills = Math.max(1, Math.round(size / 40)), topics = Math.max(1, Math.round(size / 50));
	const statuses = ["new", "new", "next", "practising", "solid", "locked", "locked"];
	const groups = [];
	for (let s = 0; s < skills; s++) groups.push({ kind: "skill", child: "subskill", slug: `skill-${s}` });
	for (let t = 0; t < topics; t++) groups.push({ kind: "topic", child: "concept", slug: `topic-${t}` });
	const perGroup = Math.floor((size * 0.85) / groups.length);
	const children = [];
	for (const g of groups) {
		nodes.push({ id: `${g.kind}:${g.slug}`, kind: g.kind, title: `${g.kind === "skill" ? "Skill" : "Topic"} ${g.slug}`, status: "practising", progress: rnd() });
		let prev;
		for (let i = 0; i < perGroup; i++) {
			const id = `${g.child}:${g.slug}/item-${i}`;
			const status = g.child === "concept" ? (rnd() < 0.2 ? "mastered" : "new") : statuses[Math.floor(rnd() * statuses.length)];
			nodes.push({ id, kind: g.child, title: `Item ${i} of ${g.slug}`, status, progress: rnd() });
			children.push(id);
			edges.push({ from: `${g.kind}:${g.slug}`, to: id, kind: "contains" });
			if (prev && rnd() < 0.7) edges.push({ from: prev, to: id, kind: "prerequisite" });
			prev = id;
		}
	}
	while (nodes.length < size) {
		const id = `note:n${nodes.length}`;
		nodes.push({ id, kind: "note", title: `Note ${nodes.length}` });
		edges.push({ from: id, to: children[Math.floor(rnd() * children.length)], kind: "about" });
	}
	for (let i = 0; i < size / 20; i++) {
		const a = children[Math.floor(rnd() * children.length)], b = children[Math.floor(rnd() * children.length)];
		if (a !== b) edges.push({ from: a, to: b, kind: "related", weight: 0.3 });
	}
	return { nodes, edges, builtAt: "2026-01-01T00:00:00.000Z" };
}

/* ───────────────────────────── view ───────────────────────────── */

function readStorage(key) {
	try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function writeStorage(key, value) {
	try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private mode: the layout is reseeded next time. */ }
}
function fixtureMode() {
	const fromSearch = new URLSearchParams(location.search).get("fixture");
	const hashQuery = location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?") + 1) : "";
	return fromSearch ?? new URLSearchParams(hashQuery).get("fixture") ?? "";
}
function normaliseGraph(raw) {
	const nodes = Array.isArray(raw?.nodes) ? raw.nodes.filter((n) => n && typeof n.id === "string") : [];
	const seen = new Set();
	const unique = nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
	const edges = (Array.isArray(raw?.edges) ? raw.edges : []).filter((e) => e && seen.has(e.from) && seen.has(e.to) && e.from !== e.to);
	return { nodes: unique, edges, builtAt: raw?.builtAt ?? "" };
}
async function loadData() {
	const mode = fixtureMode();
	const fixture = async () => {
		if (mode === "500") return { graph: syntheticGraph(500), paths: [], fixture: true };
		const response = await fetch("/js/graph-fixture.json");
		const data = await response.json();
		return { graph: data.graph, paths: data.paths ?? [], fixture: true };
	};
	if (mode === "only" || mode === "500") return fixture();
	try {
		const [graph, paths] = await Promise.all([api.get("/api/graph"), api.get("/api/paths").catch(() => [])]);
		return { graph, paths: Array.isArray(paths) ? paths : paths?.paths ?? [], fixture: false };
	} catch (error) {
		if (mode) return fixture();
		throw error;
	}
}

/** DELETE /api/graph/links needs a JSON body, which the shared api.del helper doesn't send. */
async function deleteLink(from, to) {
	const response = await fetch("/api/graph/links", {
		method: "DELETE", headers: { "X-Psi": "1", "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ from, to }),
	});
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new Error(data.message || data.error || `Request failed (${response.status})`);
	}
}

const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Mount the knowledge graph into `root`. */
/** @param {Element} root @param {{ navigate?: (hash: string) => void, focus?: string }} [options] */
export function mountGraph(root, { navigate = (hash) => { location.hash = hash; }, focus } = {}) {
	let destroyed = false;
	const cleanups = [];
	const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
	root.replaceChildren(el("p", { class: "empty psi-view" }, "Opening your graph…"));
	document.title = "Graph · psi";

	let data, view;
	loadData().then((loaded) => {
		if (destroyed) return;
		data = loaded;
		const graph = normaliseGraph(loaded.graph);
		if (!graph.nodes.length) { renderEmpty(); return; }
		view = buildView(graph, loaded.paths, loaded.fixture);
	}).catch((error) => {
		if (destroyed) return;
		root.replaceChildren(el("div", { class: "psi-view empty", role: "alert" },
			el("h2", {}, "Couldn't load your graph"),
			el("p", {}, `${String(error?.message || "The graph didn't load").replace(/\.$/, "")}. Check that psi web is running, then try again.`),
			el("button", { type: "button", onclick: () => { const next = mountGraph(root, { navigate, focus }); handle.destroy = next.destroy; destroy(); } }, "Try again")));
	});

	function renderEmpty() {
		root.replaceChildren(el("div", { class: "psi-view psi-graph-empty" },
			el("h1", {}, "Graph"),
			el("p", {}, "Your graph grows as you add skills and topics."),
			el("a", { class: "button primary", href: "#/" }, "Add a skill pack")));
	}

	function buildView(graph, initialPaths, fixture) {
		const byId = new Map(graph.nodes.map((n) => [n.id, n]));
		let degree = degreeMap(graph.edges);
		const ownerTitle = (n) => {
			const { owner } = parseId(n.id);
			if (n.kind === "subskill") return byId.get(`skill:${owner}`)?.title;
			if (n.kind === "concept") return byId.get(`topic:${owner}`)?.title;
			return undefined;
		};
		let paths = initialPaths.filter((p) => p && Array.isArray(p.steps));

		// ── state
		const state = {
			filters: { skills: true, topics: true, notes: true, related: true },
			local: false, depth: 1, list: false,
			hoverId: undefined, focusId: undefined, selectedId: undefined, pathId: "",
			view: { x: 0, y: 0, k: 1 }, width: 0, height: 0, dpr: 1,
			keyboard: false,
		};
		// Layouts are stored per screen shape: centring follows the stage's aspect, so wide and tall differ.
		const shape = window.innerWidth >= window.innerHeight ? "wide" : "tall";
		const saved = layoutFor(readStorage(LAYOUT_KEY), shape);
		const savedCount = graph.nodes.filter((n) => Array.isArray(saved[n.id])).length;
		const seeds = seedLayout(graph.nodes, graph.edges, saved);
		const simNodes = graph.nodes.map((n) => ({ id: n.id, x: seeds.get(n.id).x, y: seeds.get(n.id).y }));
		const simById = new Map(simNodes.map((s) => [s.id, s]));
		const freshShare = 1 - savedCount / graph.nodes.length;
		let sim = createSimulation(simNodes, graph.edges, { alpha: freshShare === 0 ? 0 : Math.max(0.12, freshShare) });

		// ── DOM
		const searchInput = el("input", {
			type: "search", class: "psi-graph-search-input", placeholder: "Search the graph", "aria-label": "Search the graph",
			role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "psi-graph-results",
			autocomplete: "off", spellcheck: "false",
		});
		const results = el("ul", { id: "psi-graph-results", class: "psi-graph-results", role: "listbox", "aria-label": "Matching nodes", hidden: true });
		const toggle = (key, label) => el("button", {
			type: "button", class: "psi-graph-toggle", "aria-pressed": "true", dataset: { filter: key },
			onclick: (event) => {
				state.filters[key] = !state.filters[key];
				event.currentTarget.setAttribute("aria-pressed", String(state.filters[key]));
				refreshVisible(); renderList(); requestDraw();
			},
		}, label);
		const localSwitch = el("button", {
			type: "button", class: "psi-graph-switch", role: "switch", "aria-checked": "false",
			onclick: () => setLocal(!state.local),
		}, el("span", { class: "psi-graph-switch-track", "aria-hidden": "true" }), "Local");
		const depthSelect = el("select", { class: "psi-graph-depth", "aria-label": "Neighbourhood depth", hidden: true,
			onchange: (event) => { state.depth = Number(event.target.value) || 1; refreshVisible(); fit(); renderList(); } },
			el("option", { value: "1" }, "1 step"), el("option", { value: "2" }, "2 steps"));
		const pathSelect = el("select", { class: "psi-graph-path-select", "aria-label": "Show path",
			onchange: (event) => { state.pathId = event.target.value; renderPathCaption(); requestDraw(); if (state.pathId) fitPath(); } });
		const listToggle = el("button", { type: "button", class: "psi-graph-tool", "aria-pressed": "false",
			onclick: () => setList(!state.list) }, "List view");
		const fitButton = el("button", { type: "button", class: "psi-graph-tool", onclick: () => fit() }, "Fit");
		const bar = el("div", { class: "psi-graph-bar" },
			el("h1", { class: "psi-graph-title" }, "Graph"),
			el("div", { class: "psi-graph-search" }, searchInput, el("kbd", { class: "psi-graph-kbd", "aria-hidden": "true" }, "/"), results),
			el("div", { class: "psi-graph-controls" },
				el("div", { class: "psi-graph-toggles", role: "group", "aria-label": "Show on the graph" },
					toggle("skills", "Skills"), toggle("topics", "Topics"), toggle("notes", "Notes"), toggle("related", "Related links")),
				el("div", { class: "psi-graph-local" }, localSwitch, depthSelect),
				el("label", { class: "psi-graph-path" }, el("span", {}, "Show path"), pathSelect),
				el("div", { class: "psi-graph-view-tools" }, fitButton, listToggle)));
		const pathCaption = el("p", { class: "psi-graph-path-caption", hidden: true });
		const canvas = el("canvas", {
			class: "psi-graph-canvas", tabindex: "0", role: "application", "aria-roledescription": "knowledge graph",
			"aria-label": "Knowledge graph", "aria-describedby": "psi-graph-help",
		});
		const help = el("p", { id: "psi-graph-help", class: "psi-sr-only" },
			"Arrow keys move to the closest connected node in that direction. Enter opens its details. Escape closes them. Plus and minus zoom. The list view shows the same graph as links.");
		const legend = el("div", { class: "psi-graph-legend", "aria-hidden": "true", html: LEGEND });
		const stage = el("div", { class: "psi-graph-stage" }, canvas, help, legend);
		const panel = el("aside", { class: "psi-graph-panel", hidden: true, "aria-label": "Node details" });
		const list = el("nav", { class: "psi-graph-list psi-sr-only", "aria-label": "Graph as a list" });
		const live = el("p", { class: "psi-sr-only", "aria-live": "polite" });
		const body = el("div", { class: "psi-graph-body" }, stage, panel, list);
		const section = el("section", { class: "psi-graph", "aria-label": "Knowledge graph" }, bar, pathCaption, body, live);
		root.replaceChildren(section);
		const ctx = canvas.getContext("2d");

		// ── theme
		let colours = {}, fonts = {};
		const readTheme = () => {
			const css = getComputedStyle(section);
			const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
			colours = { paper: v("--paper", "#F5F7FB"), ink: v("--ink", "#1B2A4A"), pencil: v("--pencil", "#5B6478"),
				rule: v("--rule", "#DCE3EF"), highlighter: v("--highlighter", "#FFE45C"), onHighlighter: v("--on-highlighter", "#1B2A4A") };
			fonts = { display: v("--font-display", "ui-sans-serif, system-ui, sans-serif"), body: v("--font-body", "ui-sans-serif, system-ui, sans-serif") };
			requestDraw();
		};
		const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
		if (scheme) listen(scheme, "change", readTheme);
		const themeObserver = new MutationObserver(readTheme);
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
		cleanups.push(() => themeObserver.disconnect());
		document.fonts?.ready?.then(() => { if (!destroyed) requestDraw(); });

		// ── visible set
		let visible = { nodes: graph.nodes, edges: graph.edges };
		let visibleIds = new Set(graph.nodes.map((n) => n.id));
		function refreshVisible() {
			const local = state.local && state.focusId ? { id: state.focusId, depth: state.depth } : undefined;
			visible = filterGraph(graph, { ...state.filters, local });
			visibleIds = new Set(visible.nodes.map((n) => n.id));
			if (state.hoverId && !visibleIds.has(state.hoverId)) state.hoverId = undefined;
		}

		// ── sizing
		const resize = () => {
			const rect = stage.getBoundingClientRect();
			state.width = Math.max(1, rect.width); state.height = Math.max(1, rect.height);
			state.dpr = Math.min(3, window.devicePixelRatio || 1);
			canvas.width = Math.round(state.width * state.dpr); canvas.height = Math.round(state.height * state.dpr);
			requestDraw();
		};
		const resizer = new ResizeObserver(resize);
		resizer.observe(stage);
		cleanups.push(() => resizer.disconnect());

		// ── transforms
		const toScreen = (p) => ({ x: p.x * state.view.k + state.view.x, y: p.y * state.view.k + state.view.y });
		const toWorld = (sx, sy) => ({ x: (sx - state.view.x) / state.view.k, y: (sy - state.view.y) / state.view.k });
		const radiusOf = (n) => nodeRadius(n.kind, degree.get(n.id) ?? 0);
		const screenRadius = (n) => Math.max(2, radiusOf(n) * Math.pow(state.view.k, 0.85));
		const panelInset = () => (!panel.hidden && state.width >= 720 ? Math.min(380, state.width * 0.4) : 0);
		const sheetInset = () => (!panel.hidden && state.width < 720 ? Math.min(state.height * 0.55, 420) : 0);

		let tween;
		function setView(target, animate = true) {
			cancelAnimationFrame(tween);
			if (!animate || reduceMotion()) { state.view = target; requestDraw(); return; }
			const from = { ...state.view }, start = performance.now(), ms = 280;
			const step = (now) => {
				const t = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - t, 3);
				state.view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
				draw();
				if (t < 1) tween = requestAnimationFrame(step);
			};
			tween = requestAnimationFrame(step);
		}
		function boundsOf(ids) {
			let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
			for (const id of ids) {
				const s = simById.get(id); if (!s) continue;
				x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
			}
			return Number.isFinite(x0) ? { x0, y0, x1, y1 } : undefined;
		}
		function fitTo(ids, { maxK = 1.6, animate = true } = {}) {
			const b = boundsOf(ids);
			if (!b) return;
			const pad = state.width < 560 ? 36 : 64;
			const legend = state.width >= 720 ? 28 : 0;
			const w = state.width - panelInset() - pad * 2, h = state.height - sheetInset() - pad * 2 - legend;
			const k = Math.max(0.15, Math.min(maxK, w / Math.max(40, b.x1 - b.x0), h / Math.max(40, b.y1 - b.y0)));
			const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
			setView({ k, x: (state.width - panelInset()) / 2 - cx * k, y: (state.height - sheetInset() - legend) / 2 - cy * k }, animate);
		}
		function fit(animate = true) { fitTo(visible.nodes.map((n) => n.id), { animate, maxK: state.local ? 2.2 : 1.6 }); }
		function fitPath() {
			const p = paths.find((x) => x.id === state.pathId);
			if (p) fitTo(p.steps, { maxK: 1.4 });
		}
		function centreOn(id, { zoom } = /** @type {{ zoom?: number }} */ ({})) {
			const s = simById.get(id); if (!s) return;
			const k = zoom ?? Math.max(state.view.k, 1.1);
			setView({ k, x: (state.width - panelInset()) * (state.width < 560 ? 0.36 : 0.5) - s.x * k, y: (state.height - sheetInset()) / 2 - s.y * k });
		}
		function ensureOnScreen(id) {
			const s = simById.get(id); if (!s) return;
			const p = toScreen(s), m = 48;
			if (p.x < m || p.y < m || p.x > state.width - panelInset() - m || p.y > state.height - sheetInset() - m) centreOn(id, { zoom: state.view.k });
		}

		// ── drawing
		let frame = 0, dirty = false, paused = false;
		function requestDraw() {
			dirty = true;
			if (!frame && !destroyed) frame = requestAnimationFrame(loop);
		}
		function loop() {
			frame = 0;
			if (destroyed) return;
			const running = !paused && !sim.settled;
			if (running) {
				sim.tick();
				if (sim.settled) persist();
			}
			if (running || dirty) { dirty = false; draw(); }
			if (!paused && !sim.settled) frame = requestAnimationFrame(loop);
		}
		// Only settled layouts are saved: a half-cooled one would be restored as final and never finish.
		function persist() {
			if (!sim.settled) return;
			const all = readStorage(LAYOUT_KEY);
			writeStorage(LAYOUT_KEY, { ...(all && typeof all === "object" ? all : {}), [shape]: mergeLayout(layoutFor(all, shape), simNodes) });
		}

		function emphasisSet() {
			const id = state.hoverId ?? state.selectedId ?? (state.keyboard ? state.focusId : undefined);
			return id && visibleIds.has(id) ? { id, ids: neighbourhood(visible.edges, id, 1) } : undefined;
		}

		function draw() {
			if (!ctx || !state.width) return;
			const { dpr } = state;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, state.width, state.height);
			const screen = new Map();
			for (const n of visible.nodes) screen.set(n.id, toScreen(simById.get(n.id)));
			const emph = emphasisSet();
			const path = paths.find((p) => p.id === state.pathId);
			const pathSteps = path ? new Map(path.steps.map((id, i) => [id, i + 1])) : new Map();
			const onPath = (id) => pathSteps.has(id);
			const nodeAlpha = (n) => {
				if (emph) return emph.ids.has(n.id) ? 1 : 0.16;
				if (path) return onPath(n.id) ? 1 : 0.5;
				return 1;
			};

			// 1. The path: one continuous highlighter stroke behind everything.
			if (path) {
				const pts = pathPolyline(path.steps.filter((id) => visibleIds.has(id)), screen);
				if (pts.length) {
					ctx.save();
					ctx.strokeStyle = colours.highlighter; ctx.fillStyle = colours.highlighter;
					ctx.lineCap = "round"; ctx.lineJoin = "round";
					ctx.lineWidth = Math.max(7, Math.min(16, 10 * state.view.k));
					ctx.globalAlpha = emph ? 0.45 : 1;
					ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
					if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y);
					for (const s of catmullRom(pts, 0.3)) ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
					ctx.stroke();
					ctx.restore();
				}
			}

			// 2. Edges.
			for (const e of visible.edges) {
				const a = screen.get(e.from), b = screen.get(e.to);
				if (!a || !b) continue;
				const incident = emph && (e.from === emph.id || e.to === emph.id);
				ctx.globalAlpha = emph ? (incident ? 1 : 0.07) : path ? 0.45 : edgeAlpha(e.kind);
				drawEdge(e, a, b, byId.get(e.to));
			}
			ctx.globalAlpha = 1;

			// 3. Halos (mastered / solid), then nodes.
			for (const n of visible.nodes) {
				if (n.status !== "solid" && n.status !== "mastered") continue;
				const p = screen.get(n.id), r = screenRadius(n);
				ctx.globalAlpha = nodeAlpha(n) * (path ? 1 : 0.95);
				ctx.fillStyle = colours.highlighter;
				ctx.beginPath(); ctx.arc(p.x, p.y, r + Math.max(4, r * 0.55), 0, Math.PI * 2); ctx.fill();
			}
			for (const n of visible.nodes) {
				ctx.globalAlpha = nodeAlpha(n) * (n.status === "locked" ? 0.5 : 1);
				drawNode(n, screen.get(n.id), screenRadius(n));
			}
			ctx.globalAlpha = 1;

			// 4. Selection and keyboard focus rings.
			const ring = (id, gap, dash) => {
				const n = byId.get(id), p = screen.get(id);
				if (!n || !p) return;
				ctx.save();
				ctx.strokeStyle = colours.ink; ctx.lineWidth = 2;
				if (dash) ctx.setLineDash(dash);
				ctx.beginPath(); ctx.arc(p.x, p.y, screenRadius(n) + gap, 0, Math.PI * 2); ctx.stroke();
				ctx.restore();
			};
			if (state.selectedId) reticle(state.selectedId);
			if (state.keyboard && state.focusId && state.focusId !== state.selectedId && document.activeElement === canvas) ring(state.focusId, 7, [3, 3]);

			function reticle(id) {
				const n = byId.get(id), p = screen.get(id);
				if (!n || !p) return;
				const r = screenRadius(n) + 7;
				ctx.save();
				ctx.strokeStyle = colours.ink; ctx.lineWidth = 2; ctx.lineCap = "round";
				ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
				// Four short ticks, like a "you are here" mark on a map.
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(p.x + dx * r, p.y + dy * r); ctx.lineTo(p.x + dx * (r + 6), p.y + dy * (r + 6)); }
				ctx.stroke();
				ctx.restore();
			}

			// 5. Labels with greedy collision avoidance (most important first).
			drawLabels(screen, emph, pathSteps);
		}

		function edgeAlpha(kind) { return kind === "about" ? 0.7 : kind === "contains" ? 0.6 : 0.85; }

		function drawEdge(e, a, b, target) {
			ctx.save();
			const k = state.view.k;
			ctx.strokeStyle = e.kind === "link" ? colours.ink : colours.pencil;
			ctx.lineWidth = { prerequisite: 1.25, contains: 0.8, related: 1.3, link: 1.6, about: 0.75 }[e.kind] ?? 1;
			if (e.kind === "related") { ctx.setLineDash([0.5, 4.5]); ctx.lineCap = "round"; ctx.lineWidth = 1.6; }
			let ex = b.x, ey = b.y;
			if (e.kind === "prerequisite" && target) {
				const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
				const back = screenRadius(target) + 2.5;
				ex = b.x - (dx / d) * back; ey = b.y - (dy / d) * back;
				ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
				if (d > back + 6) {
					const size = Math.max(3.5, Math.min(6, 5 * Math.sqrt(k)));
					const ux = dx / d, uy = dy / d;
					ctx.fillStyle = colours.pencil;
					ctx.beginPath();
					ctx.moveTo(ex, ey);
					ctx.lineTo(ex - ux * size * 1.6 - uy * size * 0.8, ey - uy * size * 1.6 + ux * size * 0.8);
					ctx.lineTo(ex - ux * size * 1.6 + uy * size * 0.8, ey - uy * size * 1.6 - ux * size * 0.8);
					ctx.closePath(); ctx.fill();
				}
			} else {
				ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
			}
			ctx.restore();
		}

		function drawNode(n, p, r) {
			const locked = n.status === "locked";
			const colour = locked ? colours.pencil : colours.ink;
			ctx.save();
			if (n.kind === "skill") {
				ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
			} else if (n.kind === "topic") {
				ctx.fillStyle = colours.paper; ctx.strokeStyle = colour; ctx.lineWidth = Math.max(2, r * 0.22);
				ctx.beginPath(); ctx.arc(p.x, p.y, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
			} else if (n.kind === "note") {
				const s = r * 1.8;
				ctx.fillStyle = colours.pencil; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
			} else {
				ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
			}
			if (n.status === "next") {
				ctx.strokeStyle = colours.ink; ctx.lineWidth = 2;
				ctx.beginPath(); ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
			}
			ctx.restore();
		}

		function drawLabels(screen, emph, pathSteps) {
			const k = state.view.k;
			const showAll = k >= 1.35;
			const placed = [];
			// Small labels also keep clear of node discs (but a node's own disc never blocks its label).
			const discs = visible.nodes.map((n) => {
				const p = screen.get(n.id), r = screenRadius(n) + 1;
				return { id: n.id, x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r };
			});
			const candidates = [];
			for (const n of visible.nodes) {
				const focus = n.id === state.hoverId || n.id === state.selectedId || (state.keyboard && n.id === state.focusId);
				const big = n.kind === "skill" || n.kind === "topic";
				const step = pathSteps.get(n.id);
				const near = emph?.ids.has(n.id);
				if (!(focus || big || step || near || showAll)) continue;
				if (emph && !near && !focus) continue;
				const priority = focus ? 0 : step ? 1 : near ? 2 : n.kind === "skill" ? 3 : n.kind === "topic" ? 4 : 5 + 1 / (1 + (degree.get(n.id) ?? 0));
				candidates.push({ n, focus, big, step, priority });
			}
			candidates.sort((a, b) => a.priority - b.priority);
			ctx.textBaseline = "middle";
			for (const c of candidates) {
				const p = screen.get(c.n.id), r = screenRadius(c.n);
				let text = String(c.n.title ?? c.n.id);
				// Long topic titles ("Fourier Transform: seeing the…") keep their name part unless focused.
				if (!c.focus && c.n.kind === "topic" && text.includes(":")) text = text.slice(0, text.indexOf(":"));
				const max = c.focus ? 60 : c.big ? 34 : 28;
				if (text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
				if (c.step) text = `${c.step}. ${text}`;
				ctx.font = c.big ? `600 ${c.n.kind === "skill" ? 15 : 14}px ${fonts.display}` : `${c.focus ? 700 : 400} 13px ${fonts.body}`;
				const w = ctx.measureText(text).width, h = c.big ? 18 : 16;
				const gap = c.n.id === state.selectedId ? 14 : 6;
				// Try the preferred spot first, then the other sides, before giving up on a label.
				/** @type {[string, number, number][]} */
				const spots = c.big
					? [["center", p.x, p.y + r + gap + h / 2], ["center", p.x, p.y - r - gap - h / 2]]
					: [["left", p.x + r + gap, p.y], ["right", p.x - r - gap, p.y], ["center", p.x, p.y - r - 4 - h / 2], ["center", p.x, p.y + r + 4 + h / 2]];
				const boxFor = ([a, sx, sy]) => (a === "center" ? { x0: sx - w / 2 - 2, x1: sx + w / 2 + 2, y0: sy - h / 2, y1: sy + h / 2 }
					: a === "left" ? { x0: sx - 2, x1: sx + w + 2, y0: sy - h / 2, y1: sy + h / 2 } : { x0: sx - w - 2, x1: sx + 2, y0: sy - h / 2, y1: sy + h / 2 });
				const overlaps = (box) => (b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1;
				const inside = (box) => box.x0 >= 2 && box.x1 <= state.width - panelInset() - 2 && box.y0 >= 0 && box.y1 <= state.height - sheetInset();
				const fits = (box) => inside(box) && !(c.priority > 0 && placed.some(overlaps(box)))
					&& !(c.priority >= 2 && !c.big && discs.some((d) => d.id !== c.n.id && overlaps(box)(d)));
				const spot = spots.find((sp) => fits(boxFor(sp)));
				if (!spot) continue;
				const [align, x, y] = spot;
				const box = boxFor(spot);
				placed.push(box);
				ctx.textAlign = align;
				ctx.globalAlpha = c.n.status === "locked" && !c.focus ? 0.7 : 1;
				if (c.step) {
					// Step labels sit on a paper tag so they never put text on the highlighter stroke.
					ctx.fillStyle = colours.paper;
					ctx.fillRect(box.x0 - 3, box.y0 - 1, box.x1 - box.x0 + 6, box.y1 - box.y0 + 2);
				} else {
					ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = colours.paper;
					ctx.strokeText(text, x, y);
				}
				ctx.fillStyle = c.n.kind === "note" ? colours.pencil : colours.ink;
				ctx.fillText(text, x, y);
			}
			ctx.globalAlpha = 1;
		}

		// ── selection, panel and list
		function announce(id) {
			const n = byId.get(id); if (!n) return;
			const links = graph.edges.filter((e) => e.from === id || e.to === id).length;
			live.textContent = `${n.title}. ${kindWords(n, ownerTitle(n))}.${n.status ? ` ${statusWords(n.status)}.` : ""} ${links} ${links === 1 ? "link" : "links"}.`;
		}
		function setFocus(id, { announceIt = true } = {}) {
			state.focusId = id;
			if (state.local) { refreshVisible(); renderList(); }
			if (announceIt) announce(id);
			requestDraw();
		}
		function select(id, { centre = false, focusPanel = false } = {}) {
			const n = byId.get(id);
			if (!n) return;
			// A node hidden by a filter becomes visible again when chosen on purpose.
			if (!visibleIds.has(id)) {
				const key = n.kind === "skill" || n.kind === "subskill" ? "skills" : n.kind === "note" ? "notes" : "topics";
				if (!state.filters[key]) bar.querySelector(`[data-filter="${key}"]`)?.click();
			}
			state.selectedId = id;
			setFocus(id, { announceIt: false });
			history.replaceState(null, "", `#/graph/${enc(id)}`);
			renderPanel(n, focusPanel);
			if (centre || state.local) (state.local ? fit() : centreOn(id));
			else ensureOnScreen(id);
			requestDraw();
		}
		function closePanel({ restoreFocus = false } = {}) {
			if (panel.hidden) return;
			panel.hidden = true; panel.replaceChildren();
			state.selectedId = undefined;
			history.replaceState(null, "", "#/graph");
			if (restoreFocus) canvas.focus();
			requestDraw();
		}

		function nodeButton(id, extra) {
			const n = byId.get(id);
			return el("li", { class: "psi-graph-link-row" },
				el("button", { type: "button", class: "psi-graph-link", onclick: () => select(id, { centre: true }) },
					el("span", { class: "psi-graph-link-title" }, n?.title ?? id),
					el("span", { class: "psi-graph-link-kind" }, shortKind(n))),
				extra);
		}

		function linkGroups(id) {
			/** @type {LinkGroup[]} */
			const groups = [
				["Needs first", (e) => e.kind === "prerequisite" && e.to === id, "from"],
				["Comes before", (e) => e.kind === "prerequisite" && e.from === id, "to"],
				["Part of", (e) => e.kind === "contains" && e.to === id, "from"],
				["Contains", (e) => e.kind === "contains" && e.from === id, "to"],
				["Your links", (e) => e.kind === "link" && (e.from === id || e.to === id), "other"],
				["Related", (e) => e.kind === "related" && (e.from === id || e.to === id), "other"],
				["Notes about this", (e) => e.kind === "about" && e.to === id, "from"],
				["About", (e) => e.kind === "about" && e.from === id, "to"],
			];
			return groups.map(([label, test, end]) => {
				const ids = [...new Set(graph.edges.filter(test).map((e) => (end === "other" ? (e.from === id ? e.to : e.from) : e[end])))];
				return { label, ids };
			}).filter((g) => g.ids.length);
		}

		function renderPanel(n, focusPanel) {
			panel.hidden = false;
			const heading = el("h2", { class: "psi-graph-panel-title", tabindex: "-1" }, n.title);
			const status = statusWords(n.status);
			const progress = progressWords(n);
			const practise = practiseRoute(n);
			const actions = el("div", { class: "psi-graph-actions" },
				practise ? el("button", { type: "button", class: "primary", onclick: () => navigate(practise) }, "Practise this") : null,
				el("button", { type: "button", onclick: () => navigate(askRoute(n)) }, "Ask the tutor"),
				n.kind !== "note" ? el("button", { type: "button", onclick: (event) => makePath(n, event.currentTarget) }, "Make a path to here") : null,
				el("button", { type: "button", "aria-expanded": "false", onclick: (event) => openLinker(n, event.currentTarget) }, "Link to…"));
			const linker = el("div", { class: "psi-graph-linker", hidden: true });
			const groups = linkGroups(n.id).map((g) => el("section", { class: "psi-graph-group" },
				el("h3", {}, g.label),
				el("ul", { class: "psi-graph-links" }, g.ids.map((id) => nodeButton(id, g.label === "Your links"
					? el("button", { type: "button", class: "quiet psi-graph-unlink", "aria-label": `Remove your link to ${byId.get(id)?.title ?? id}`,
						onclick: () => unlink(n.id, id) }, "Unlink") : null)))));
			panel.replaceChildren(...[
				el("div", { class: "psi-graph-panel-head" },
					el("p", { class: "psi-graph-panel-kind" }, kindWords(n, ownerTitle(n))),
					el("button", { type: "button", class: "quiet psi-graph-close", "aria-label": "Close details", onclick: () => closePanel({ restoreFocus: true }) }, "Close")),
				heading,
				status ? el("p", { class: `psi-graph-status is-${n.status}` }, status) : null,
				progress ? el("div", { class: "psi-graph-progress" },
					el("progress", { class: "is-thin", max: "1", value: String(Math.max(0, Math.min(1, Number(n.progress) || 0))), "aria-label": progress }),
					el("span", {}, progress)) : null,
				n.summary && n.summary !== n.title ? el("p", { class: "psi-graph-summary" }, n.summary) : null,
				actions, linker,
				n.href ? el("p", { class: "psi-graph-open" }, el("a", { href: n.href }, n.kind === "skill" ? "Open the skill page" : n.kind === "topic" ? "Open the concept map" : "Open")) : null,
				groups.length ? el("div", { class: "psi-graph-groups" }, groups) : el("p", { class: "muted" }, "No links yet. Use Link to… to connect it."),
			].filter(Boolean));
			if (focusPanel) heading.focus();
		}

		async function makePath(n, button) {
			button.disabled = true;
			const draft = { title: `Path to ${n.title}`, goal: n.summary || n.title, targetId: n.id };
			try {
				if (fixture) throw Object.assign(new Error("fixture"), { local: true });
				const created = await api.post("/api/paths", draft);
				if (created?.id) { navigate(`#/paths/${enc(created.id)}`); return; }
				throw new Error("The path came back without an id");
			} catch (error) {
				if (error.local) {
					const steps = localPathTo(graph, n.id);
					const id = `local-${hashString(n.id)}`;
					paths = [...paths.filter((p) => p.id !== id), { id, ...draft, steps, source: "generated" }];
					renderPathOptions(); pathSelect.value = id; state.pathId = id; renderPathCaption(); fitPath(); requestDraw();
					toast(`Showing a ${steps.length}-step path (preview data, not saved).`);
				} else toast(`Couldn't make the path. ${String(error.message).replace(/\.$/, "")}. Try again.`, { kind: "error" });
			} finally { if (button.isConnected) button.disabled = false; }
		}

		function openLinker(n, button) {
			const box = panel.querySelector(".psi-graph-linker");
			if (!box.hidden) { box.hidden = true; button.setAttribute("aria-expanded", "false"); return; }
			button.setAttribute("aria-expanded", "true");
			const input = el("input", { type: "search", placeholder: "Find a node to link", "aria-label": `Link ${n.title} to`, autocomplete: "off" });
			const out = el("ul", { class: "psi-graph-links", "aria-label": "Nodes to link" });
			const fill = () => {
				const existing = new Set(graph.edges.filter((e) => e.kind === "link" && (e.from === n.id || e.to === n.id)).map((e) => (e.from === n.id ? e.to : e.from)));
				const found = searchNodes(graph.nodes.filter((x) => x.id !== n.id && !existing.has(x.id)), input.value, 6);
				out.replaceChildren(...found.map((m) => el("li", { class: "psi-graph-link-row" },
					el("button", { type: "button", class: "psi-graph-link", onclick: () => link(n.id, m.id) },
						el("span", { class: "psi-graph-link-title" }, m.title), el("span", { class: "psi-graph-link-kind" }, shortKind(m))))));
				if (input.value.trim() && !found.length) out.replaceChildren(el("li", { class: "muted" }, "Nothing matches."));
			};
			input.addEventListener("input", fill);
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") { event.preventDefault(); out.querySelector("button")?.click(); }
				if (event.key === "Escape") { event.stopPropagation(); box.hidden = true; button.setAttribute("aria-expanded", "false"); button.focus(); }
			});
			box.replaceChildren(input, out, el("button", { type: "button", class: "quiet", onclick: () => { box.hidden = true; button.setAttribute("aria-expanded", "false"); button.focus(); } }, "Cancel"));
			box.hidden = false;
			input.focus();
		}

		function rebuildEdges() {
			degree = degreeMap(graph.edges);
			const keep = sim.alpha;
			sim = createSimulation(simNodes, graph.edges, { alpha: Math.max(keep, 0.25), aspect: sim.aspect });
			refreshVisible(); renderList(); requestDraw();
		}
		async function link(from, to) {
			try {
				if (!fixture) await api.post("/api/graph/links", { from, to });
				graph.edges.push({ from, to, kind: "link" });
				rebuildEdges();
				toast(`Linked to ${byId.get(to)?.title ?? to}.`);
				select(from);
			} catch (error) { toast(`Couldn't save the link. ${String(error.message).replace(/\.$/, "")}. Try again.`, { kind: "error" }); }
		}
		async function unlink(a, b) {
			const match = graph.edges.find((e) => e.kind === "link" && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));
			if (!match) return;
			try {
				if (!fixture) await deleteLink(match.from, match.to);
				graph.edges.splice(graph.edges.indexOf(match), 1);
				rebuildEdges();
				select(a);
			} catch (error) { toast(`Couldn't remove the link. ${String(error.message).replace(/\.$/, "")}. Try again.`, { kind: "error" }); }
		}

		function renderList() {
			const status = (n) => (n.status ? `, ${n.status === "locked" ? "locked" : statusWords(n.status).toLowerCase()}` : "");
			const item = (n, children) => el("li", {},
				el("a", { href: `#/graph/${enc(n.id)}`, dataset: { node: n.id }, "aria-current": n.id === state.selectedId ? "true" : null },
					n.title), el("span", { class: "psi-graph-list-meta" }, status(n)),
				children?.length ? el("ul", {}, children) : null);
			const ids = visibleIds;
			const kids = (parent, kind) => visible.edges.filter((e) => e.kind === "contains" && e.from === parent.id)
				.map((e) => byId.get(e.to)).filter((c) => c && c.kind === kind && ids.has(c.id)).map((c) => item(c));
			const group = (label, roots, kind) => roots.length ? el("section", {}, el("h2", {}, label), el("ul", {}, roots.map((r) => item(r, kids(r, kind))))) : null;
			const contained = new Set(visible.edges.filter((e) => e.kind === "contains").map((e) => e.to));
			const loose = visible.nodes.filter((n) => (n.kind === "subskill" || n.kind === "concept") && !contained.has(n.id));
			list.replaceChildren(...[
				el("h2", { class: "psi-graph-list-title" }, "Graph as a list"),
				group("Skills", visible.nodes.filter((n) => n.kind === "skill"), "subskill"),
				group("Topics", visible.nodes.filter((n) => n.kind === "topic"), "concept"),
				loose.length ? el("section", {}, el("h2", {}, "Other steps and concepts"), el("ul", {}, loose.map((n) => item(n)))) : null,
				group("Notes", visible.nodes.filter((n) => n.kind === "note"), "note"),
			].filter(Boolean));
		}
		listen(list, "click", (event) => {
			const a = event.target.closest("a[data-node]");
			if (!a) return;
			event.preventDefault();
			if (state.list) { select(a.dataset.node, { centre: true, focusPanel: true }); renderList(); }
			else { setList(false); select(a.dataset.node, { centre: true, focusPanel: true }); }
		});

		function setList(on) {
			state.list = on;
			listToggle.setAttribute("aria-pressed", String(on));
			list.classList.toggle("psi-sr-only", !on);
			list.classList.toggle("is-shown", on);
			stage.hidden = on;
			if (!on) resize();
			renderList();
		}
		function setLocal(on) {
			state.local = on;
			localSwitch.setAttribute("aria-checked", String(on));
			depthSelect.hidden = !on;
			if (on && !state.focusId) state.focusId = mostConnected();
			refreshVisible(); renderList(); fit();
		}
		function mostConnected() {
			let best, score = -1;
			for (const n of visible.nodes) { const d = degree.get(n.id) ?? 0; if (d > score) { score = d; best = n.id; } }
			return best;
		}

		function renderPathOptions() {
			pathSelect.replaceChildren(el("option", { value: "" }, paths.length ? "No path shown" : "No paths yet"),
				...paths.map((p) => el("option", { value: p.id }, p.title)));
			pathSelect.value = state.pathId;
		}
		function renderPathCaption() {
			const p = paths.find((x) => x.id === state.pathId);
			if (!p) { pathCaption.hidden = true; pathCaption.replaceChildren(); return; }
			const done = p.steps.filter((id) => ["solid", "mastered"].includes(byId.get(id)?.status ?? "")).length;
			pathCaption.hidden = false;
			pathCaption.replaceChildren(...[
				el("span", { class: "psi-graph-path-swatch", "aria-hidden": "true" }),
				el("span", {}, `${p.title}: ${done} of ${p.steps.length} steps done.`),
				p.id.startsWith("local-") ? null : el("a", { href: `#/paths/${enc(p.id)}` }, "Open path"),
			].filter(Boolean));
		}

		// ── search
		let matches = [], active = -1;
		const closeResults = () => { results.hidden = true; searchInput.setAttribute("aria-expanded", "false"); searchInput.removeAttribute("aria-activedescendant"); active = -1; };
		const renderResults = () => {
			matches = searchNodes(graph.nodes, searchInput.value, 8);
			if (!searchInput.value.trim()) { closeResults(); return; }
			results.replaceChildren(...(matches.length ? matches.map((n, i) => el("li", {
				id: `psi-graph-opt-${i}`, role: "option", "aria-selected": String(i === active), class: "psi-graph-option",
				onmousedown: (event) => { event.preventDefault(); choose(i); },
			}, el("span", {}, n.title), el("span", { class: "psi-graph-link-kind" }, shortKind(n)))) : [el("li", { class: "psi-graph-option is-empty", role: "option", "aria-disabled": "true" }, "Nothing matches.")]));
			results.hidden = false; searchInput.setAttribute("aria-expanded", "true");
			if (active >= 0) searchInput.setAttribute("aria-activedescendant", `psi-graph-opt-${active}`); else searchInput.removeAttribute("aria-activedescendant");
		};
		const choose = (i) => {
			const n = matches[i]; if (!n) return;
			closeResults(); searchInput.value = n.title;
			if (state.list) setList(false);
			state.keyboard = true;
			select(n.id, { centre: true });
			canvas.focus();
		};
		listen(searchInput, "input", () => { active = -1; renderResults(); });
		listen(searchInput, "blur", () => setTimeout(closeResults, 120));
		listen(searchInput, "keydown", (event) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				if (!matches.length) return;
				active = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
				renderResults();
			} else if (event.key === "Enter") { event.preventDefault(); choose(active >= 0 ? active : 0); }
			else if (event.key === "Escape") { if (!results.hidden) { event.stopPropagation(); closeResults(); } else { searchInput.value = ""; canvas.focus(); } }
		});

		// ── pointer: pan, zoom, drag, hover, click
		const pointers = new Map();
		let gesture;
		const local = (event) => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
		function hit(sx, sy) {
			let best, bestD = Infinity;
			for (let i = visible.nodes.length - 1; i >= 0; i--) {
				const n = visible.nodes[i], p = toScreen(simById.get(n.id));
				const d = Math.hypot(p.x - sx, p.y - sy), r = Math.max(screenRadius(n) + 4, 11);
				if (d <= r && d < bestD) { bestD = d; best = n.id; }
			}
			return best;
		}
		function zoomAt(sx, sy, factor) {
			const k = Math.max(0.15, Math.min(4, state.view.k * factor));
			const w = toWorld(sx, sy);
			state.view = { k, x: sx - w.x * k, y: sy - w.y * k };
			requestDraw();
		}
		listen(canvas, "pointerdown", (event) => {
			canvas.setPointerCapture?.(event.pointerId);
			const p = local(event);
			pointers.set(event.pointerId, p);
			cancelAnimationFrame(tween);
			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				if (gesture?.node) releaseNode(gesture.node);
				gesture = { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), k: state.view.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
				return;
			}
			const id = hit(p.x, p.y);
			gesture = { start: p, last: p, moved: false, node: id ? simById.get(id) : undefined, id };
		});
		listen(canvas, "pointermove", (event) => {
			const p = local(event);
			if (!pointers.has(event.pointerId)) {
				const id = hit(p.x, p.y);
				if (id !== state.hoverId) { state.hoverId = id; canvas.style.cursor = id ? "pointer" : "grab"; requestDraw(); }
				return;
			}
			pointers.set(event.pointerId, p);
			if (gesture?.pinch && pointers.size >= 2) {
				const [a, b] = [...pointers.values()];
				const dist = Math.hypot(a.x - b.x, a.y - b.y);
				const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
				state.view.x += mid.x - gesture.mid.x; state.view.y += mid.y - gesture.mid.y;
				gesture.mid = mid;
				zoomAt(mid.x, mid.y, (gesture.k * dist / Math.max(1, gesture.dist)) / state.view.k);
				return;
			}
			if (!gesture) return;
			if (!gesture.moved && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) < 4) return;
			gesture.moved = true;
			if (gesture.node) {
				const w = toWorld(p.x, p.y);
				gesture.node.fx = w.x; gesture.node.fy = w.y;
				sim.alphaTarget = 0.25; sim.reheat(0.25);
				canvas.style.cursor = "grabbing";
				requestDraw();
			} else {
				state.view.x += p.x - gesture.last.x; state.view.y += p.y - gesture.last.y;
				canvas.style.cursor = "grabbing";
				requestDraw();
			}
			gesture.last = p;
		});
		function releaseNode(node) {
			node.fx = null; node.fy = null;
			sim.alphaTarget = 0;
			requestDraw();
		}
		const endPointer = (event) => {
			pointers.delete(event.pointerId);
			if (!gesture) return;
			if (gesture.pinch) { if (pointers.size === 0) gesture = undefined; return; }
			if (gesture.node) releaseNode(gesture.node);
			if (!gesture.moved && event.type === "pointerup") {
				state.keyboard = false;
				if (gesture.id) select(gesture.id);
				else if (!panel.hidden) closePanel();
				else if (state.focusId) { state.focusId = undefined; requestDraw(); }
			}
			canvas.style.cursor = state.hoverId ? "pointer" : "grab";
			gesture = undefined;
		};
		listen(canvas, "pointerup", endPointer);
		listen(canvas, "pointercancel", endPointer);
		listen(canvas, "pointerleave", () => { if (state.hoverId && !pointers.size) { state.hoverId = undefined; requestDraw(); } });
		listen(canvas, "wheel", (event) => {
			event.preventDefault();
			cancelAnimationFrame(tween);
			const p = local(event);
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			zoomAt(p.x, p.y, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0018)));
		}, { passive: false });

		// ── keyboard
		listen(canvas, "focus", () => { if (state.keyboard || state.focusId) requestDraw(); });
		listen(canvas, "blur", () => requestDraw());
		listen(canvas, "keydown", (event) => {
			const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[event.key];
			if (dir) {
				event.preventDefault();
				state.keyboard = true;
				if (!state.focusId || !visibleIds.has(state.focusId)) { setFocus(mostConnected()); ensureOnScreen(state.focusId); return; }
				const from = simById.get(state.focusId);
				const near = neighbourhood(visible.edges, state.focusId, 1);
				const pick = (ids) => nearestInDirection(from, [...ids].map((id) => simById.get(id)).filter(Boolean), dir);
				const next = pick(near) ?? pick(visibleIds);
				if (next) {
					if (state.selectedId && !panel.hidden) select(next);
					else { setFocus(next); ensureOnScreen(next); }
				}
			} else if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				state.keyboard = true;
				const id = state.focusId && visibleIds.has(state.focusId) ? state.focusId : mostConnected();
				if (id) select(id, { focusPanel: true });
			} else if (event.key === "Escape") {
				if (!panel.hidden) { event.stopPropagation(); closePanel(); }
			} else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(state.width / 2, state.height / 2, 1.25); }
			else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomAt(state.width / 2, state.height / 2, 0.8); }
		});
		listen(panel, "keydown", (event) => {
			if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); closePanel({ restoreFocus: true }); }
		});
		listen(window, "keydown", (event) => {
			if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey) return;
			if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
			event.preventDefault();
			searchInput.focus(); searchInput.select();
		});

		// ── lifecycle
		listen(document, "visibilitychange", () => {
			paused = document.hidden;
			if (!paused) requestDraw();
			else { cancelAnimationFrame(frame); frame = 0; persist(); }
		});

		readTheme();
		renderPathOptions();
		refreshVisible();
		renderList();
		resize();
		sim.aspect = state.width / state.height;
		// Settle a fresh layout before the first paint so it doesn't fly in.
		const budget = performance.now() + 160;
		while (freshShare > 0.5 && sim.alpha > 0.02 && performance.now() < budget) sim.tick();
		if (focus && byId.has(focus)) {
			state.keyboard = true;
			select(focus, { centre: false });
			const s = simById.get(focus), k = 1.25;
			setView({ k, x: (state.width - panelInset()) * (state.width < 560 ? 0.36 : 0.5) - s.x * k, y: (state.height - sheetInset()) / 2 - s.y * k }, false);
		} else {
			if (focus) toast("That node isn't in your graph any more. Showing the whole graph.");
			fit(false);
		}
		requestDraw();
		return {
			destroy() { cancelAnimationFrame(frame); cancelAnimationFrame(tween); persist(); },
			debug: { state, get sim() { return sim; }, simById, select, setLocal, setList, fit, get paths() { return paths; }, pathSelect },
		};
	}

	function destroy() {
		if (destroyed) return;
		destroyed = true;
		view?.destroy();
		for (const off of cleanups.splice(0)) off();
	}
	const handle = { destroy };
	Object.defineProperty(handle, "debug", { get: () => view?.debug });
	return handle;
}

const LEGEND = `<ul>
<li><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" class="ink-fill"/></svg>Skill</li>
<li><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" class="ink-ring"/></svg>Topic</li>
<li><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" class="ink-fill"/></svg>Step or concept</li>
<li><svg viewBox="0 0 16 16"><rect x="5" y="5" width="6" height="6" class="pencil-fill"/></svg>Note</li>
<li><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" class="halo"/><circle cx="8" cy="8" r="3" class="ink-fill"/></svg>Solid or mastered</li>
<li><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" class="ink-ring thin"/><circle cx="8" cy="8" r="2.5" class="ink-fill"/></svg>Next up</li>
</ul>`;
