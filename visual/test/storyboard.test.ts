import { test } from "node:test";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import type { Storyboard } from "../../core/src/types.ts";
import { renderStoryboardHtml, validateStoryboard } from "../src/storyboard-html.ts";
import { PALETTES, paletteFor } from "../src/palettes.ts";

function story(): Storyboard {
	return {
		id: "demo", title: "A story", topic: "light", style: "kurzgesagt",
		scenes: [{ id: "one", durationSec: 8, narration: "Hello", elements: [
			{ id: "sun", kind: "circle", props: { x: 400, y: 200, r: 80 } },
		] }],
	};
}

test("valid storyboard and palette selection", () => {
	assert.deepEqual(validateStoryboard(story()), []);
	assert.equal(paletteFor("3b1b").name, "3b1b");
	assert.equal(paletteFor("3b1b").bg, "#0f0f0f");
	assert.equal(paletteFor("kurzgesagt", "kurzgesagt-bio"), PALETTES["kurzgesagt-bio"]);
	assert.equal(paletteFor("plain", "nonexistent"), PALETTES.plain);
	assert.equal(paletteFor("plain", "__proto__"), PALETTES.plain);
	for (const key of ["kurzgesagt", "kurzgesagt-space", "kurzgesagt-bio", "3b1b", "plain"]) {
		assert.ok(Object.hasOwn(PALETTES, key));
	}
});

test("validation reports malformed top-level values", () => {
	for (const input of [null, {}, { ...story(), scenes: undefined }, { ...story(), scenes: [] }]) {
		assert.ok(validateStoryboard(input).length);
	}
	for (const field of ["id", "title", "topic", "style"]) {
		assert.ok(validateStoryboard({ ...story(), [field]: "" }).length, field);
	}
});

test("validation rejects duplicate ids, including nested group children", () => {
	const sb = story();
	sb.scenes.push(structuredClone(sb.scenes[0]!));
	assert.match(validateStoryboard(sb).join(" "), /duplicate scene/);
	sb.scenes[1]!.id = "two";
	assert.match(validateStoryboard(sb).join(" "), /duplicate element/);
	sb.scenes.pop();
	sb.scenes[0]!.elements.push({ id: "group", kind: "group", props: { children: [
		{ id: "sun", kind: "creature", props: { x: 0, y: 0 } },
	] } });
	assert.match(validateStoryboard(sb).join(" "), /duplicate element/);
});

test("validation checks duration, narration, props, kinds and animations", () => {
	for (const durationSec of [0, -1, NaN, Infinity]) {
		const sb = story(); sb.scenes[0]!.durationSec = durationSec;
		assert.match(validateStoryboard(sb).join(" "), /durationSec/);
	}
	const mutations = [
		(sb: Storyboard) => { delete sb.scenes[0]!.elements[0]!.props.r; },
		(sb: Storyboard) => { sb.scenes[0]!.elements[0]!.props.x = NaN; },
		(sb: Storyboard) => { sb.scenes[0]!.elements[0]!.props.r = Infinity; },
		(sb: Storyboard) => { Object.assign(sb.scenes[0]!.elements[0]!, { kind: "triangle" }); },
		(sb: Storyboard) => { Object.assign(sb.scenes[0]!.elements[0]!, { enter: { type: "explode" } }); },
		(sb: Storyboard) => { Object.assign(sb.scenes[0]!, { narration: 12 }); },
		(sb: Storyboard) => { sb.scenes[0]!.elements[0]!.props = {}; },
		(sb: Storyboard) => { Object.assign(sb.scenes[0]!, { elements: null }); },
	];
	for (const mutate of mutations) {
		const sb = story(); mutate(sb); assert.ok(validateStoryboard(sb).length);
	}
});

function graph(fn: string): Storyboard {
	const sb = story(); sb.scenes[0]!.elements = [{ id: "curve", kind: "graph", props: {
		x: 100, y: 100, w: 800, h: 400, domain: [-2, 2], fn,
	} }]; return sb;
}

test("graph tokenizer and grammar reject executable code and unsupported syntax", () => {
	for (const fn of ["fetch('x')", "process.exit(0)", "x; globalThis.y=1", "this.constructor",
		"Math.sin(x)+ (()=>1)()", "", "x[0]", "`x`", "Math.random()", "Math.sin.constructor(x)",
		"x=1", "(x,1)", "Math.PI()", "Math.sin(x) garbage", "1e999", "Math.sin", "x x", "x/*hi*/+1"]) {
		assert.match(validateStoryboard(graph(fn)).join(" "), /graph.fn/, fn);
	}
});

test("safe graph expressions parse and render, including discontinuities", () => {
	for (const fn of ["Math.sin(x)", "x*x - 2*x + 1", "Math.exp(-x*x/2)", "Math.pow(x, 2)",
		"Math.max(Math.abs(x), Math.PI / 2)", "x**2 + 1e-3", "1/x", "Math.sqrt(-1)", "2", "-.5*x"]) {
		assert.deepEqual(validateStoryboard(graph(fn)), [], fn);
		assert.ok(renderStoryboardHtml(graph(fn)).includes("data-element=\"curve\""));
	}
	const bad = graph("x"); bad.scenes[0]!.elements[0]!.props.domain = [0, Infinity];
	assert.match(validateStoryboard(bad).join(" "), /domain/);
});

test("all user text is escaped and JSON cannot terminate its script island", () => {
	const sb = story(), payload = '</script><img src=x onerror=alert(1)>\u2028\u2029';
	sb.title = payload; sb.topic = '<topic & "quote">';
	sb.scenes[0]!.narration = '<b>&"';
	sb.scenes.push({ id: 'two"<>', durationSec: 7, narration: payload, elements: [
		{ id: payload, kind: "text", props: { x: 20, y: 50, text: payload } },
		{ id: "eq", kind: "equation", props: { x: 40, y: 200, tex: payload } },
	] });
	const html = renderStoryboardHtml(sb);
	assert.ok(html.includes("&lt;b&gt;&amp;&quot;"));
	assert.ok(html.includes("&lt;/script&gt;&lt;img"));
	assert.ok(!html.includes("</script><img"));
	const island = /<script type="application\/json" id="psi-data">([\s\S]*?)<\/script>/.exec(html)![1]!;
	assert.ok(!island.toLowerCase().includes("</script"));
	assert.ok(!island.includes("\u2028") && !island.includes("\u2029"));
	assert.equal(JSON.parse(island).storyboard.title, payload);
	assert.equal((html.match(/<script\b/g) ?? []).length, 3);
	assert.equal((html.match(/<\/script>/g) ?? []).length, 3);
});

test("standalone document pins its only external resources and exposes accessible player controls", () => {
	const html = renderStoryboardHtml(story(), { autoplay: true, speech: true });
	assert.match(html, /^<!doctype html>/i);
	assert.ok(html.includes('<svg id="stage"'));
	assert.ok(html.includes('viewBox="0 0 1600 900"'));
	const urls = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
	assert.equal(urls.length, 2);
	for (const url of urls) assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/katex@0\.16\.11\//);
	for (const id of ["play", "prev", "next", "scrub", "caption", "title-card"]) {
		assert.ok(html.includes('id="' + id + '"'));
	}
	assert.ok(html.includes('"speech":true'));
	assert.ok(html.includes('"autoplay":true'));
	assert.equal(html, renderStoryboardHtml(story(), { autoplay: true, speech: true }));
});

test("render throws clear errors for invalid storyboards", () => {
	assert.throws(() => renderStoryboardHtml({ ...story(), scenes: [] }), /Invalid storyboard:[\s\S]*scenes/);
});

test("all kinds render, nested transforms persist, and particles are deterministic and capped", () => {
	const sb = story();
	sb.scenes[0]!.elements.push(
		{ id: "rect", kind: "rect", props: { x: 0, y: 0, w: 30, h: 40, rx: 8 } },
		{ id: "words", kind: "text", props: { x: 10, y: 30, text: '<hello & "world">' } },
		{ id: "arrow", kind: "arrow", props: { x1: 0, y1: 0, x2: 30, y2: 50 } },
		{ id: "path", kind: "path", props: { d: "M 0 0 L 30 30" } },
		{ id: "equation", kind: "equation", props: { x: 20, y: 70, tex: "\\lambda^{-4}" } },
		{ id: "vector", kind: "vector", props: { x: 10, y: 10, dx: 25, dy: 30, label: "a < b" } },
		{ id: "particles", kind: "particles", props: { x: 0, y: 0, w: 500, h: 400, count: 500 } },
		{ id: "group", kind: "group", props: { x: 10, y: 20, scale: 2, rotate: 30, children: [
			{ id: "blob", kind: "creature", props: { x: 0, y: 0, mood: "surprised" } },
		] } },
	);
	assert.deepEqual(validateStoryboard(sb), []);
	const html = renderStoryboardHtml(sb);
	assert.equal(html, renderStoryboardHtml(sb));
	assert.equal((html.match(/<g data-drift=/g) ?? []).length, 300);
	assert.ok(html.includes('transform="translate(10 20) scale(2) rotate(30)"'));
	assert.ok(html.includes("&lt;hello &amp; &quot;world&quot;&gt;"));
	assert.ok(html.includes("a &lt; b"));
	assert.ok(html.includes('<code>\\lambda^{-4}</code>'));
	assert.ok(html.includes('marker-end="url(#psi-arrow)"'));
	assert.ok(html.includes('id="psi-grain"'));
	assert.ok(!renderStoryboardHtml({ ...sb, style: "3b1b" }).includes('filter="url(#psi-grain)"'));
});

test("graph samples map to the plot box and break across non-finite values", () => {
	const sb = graph("x");
	const html = renderStoryboardHtml(sb);
	assert.ok(html.includes("M100.00 500.00 L104.00 498.00"));
	assert.ok(html.includes("L900.00 100.00"));
	assert.ok(!renderStoryboardHtml(graph("1/x")).includes("NaN"));
	const invalid = story();
	invalid.scenes[0]!.elements = [{ id: "bad-group", kind: "group", props: { children: "invalid" } }];
	assert.match(validateStoryboard(invalid).join(" "), /children must be an array/);
});


// Execute the emitted player, including URL navigation, without depending on external browser packages.
function player(hash: string, autoplay = false) {
	const sb = story();
	sb.scenes[0]!.elements = [];
	sb.scenes.push({ id: "two", durationSec: 6, narration: "Second scene", elements: [] });
	const listeners = new Map<string, () => void>();
	const nodes = new Map<string, any>();
	for (const id of ["stage", "play", "scrub", "caption", "clock", "title-card", "prev", "next",
		"scene-label", "katex-script"]) {
		nodes.set(id, { style: {}, textContent: "", addEventListener() {}, setAttribute() {} });
	}
	nodes.set("psi-data", { textContent: JSON.stringify({ storyboard: sb, autoplay }) });
	const scenes = sb.scenes.map(() => ({ style: {}, querySelectorAll: () => [] }));
	const code = { textContent: "" };
	const equation = { textContent: "I \\propto \\lambda^{-4}", dataset: {} as Record<string, string>,
		querySelector: () => code };
	const window = { location: { hash }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) };
	const html = renderStoryboardHtml(sb);
	const source = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
	runInNewContext(source, {
		window, URLSearchParams, performance: { now: () => 0 }, requestAnimationFrame() {},
		document: {
			getElementById: (id: string) => nodes.get(id), addEventListener() {},
			querySelectorAll: (selector: string) => selector === ".scene" ? scenes : [equation],
		},
	}, { timeout: 1000 });
	return { nodes, scenes, window, listeners, code, equation };
}

test("scene hashes seek using one-based numbers and pause even with autoplay", () => {
	const app = player("#scene=2&t=2.5", true);
	assert.equal(app.nodes.get("clock").textContent, "10.5 / 14.0 s");
	assert.equal(app.nodes.get("play").textContent, "Play");
	assert.equal(app.nodes.get("title-card").hidden, true);
	assert.equal(app.nodes.get("scene-label").textContent, "SCENE 2 / 2");
	assert.equal((app.scenes[1]!.style as { display?: string }).display, "inline");
	app.window.location.hash = "#scene=1&t=1";
	app.listeners.get("hashchange")!();
	assert.equal(app.nodes.get("clock").textContent, "1.0 / 14.0 s");
});

test("hash controls clamp bounds without accidentally entering the next scene", () => {
	for (const [hash, scene, clock] of [
		["#scene=-5&t=-2", 1, "0.0 / 14.0 s"],
		["#scene=999&t=999", 2, "14.0 / 14.0 s"],
		["#scene=1&t=999", 1, "8.0 / 14.0 s"],
		["#scene=NaN&t=Infinity", 1, "0.0 / 14.0 s"],
		["#t=2.5", 1, "2.5 / 14.0 s"],
	] as const) {
		const app = player(hash);
		assert.equal(app.nodes.get("scene-label").textContent, `SCENE ${scene} / 2`);
		assert.equal(app.nodes.get("clock").textContent, clock);
	}
	assert.equal(player("").nodes.get("title-card").hidden, false);
});

test("offline equations stay readable while retaining source for late KaTeX loading", () => {
	const app = player("");
	assert.equal(app.code.textContent, "I ∝ λ⁻⁴");
	assert.equal(app.equation.dataset.tex, "I \\propto \\lambda^{-4}");
});
