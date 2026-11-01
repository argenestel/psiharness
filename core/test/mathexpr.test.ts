import { test } from "node:test";
import * as assert from "node:assert/strict";
import { evaluateMath, mathEquivalent, mathVariables, parseMath } from "../src/mathexpr.ts";

test("parseMath handles LaTeX and ASCII syntax", () => {
	const at = (text: string, vars: Record<string, number> = {}) => {
		const tree = parseMath(text);
		assert.ok(tree, text);
		return evaluateMath(tree, new Map(Object.entries(vars)));
	};
	assert.equal(at("2x", { x: 3 }), 6);
	assert.equal(at("x(x+1)", { x: 3 }), 12);
	assert.equal(at("(a+b)(a-b)", { a: 3, b: 1 }), 8);
	assert.equal(at("[x]+\\{y\\}", { x: 1, y: 2 }), 3);
	assert.equal(at("\\frac{1}{2}x^{2}", { x: 4 }), 8);
	assert.equal(at("\\frac12", {}), 0.5);
	assert.equal(at("\\sqrt[3]{-8}"), -2);
	assert.equal(at("\\sqrt{16}+sqrt(9)+\\sqrt4"), 9);
	assert.equal(at("|x-5|", { x: 2 }), 3);
	assert.equal(at("|x||y|", { x: -2, y: -3 }), 6);
	assert.equal(at("2^3^2"), 512);
	assert.equal(at("-2^2"), -4);
	assert.equal(at("2^-2"), 0.25);
	assert.equal(at("x**2", { x: 5 }), 25);
	assert.equal(at("3 \\cdot 4 \\times 2 \\div 8"), 3);
	assert.equal(at("\\log_2 8"), 3);
	assert.equal(at("\\log_{10}{1000}"), 3);
	assert.equal(at("ln(e)"), 1);
	assert.equal(at("1/2x", { x: 4 }), 2);
	assert.equal(at("\\left( x + 1 \\right)", { x: 1 }), 2);
	assert.equal(at("$x$", { x: 7 }), 7);
	assert.ok(Math.abs(at("2\\pi r", { r: 1 }) - 2 * Math.PI) < 1e-12);
	assert.ok(Math.abs(at("\\sin^2 x + \\cos^2 x", { x: 0.7 }) - 1) < 1e-12);
	assert.deepEqual([...mathVariables(parseMath("v_0 t + \\frac{1}{2} a_{x} t^2 + \\theta + θ")!)].sort(),
		["a_x", "t", "theta", "v_0"]);
	assert.deepEqual([...mathVariables(parseMath("2\\pi + e + pi")!)], []);
});

test("parseMath rejects unsupported, oversized and too-deep input without throwing", () => {
	for (const text of ["", "1+", "(1", "1)", "process.exit()", "globalThis.x=1", "Math.sqrt(1)", "1;1",
		"\\foo{x}", "x_", "\\sin^{-1} x", "2 3", "{x)", "||", "x'", "a.b", "\\", "x = y = z", "\u0000",
		"1".repeat(301), "(".repeat(60) + "x" + ")".repeat(60), "-".repeat(80) + "x"]) {
		assert.equal(parseMath(text), undefined, text.slice(0, 40));
	}
	assert.equal(parseMath(undefined as unknown as string), undefined);
	assert.ok(parseMath("x^5+x^4+x^3+x^2+x+1+2x+3x+4x+5x+6x+7x+8x+9x+10x+11x+12x+13x+14x+15x+16x+17x+18x"));
});

test("mathEquivalent accepts reordered and rewritten equivalent expressions", () => {
	for (const [a, b] of [
		["3x^2+2x", "2x+3x^2"], ["x(x+1)", "x^2+x"], ["(a+b)^2", "a^2+2ab+b^2"], ["(a+b)(a-b)", "a^2-b^2"],
		["\\frac{1}{2}x^2", "x^2/2"], ["0.5x^2", "x^2/2"], ["\\frac{1}{2}x^2", "0.5x^2"], ["1/x", "x^{-1}"],
		["\\sin^2 x + \\cos^2 x", "1"], ["\\sin^2(x)+\\cos^2(x)", "1"], ["sin(x)^2+cos(x)^2", "1"],
		["ap/(ap+b(1-p))", "\\frac{ap}{ap+b(1-p)}"], ["pa/(pa+b(1-p))", "a*p/(a*p+b*(1-p))"],
		["v^2/r", "\\frac{v^2}{r}"], ["v^2/r", "v*v/r"], ["s/\\sqrt{n}", "s*n^(-1/2)"], ["s/sqrt(n)", "\\frac{s}{\\sqrt{n}}"],
		["\\sqrt[3]{x}", "x^{1/3}"], ["|x|", "\\sqrt{x^2}"], ["e^{2x}", "\\exp(2x)"], ["\\sin 2x", "2 \\sin x \\cos x"],
		["2\\pi r", "2 pi r"], ["\\theta^2", "θ²"], ["v_0 t + \\frac12 a t^2", "v_{0}t+0.5at^2"],
		["y = 2x+1", "1+2x"], ["f'(x) = 6x", "6x"], ["$y = x^2$", "x^2"],
		["\\frac{dy}{dx} = 2x", "2x"], ["x^2-5x+6", "(x-2)(x-3)"], ["x^2-5x+6", "(2-x)(3-x)"],
		["\\ln x^2", "2\\ln|x|"], ["x^2/2 + C", "C + \\frac{x^2}{2}"],
	]) {
		assert.equal(mathEquivalent(a, b), true, `${a} ≡ ${b}`);
		assert.equal(mathEquivalent(b, a), true, `${b} ≡ ${a}`);
	}
});

test("mathEquivalent preserves equation meaning", () => {
	assert.equal(mathEquivalent("1=2", "x=2"), false);
	assert.equal(mathEquivalent("y=2x", "2x=y"), true);
	assert.equal(mathEquivalent("y-2x=0", "y=2x"), true);
	assert.equal(mathEquivalent("y=x+1", "y=1+x"), true);
	assert.equal(mathEquivalent("y=2x", "y=3x"), false);
	assert.equal(mathEquivalent("x=2", "y=2"), false);
	// Differently labeled equations retain both sides; unsupported derivative labels are not stripped.
	assert.equal(mathEquivalent("y=6x", "f'(x)=x*6"), undefined);
	assert.equal(mathEquivalent("1=1", "2=2"), true);
	assert.equal(mathEquivalent("1=2", "2=3"), true);
	assert.equal(mathEquivalent("1=1", "2=3"), false);
	assert.equal(mathEquivalent("1=1", "x=x"), false);
	assert.equal(mathEquivalent("2x", "y=2x"), true);
	assert.equal(mathEquivalent("f'(x)=2x", "f'(x)=x*2"), true);
});

test("mathEquivalent rejects near misses and reports unparseable input as undefined", () => {
	for (const [a, b] of [
		["2x+3x^3", "3x^2+2x"], ["x^2-x", "x^2+x"], ["(a+b)^2", "a^2+b^2"], ["x", "y"], ["v_0", "v_1"],
		["x^2", "x^3"], ["x+1e-3", "x"], ["\\sqrt{x}", "\\sqrt{-x}"], ["0.5", "p"], ["x^2/2", "x^2/2 + C"],
		["\\sin x", "\\cos x"], ["1/2", "2/3"], ["1", "1.000000002"], ["0", "1/0"], ["0", "sqrt(-1)"],
	]) {
		assert.equal(mathEquivalent(a, b), false, `${a} ≢ ${b}`);
	}
	for (const [a, b] of [["process.exit()", "1"], ["x", "1+"], ["x = y = z", "x"], ["a.b=2", "2"],
		["x".repeat(400), "x"]]) {
		assert.equal(mathEquivalent(a, b), undefined, `${a} / ${b}`);
	}
	assert.equal(mathEquivalent("1.05", "1", 0.1), true);
	assert.equal(mathEquivalent("1.0000000005", "1"), true);
});

test("mathEquivalent is deterministic", () => {
	const runs = Array.from({ length: 5 }, () => mathEquivalent("tan(x)", "sin(x)/cos(x)"));
	assert.deepEqual(runs, [true, true, true, true, true]);
});

test("constant equations never match equations containing variables even after cancellation", () => {
	assert.equal(mathEquivalent("1=2", "x-x=1"), false);
});
