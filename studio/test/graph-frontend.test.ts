import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Variable specifiers keep browser-only JS outside the TS project's no-allowJs boundary.
const graphPath = "../public/js/graph.js";
const shellPath = "../public/app.js";
const g = await import(graphPath);
const { parseRoute } = await import(shellPath);

type P = { id: string; x: number; y: number; mass?: number };
const fixture = JSON.parse(await readFile(new URL("../public/js/graph-fixture.json", import.meta.url), "utf8"));

test("graph routes keep node ids with colons and slashes", () => {
	assert.deepEqual(parseRoute("#/graph"), { route: "graph", params: { nodeId: "" } });
	assert.deepEqual(parseRoute(`#/graph/${encodeURIComponent("subskill:sql-lab/joins")}`),
		{ route: "graph", params: { nodeId: "subskill:sql-lab/joins" } });
	assert.deepEqual(parseRoute("#/graph/subskill:sql-lab/joins"), { route: "graph", params: { nodeId: "subskill:sql-lab/joins" } });
});

test("fixture is a realistic, internally consistent knowledge graph", () => {
	const ids = new Set(fixture.graph.nodes.map((n: { id: string }) => n.id));
	assert.ok(ids.size >= 60 && ids.size <= 150, `node count ${ids.size}`);
	assert.equal(ids.size, fixture.graph.nodes.length);
	const kinds = new Set(fixture.graph.nodes.map((n: { kind: string }) => n.kind));
	for (const k of ["skill", "subskill", "topic", "concept", "note"]) assert.ok(kinds.has(k), k);
	const edgeKinds = new Set(fixture.graph.edges.map((e: { kind: string }) => e.kind));
	for (const k of ["prerequisite", "contains", "related", "about", "link"]) assert.ok(edgeKinds.has(k), k);
	for (const e of fixture.graph.edges) assert.ok(ids.has(e.from) && ids.has(e.to), JSON.stringify(e));
	for (const p of fixture.paths) for (const s of p.steps) assert.ok(ids.has(s), s);
});

test("seeded layout is deterministic and honours saved positions", () => {
	const { nodes, edges } = fixture.graph;
	const a = g.seedLayout(nodes, edges), b = g.seedLayout([...nodes].reverse(), [...edges].reverse());
	for (const n of nodes) assert.deepEqual(a.get(n.id), b.get(n.id));
	for (const p of a.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
	const first = nodes[0].id;
	const saved = g.seedLayout(nodes, edges, { [first]: [123, -45] });
	assert.deepEqual(saved.get(first), { x: 123, y: -45 });
	// A new node starts beside an already placed neighbour instead of at its cluster seed.
	const skill = nodes.find((n: { kind: string }) => n.kind === "skill");
	const layout = g.seedLayout([...nodes, { id: "subskill:x/new", kind: "subskill", title: "New" }],
		[...edges, { from: skill.id, to: "subskill:x/new", kind: "contains" }], { [skill.id]: [1000, 1000] });
	const p = layout.get("subskill:x/new");
	assert.ok(Math.hypot(p.x - 1000, p.y - 1000) <= 50, JSON.stringify(p));
});

test("seeded random and hashes are stable", () => {
	assert.equal(g.hashString("skill:sql-lab"), g.hashString("skill:sql-lab"));
	assert.notEqual(g.hashString("a"), g.hashString("b"));
	const r1 = g.seededRandom(7), r2 = g.seededRandom(7);
	for (let i = 0; i < 5; i++) { const v = r1(); assert.equal(v, r2()); assert.ok(v >= 0 && v < 1); }
});

test("Barnes-Hut repulsion approximates the exact sum", () => {
	const rnd = g.seededRandom(3);
	const points: P[] = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, x: rnd() * 800, y: rnd() * 600, mass: 1 + rnd() }));
	const tree = g.buildQuadtree(points);
	assert.ok(Math.abs(tree.mass - points.reduce((s, p) => s + (p.mass ?? 1), 0)) < 1e-6);
	let worst = 0;
	for (const p of points.slice(0, 40)) {
		let ex = 0, ey = 0;
		for (const q of points) {
			if (q === p) continue;
			const dx = p.x - q.x, dy = p.y - q.y, d2 = Math.max(4, dx * dx + dy * dy);
			ex += dx * (q.mass ?? 1) / d2; ey += dy * (q.mass ?? 1) / d2;
		}
		const exact0 = g.repulsion(tree, p, { theta: 0 });
		assert.ok(Math.abs(exact0.fx - ex) < 1e-9 && Math.abs(exact0.fy - ey) < 1e-9);
		const approx = g.repulsion(tree, p, { theta: 0.5 });
		worst = Math.max(worst, Math.hypot(approx.fx - ex, approx.fy - ey) / Math.max(1e-9, Math.hypot(ex, ey)));
	}
	assert.ok(worst < 0.1, `relative error ${worst}`);
	assert.equal(g.buildQuadtree([]), null);
	// Coincident points still push apart and never produce NaN.
	const same: P[] = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 0 }, { id: "c", x: 0, y: 0 }];
	const f = g.repulsion(g.buildQuadtree(same), same[0]);
	assert.ok(Number.isFinite(f.fx) && Number.isFinite(f.fy) && Math.hypot(f.fx, f.fy) > 0);
});

test("simulation cools to settled with finite positions on 500 nodes", () => {
	const big = g.syntheticGraph(500);
	assert.equal(big.nodes.length, 500);
	const seeds = g.seedLayout(big.nodes, big.edges);
	const nodes = big.nodes.map((n: { id: string }) => ({ id: n.id, ...seeds.get(n.id) }));
	const sim = g.createSimulation(nodes, big.edges);
	const start = performance.now();
	let ticks = 0;
	while (!sim.settled && ticks < 2000) { sim.tick(); ticks++; }
	const ms = (performance.now() - start) / ticks;
	assert.ok(sim.settled, "settles");
	assert.ok(ms < 16, `tick takes ${ms.toFixed(2)} ms`);
	for (const n of nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
	// Pinned nodes stay put.
	nodes[0].fx = 5; nodes[0].fy = 6; sim.reheat(0.5); sim.tick();
	assert.equal(nodes[0].x, 5); assert.equal(nodes[0].y, 6);
});

test("contained steps settle near their skill and connected nodes closer than unrelated ones", () => {
	const { nodes, edges } = fixture.graph;
	const seeds = g.seedLayout(nodes, edges);
	const sim = g.createSimulation(nodes.map((n: { id: string }) => ({ id: n.id, ...seeds.get(n.id) })), edges);
	while (!sim.settled) sim.tick();
	const at = new Map(sim.nodes.map((n: P) => [n.id, n]));
	const dist = (a: string, b: string) => { const p = at.get(a) as P, q = at.get(b) as P; return Math.hypot(p.x - q.x, p.y - q.y); };
	assert.ok(dist("skill:python-foundations", "subskill:python-foundations/strings")
		< dist("skill:python-foundations", "topic:fourier-transform"));
});

test("neighbourhood and filters", () => {
	const edges = [{ from: "a", to: "b", kind: "contains" }, { from: "b", to: "c", kind: "prerequisite" }, { from: "d", to: "c", kind: "related" }];
	assert.deepEqual([...g.neighbourhood(edges, "a", 1)].sort(), ["a", "b"]);
	assert.deepEqual([...g.neighbourhood(edges, "a", 2)].sort(), ["a", "b", "c"]);
	assert.deepEqual([...g.neighbourhood(edges, "c", 1)].sort(), ["b", "c", "d"]);
	assert.deepEqual([...g.neighbourhood(edges, "z", 2)], ["z"]);

	const graph = fixture.graph;
	const noNotes = g.filterGraph(graph, { notes: false });
	assert.ok(noNotes.nodes.every((n: { kind: string }) => n.kind !== "note"));
	assert.ok(noNotes.edges.every((e: { kind: string }) => e.kind !== "about"));
	const noSkills = g.filterGraph(graph, { skills: false, related: false });
	assert.ok(noSkills.nodes.every((n: { kind: string }) => n.kind !== "skill" && n.kind !== "subskill"));
	assert.ok(noSkills.edges.every((e: { kind: string }) => e.kind !== "related"));
	const local = g.filterGraph(graph, { local: { id: "skill:python-foundations", depth: 1 } });
	const near = g.neighbourhood(graph.edges, "skill:python-foundations", 1);
	assert.equal(local.nodes.length, near.size);
	assert.ok(local.edges.every((e: { from: string; to: string }) => near.has(e.from) && near.has(e.to)));
	const deeper = g.filterGraph(graph, { local: { id: "skill:python-foundations", depth: 2 } });
	assert.ok(deeper.nodes.length > local.nodes.length);
});

test("arrow keys pick the closest node in that direction", () => {
	const from = { id: "o", x: 0, y: 0 };
	const c = [{ id: "r1", x: 50, y: 5 }, { id: "r2", x: 40, y: 30 }, { id: "l", x: -40, y: 0 }, { id: "u", x: 0, y: -60 },
		{ id: "d", x: 3, y: 90 }, { id: "o", x: 0, y: 0 }];
	assert.equal(g.nearestInDirection(from, c, "right"), "r1");
	assert.equal(g.nearestInDirection(from, c, "left"), "l");
	assert.equal(g.nearestInDirection(from, c, "up"), "u");
	assert.equal(g.nearestInDirection(from, c, "down"), "d");
	assert.equal(g.nearestInDirection(from, [{ id: "behind", x: -10, y: 0 }], "right"), undefined);
	assert.equal(g.nearestInDirection(from, [{ id: "steep", x: 1, y: 50 }], "right"), undefined);
	assert.equal(g.nearestInDirection(from, c, "sideways"), undefined);
});

test("path polyline follows step order and the spline passes through every step", () => {
	const pos = new Map([["a", { x: 0, y: 0 }], ["b", { x: 10, y: 0 }], ["c", { x: 10, y: 10 }]]);
	const line = g.pathPolyline(["a", "missing", "b", "b", "c"], pos);
	assert.deepEqual(line.map((p: P) => p.id), ["a", "b", "c"]);
	assert.deepEqual(g.pathPolyline([], pos), []);
	const segs = g.catmullRom(line);
	assert.equal(segs.length, 2);
	assert.deepEqual(segs[0].to, { x: 10, y: 0 });
	assert.deepEqual(segs[1].to, { x: 10, y: 10 });
	assert.deepEqual(g.catmullRom([{ x: 1, y: 1 }]), []);
});

test("search ranks prefix, word start, substring, then summary", () => {
	const nodes = [
		{ id: "concept:t/x", kind: "concept", title: "Strings in practice" },
		{ id: "subskill:s/strings", kind: "subskill", title: "Transform strings" },
		{ id: "skill:s", kind: "skill", title: "Substring tricks" },
		{ id: "note:1", kind: "note", title: "A note", summary: "uses strings a lot" },
	];
	assert.deepEqual(g.searchNodes(nodes, "str").map((n: { id: string }) => n.id), ["concept:t/x", "subskill:s/strings", "skill:s", "note:1"]);
	assert.deepEqual(g.searchNodes(nodes, "  "), []);
	assert.equal(g.searchNodes(nodes, "s", 2).length, 2);
});

test("words, routes and sizes read plainly", () => {
	assert.equal(g.kindWords({ kind: "subskill" }, "Python foundations"), "Step in Python foundations");
	assert.equal(g.kindWords({ kind: "note" }), "Note from memory");
	assert.equal(g.statusWords("next"), "Next up");
	assert.equal(g.statusWords(undefined), "");
	assert.equal(g.progressWords({ kind: "skill", progress: 0.31 }), "6.2 of 20 hours");
	assert.equal(g.progressWords({ kind: "subskill", progress: 0.5 }), "50% of its challenges solved");
	assert.equal(g.progressWords({ kind: "note" }), "");
	assert.ok(g.nodeRadius("skill", 9) > g.nodeRadius("topic", 9));
	assert.ok(g.nodeRadius("topic", 0) > g.nodeRadius("concept", 0));
	assert.ok(g.nodeRadius("concept", 16) > g.nodeRadius("concept", 1));
	assert.ok(g.nodeRadius("concept", 1) > g.nodeRadius("note", 1));
	assert.equal(g.practiseRoute({ id: "subskill:python-foundations/strings", kind: "subskill", title: "Transform strings" }),
		"#/new?skill=python-foundations&prompt=%2Fpractice%20Transform%20strings");
	assert.equal(g.practiseRoute({ id: "concept:fourier-transform/sinusoids", kind: "concept", title: "Sinusoids" }),
		"#/new?topic=fourier-transform&prompt=Teach%20me%20Sinusoids");
	assert.equal(g.practiseRoute({ id: "note:1", kind: "note", title: "x" }), "");
	assert.match(g.askRoute({ id: "skill:sql-lab", kind: "skill", title: "SQL" }), /^#\/new\?skill=sql-lab&prompt=/);
});

test("local path to a target lists unfinished prerequisites in order", () => {
	const graph = {
		nodes: [{ id: "a", status: "solid" }, { id: "b" }, { id: "c" }, { id: "d" }],
		edges: [{ from: "a", to: "b", kind: "prerequisite" }, { from: "b", to: "d", kind: "prerequisite" },
			{ from: "c", to: "d", kind: "prerequisite" }, { from: "a", to: "c", kind: "related" }],
	};
	assert.deepEqual(g.localPathTo(graph, "d"), ["b", "c", "d"]);
	assert.deepEqual(g.localPathTo(graph, "missing"), []);
});

test("layout merge keeps other nodes and rounds positions", () => {
	const out = g.mergeLayout({ keep: [1, 2] }, [{ id: "n", x: 1.234, y: -5.678 }, { id: "bad", x: NaN, y: 0 }]);
	assert.deepEqual(out, { keep: [1, 2], n: [1.2, -5.7] });
	assert.deepEqual(g.mergeLayout(null, []), {});
});
