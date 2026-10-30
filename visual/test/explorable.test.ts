import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { ExplorableSpec } from "../../core/src/types.ts";
import { renderExplorableHtml, validateExplorable } from "../src/explorable.ts";

const templates: ExplorableSpec["template"][] = [
	"function-plot", "linear-transform", "vector-field", "fourier-epicycles", "probability-sim", "exponential-growth",
];
function demo(template: ExplorableSpec["template"] = "function-plot"): ExplorableSpec {
	return JSON.parse(readFileSync(new URL(`../../examples/explorables-demo/${template}.json`, import.meta.url), "utf8"));
}
function invalid(spec: unknown, message?: RegExp): void {
	const errors = validateExplorable(spec);
	assert.ok(errors.length > 0, "Expected validation errors");
	if (message) assert.match(errors.join("; "), message);
}

for (const template of templates) {
	test(`${template}: valid demo and self-contained escaped HTML`, () => {
		const spec = demo(template);
		assert.deepEqual(validateExplorable(spec), []);
		spec.title = `A < B & "C" 'D'`;
		const html = renderExplorableHtml(spec);
		assert.match(html, /<!doctype html>/i);
		assert.match(html, /<canvas/);
		assert.ok(html.includes("A &lt; B &amp; &quot;C&quot; &#39;D&#39;"));
		assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|https?:\/\//);
	});
}

test("rejects garbage without throwing", () => {
	for (const value of [null, undefined, 4, "x", [], {}, { params: null }, { sliders: [null] },
		new Proxy({}, { get() { throw new Error("bad getter"); } })]) {
		assert.doesNotThrow(() => invalid(value));
	}
});

test("validates every top-level field and unknown template", () => {
	for (const key of ["id", "title", "topic", "style", "template", "prompts", "sliders", "params"]) {
		const spec: Record<string, unknown> = { ...demo(), [key]: undefined };
		invalid(spec);
	}
	invalid({ ...demo(), template: "unknown" }, /template/);
	invalid({ ...demo(), prompts: [1] }, /prompts/);
	invalid({ ...demo(), conceptId: 5 }, /conceptId/);
});

test("validates slider bounds, finite values, labels, and unique safe names", () => {
	for (const patch of [
		{ min: 3, max: 3 }, { min: 4, max: 3 }, { value: 99 }, { value: -99 }, { step: 0 }, { step: -1 },
		{ value: Infinity }, { min: NaN }, { max: "4" }, { label: 3 }, { name: "a.b" }, { name: "x" },
		{ name: "y" }, { name: "t" }, { name: "Math" }, { name: "constructor" }, { name: "__proto__" },
		{ name: "arguments" }, { name: "eval" }, { name: "return" }, { name: "await" },
	]) {
		const spec = demo();
		Object.assign(spec.sliders[0], patch);
		invalid(spec, /slider/);
	}
	const spec = demo(); spec.sliders[1].name = spec.sliders[0].name;
	invalid(spec, /unique/);
});

test("strict tokenizer rejects code injection and undeclared identifiers", () => {
	const attacks = [
		"constructor.constructor('x')()", "window.x", "Math.constructor", "x.constructor", "Math.sin.call(x)",
		"fetch('x')", "a; b", "`x`", "x[0]", "() => x", "this.x", "globalThis", "Math.__proto__", "Math.random()",
		"x = 1", "x += 1", "x++", "--x", "x & 1", "x | 1", "!x", "~x", "new Date()", "({})", "'x'",
		"undeclared*x", "Math.sin['call'](x)", "Math.sin.constructor(x)", "x/*hi*/+1", "x//hi", "y+x", "t+x",
		"", "x +", "Math.sin(x); globalThis.x=1",
	];
	for (const expression of attacks) {
		const spec = demo(); spec.params.fn = expression;
		invalid(spec, /params.fn/);
		assert.throws(() => renderExplorableHtml(spec), /Invalid explorable/);
	}
	for (const key of ["fx", "fy"]) {
		const spec = demo("vector-field"); spec.params[key] = "window.x";
		invalid(spec, new RegExp("params." + key));
	}
	const spec = demo(); spec.params.compare = "fetch('x')"; invalid(spec, /compare/);
});

test("allows numeric notation, Math members, comparisons, ternaries, and caret powers", () => {
	for (const expression of ["x^2", "a*Math.sin(b*x)", "Math . cos (x) + Math.PI", "1e-3*x + .2 + 1.",
		"x <= 0 ? -x : x", "x!==0 ? Math.log2(Math.abs(x)) : 0", "Math.max(x, a) % 2", "x**2"]) {
		const spec = demo(); spec.params.fn = expression;
		assert.deepEqual(validateExplorable(spec), [], expression);
	}
});

test("checks required params and all optional parameter types", () => {
	for (const template of templates.filter(t => t !== "linear-transform")) {
		invalid({ ...demo(template), params: {} });
	}
	for (const domain of [[0, 0], [1, 0], [1], [1, Infinity], ["0", 1], null]) {
		const spec = demo(); spec.params.domain = domain; invalid(spec, /domain/);
	}
	const spec = demo(); spec.params.range = [2, 1]; invalid(spec, /range/);
	const matrix = demo("linear-transform");
	matrix.sliders.pop(); invalid(matrix, /Required sliders/);
	for (const patch of [{ showEigen: "yes" }, { showDeterminant: 2 }, { vectors: [[1]] }]) {
		invalid({ ...demo("linear-transform"), params: patch });
	}
	const fourier = demo("fourier-epicycles"); fourier.params = { shape: "custom", points: [[0, 0], [1, 1]] };
	invalid(fourier, /points/);
	fourier.params.points = [[0, 0], [1, 1], [-1, 1]]; assert.deepEqual(validateExplorable(fourier), []);
	for (const template of ["fourier-epicycles", "probability-sim", "exponential-growth", "linear-transform"] as const) {
		invalid({ ...demo(template), sliders: [] }, /Required sliders/);
	}
});

test("all styles render and script serialization escapes HTML delimiters and Unicode separators", () => {
	const spec = demo();
	spec.title = "<script>alert(1)</script>";
	spec.prompts = ["</script><script>alert(2)</script>", "<!-- injected -->\u2028\u2029"];
	spec.sliders[0].label = "<img src=x onerror=alert(3)>";
	for (const style of ["3b1b", "kurzgesagt", "plain"] as const) {
		spec.style = style;
		const html = renderExplorableHtml(spec);
		assert.ok(!html.includes(spec.title)); assert.ok(!html.includes(spec.prompts[0]));
		assert.ok(!html.includes(spec.sliders[0].label));
		assert.match(html, /\\u003c/); assert.match(html, /\\u2028/); assert.match(html, /\\u2029/);
		assert.equal((html.match(/<\/script>/g) || []).length, 2);
		assert.deepEqual(JSON.parse(html.match(/type="application\/json">([\s\S]*?)<\/script>/)![1]), spec);
	}
});

// Run the actual emitted script with a minimal DOM/canvas, rather than testing a duplicate renderer.
function browser(spec: ExplorableSpec, search = "") {
	const events = new Map<string, () => void>();
	const elements: ElementStub[] = [];
	class ElementStub {
		textContent = "";
		value = "";
		id = "";
		width = 0;
		height = 0;
		children: ElementStub[] = [];
		listeners = new Map<string, () => void>();
		append(...children: ElementStub[]) { this.children.push(...children); }
		addEventListener(name: string, fn: () => void) { this.listeners.set(name, fn); }
		getBoundingClientRect() { return { width: 800, height: 600, left: 0 }; }
		getContext() { return context; }
	}
	const coordinates: number[] = [];
	const context = new Proxy({}, { get(_target, key) {
		if (["lineTo", "moveTo", "arc", "fillRect"].includes(String(key))) {
			return (...args: number[]) => { coordinates.push(...args); };
		}
		return () => {};
	}, set() { return true; } });
	const canvas = new ElementStub();
	const nodes = new Map(["spec", "sliders", "status", "controls"].map(id => [id, new ElementStub()]));
	nodes.get("spec")!.textContent = JSON.stringify(spec);
	let frame: (time: number) => void = () => {};
	const html = renderExplorableHtml(spec);
	const source = html.match(/<script>\n([\s\S]*?)<\/script>/)![1];
	runInNewContext(source, {
		document: {
			querySelector: () => canvas,
			getElementById: (id: string) => nodes.get(id),
			createElement: () => { const el = new ElementStub(); elements.push(el); return el; },
		},
		URLSearchParams,
		window: { location: { search }, devicePixelRatio: 2, addEventListener: (name: string, fn: () => void) => events.set(name, fn) },
		requestAnimationFrame: (fn: (time: number) => void) => { frame = fn; },
	}, { timeout: 3000 });
	return { nodes, canvas, elements, coordinates, events, tick: (time: number) => frame(time) };
}

for (const template of templates) {
	test(`${template}: browser script draws, resizes, and reacts to sliders without runtime errors`, () => {
		const app = browser(demo(template));
		assert.equal(app.canvas.width, 1600); assert.equal(app.canvas.height, 1200);
		assert.ok(app.coordinates.length > 0); assert.ok(app.coordinates.every(Number.isFinite));
		app.events.get("resize")!();
		for (const el of app.elements.filter(el => el.listeners.has("input"))) el.listeners.get("input")!();
		app.tick(100); app.tick(150); app.tick(200);
		assert.ok(app.nodes.get("status")!.textContent.length > 0);
	});
}

test("probability controls run, pause, reset and recompute after a slider change", () => {
	const app = browser(demo("probability-sim"));
	const buttons = app.nodes.get("controls")!.children;
	buttons.find(b => b.textContent === "Start")!.listeners.get("click")!();
	app.tick(100); app.tick(150); app.tick(200);
	assert.match(app.nodes.get("status")!.textContent, /Running · [1-9]\d* trials/);
	buttons.find(b => b.textContent === "Pause")!.listeners.get("click")!(); app.tick(250);
	assert.match(app.nodes.get("status")!.textContent, /Paused/);
	buttons.find(b => b.textContent === "Reset")!.listeners.get("click")!();
	assert.match(app.nodes.get("status")!.textContent, /0 trials/);
});

test("all experiment, shape and growth variants execute", () => {
	for (const [template, key, variants] of [
		["probability-sim", "experiment", ["coin", "dice", "galton"]],
		["fourier-epicycles", "shape", ["square", "sawtooth", "heart", "custom"]],
		["exponential-growth", "mode", ["compound", "doubling", "logistic"]],
	] as const) for (const variant of variants) {
		const spec = demo(template); spec.params[key] = variant;
		if (variant === "custom") spec.params.points = [[0, 0], [1, 0], [0, 1]];
		const app = browser(spec); app.tick(100); app.tick(150);
		assert.ok(app.coordinates.every(Number.isFinite));
	}
});

test("non-finite or throwing function evaluations are skipped", () => {
	for (const expression of ["1/0", "Math.sqrt(-1)", "Math.sin()", "x(1)"]) {
		const spec = demo(); spec.params.fn = expression;
		const app = browser(spec); assert.ok(app.coordinates.every(Number.isFinite));
	}
});

test("sparse and malformed coordinate arrays are rejected", () => {
	const spec = demo(); spec.params.domain = Array(2); invalid(spec, /domain/);
	invalid({ ...demo(), prompts: Array(1) }, /prompts/);
	const custom = demo("fourier-epicycles"); custom.params = { shape: "custom", points: Array(3) };
	invalid(custom, /points/);
});

test("hover reports both curves and caret expressions execute with exponent semantics", () => {
	const spec = demo(); spec.params.fn = "x^2";
	const app = browser(spec);
	Reflect.apply(app.canvas.listeners.get("pointermove")!, null, [{ clientX: 412 }]);
	assert.match(app.nodes.get("status")!.textContent, /x = 0\nf\(x\) = 0\ncompare = 0/);
	app.canvas.listeners.get("pointerleave")!();
	assert.match(app.nodes.get("status")!.textContent, /Move over/);
});

test("real, repeated and complex matrix eigenvalues execute", () => {
	for (const matrix of [[1, 0, 0, 2], [1, 0, 0, 1], [1, 1, 0, 1], [0, -1, 1, 0]]) {
		const spec = demo("linear-transform");
		spec.sliders.forEach((slider, i) => { slider.value = matrix[i]; });
		const app = browser(spec);
		assert.match(app.nodes.get("status")!.textContent, /det\(A\)/);
		assert.match(app.nodes.get("status")!.textContent, /eigenvalue|eigenvector/);
		assert.ok(app.coordinates.every(Number.isFinite));
	}
});


test("query presets synchronize slider values, outputs and evaluated function", () => {
	const app = browser(demo(), "?a=2&b=3");
	const inputs = app.elements.filter(el => el.listeners.has("input"));
	assert.deepEqual(inputs.map(el => el.value), ["2", "3"]);
	const labels = app.nodes.get("sliders")!.children.filter(el => el.children.length);
	assert.deepEqual(labels.map(el => el.children[1].textContent), ["2", "3"]);
	Reflect.apply(app.canvas.listeners.get("pointermove")!, null, [{ clientX: 412 }]);
	assert.match(app.nodes.get("status")!.textContent, /f\(x\) = 0/);
});

test("query presets ignore invalid values and clamp and snap to slider steps", () => {
	const spec = demo();
	for (const [query, expected] of [
		["?a=NaN&b=Infinity", spec.sliders.map(s => String(s.value))],
		["?a=&b=hello", spec.sliders.map(s => String(s.value))],
		["?a=-999&b=999", spec.sliders.map((s, i) => String(i ? s.max : s.min))],
		["?a=1.234&b=2.345", ["1.2", "2.3"]],
	] as const) {
		const app = browser(spec, query);
		assert.deepEqual(app.elements.filter(el => el.listeners.has("input")).map(el => el.value), expected);
		assert.ok(app.coordinates.every(Number.isFinite));
	}
});
