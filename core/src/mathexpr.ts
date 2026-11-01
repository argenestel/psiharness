/**
 * Safe math-expression parsing (LaTeX or ASCII) and randomized numeric equivalence for "math" challenges.
 * Hand-written tokenizer + recursive-descent parser; nothing is ever passed to eval/Function.
 */

/** Parsed expression tree. `add`/`mul` are n-ary so long polynomials stay shallow. */
export type MathNode =
	| { k: "num"; v: number }
	| { k: "var"; n: string }
	| { k: "neg"; a: MathNode }
	| { k: "add"; items: { neg: boolean; a: MathNode }[] }
	| { k: "mul"; items: { div: boolean; a: MathNode }[] }
	| { k: "pow"; a: MathNode; b: MathNode }
	| { k: "fn"; f: string; a: MathNode; b?: MathNode };

type Tok =
	| { t: "num"; v: number }
	| { t: "const"; v: number }
	| { t: "var"; n: string }
	| { t: "fn"; n: string; latex: boolean; sub?: string }
	| { t: "op"; v: string }
	| { t: "open"; v: string }
	| { t: "close"; v: string }
	| { t: "bar" }
	| { t: "frac" };

const MAX_LENGTH = 300;
const MAX_DEPTH = 50;
// Longest names first so "sinh" wins over "sin" and "arcsin" over "sin".
const FUNCTIONS = ["arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "sqrt", "sin", "cos", "tan", "sec", "csc",
	"cot", "exp", "abs", "log", "ln"];
const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
	"iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
	"Gamma", "Delta", "Theta", "Lambda", "Sigma", "Phi", "Psi", "Omega"]);
// Bare-word greek names recognized in ASCII input; short ambiguous ones (eta, nu, xi, chi, psi) stay letter products.
const ASCII_GREEK = ["epsilon", "lambda", "alpha", "gamma", "delta", "theta", "sigma", "omega", "beta", "phi", "rho",
	"tau", "mu"];
const UNICODE: Record<string, string> = {
	"π": "\\pi ", "α": "\\alpha ", "β": "\\beta ", "γ": "\\gamma ", "δ": "\\delta ", "Δ": "\\Delta ", "ε": "\\epsilon ",
	"θ": "\\theta ", "λ": "\\lambda ", "μ": "\\mu ", "ρ": "\\rho ", "σ": "\\sigma ", "τ": "\\tau ", "φ": "\\phi ",
	"ω": "\\omega ", "Ω": "\\Omega ", "²": "^2", "³": "^3", "√": "\\sqrt ", "·": "*", "×": "*", "÷": "/", "⋅": "*",
};
const RANGES: [number, number][] = [[-3, 3], [0.1, 2], [-10, -0.5], [0.5, 10], [-1, 1], [1, 5]];
const SEED = 0x5eed1234;

function fail(message: string): never {
	throw new Error(message);
}

/** Strip TeX delimiters, sizing/spacing commands and unicode variants down to plain parseable text. */
function prep(text: string): string {
	return text.trim().replace(/^\$\$([\s\S]*)\$\$$|^\$([\s\S]*)\$$|^\\\(([\s\S]*)\\\)$/, (_, a, b, c) => a ?? b ?? c)
		.replace(/[−‐‑‒–—﹣－]/gu, "-")
		.replace(/[παβγδΔεθλμρστφωΩ²³√·×÷⋅]/gu, (ch) => UNICODE[ch] ?? ch)
		.replace(/\\(?:mathrm|operatorname|mathit|text)\{\s*([A-Za-z]+)\s*\}/g, "$1")
		.replace(/\\(?:left|right)(?:\.|(?![A-Za-z]))/g, "").replace(/\\(?:displaystyle|textstyle)(?![A-Za-z])/g, "")
		.replace(/\\[,;:! ]/g, " ").trim();
}

function tokenize(s: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	const subscript = (): string | undefined => {
		if (s[i] !== "_") return undefined;
		i++;
		if (s[i] === "{") {
			const end = s.indexOf("}", i);
			const body = end < 0 ? "" : s.slice(i + 1, end).trim();
			if (!/^[A-Za-z0-9]+$/.test(body)) fail("Bad subscript");
			i = end + 1;
			return body;
		}
		if (!/[A-Za-z0-9]/.test(s[i] ?? "")) fail("Bad subscript");
		return s[i++];
	};
	const name = (base: string): Tok => {
		const sub = subscript();
		return { t: "var", n: sub === undefined ? base : `${base}_${sub}` };
	};
	const fn = (n: string, latex: boolean): Tok => {
		const sub = subscript();
		if (sub !== undefined && n !== "log") fail("Subscript on function");
		return { t: "fn", n, latex, sub };
	};
	while (i < s.length) {
		const ch = s[i];
		if (/\s/.test(ch)) { i++; continue; }
		const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 40));
		if (number) {
			if (out.at(-1)?.t === "num") fail("Adjacent numbers");
			out.push({ t: "num", v: Number(number[0]) });
			i += number[0].length;
			continue;
		}
		if (ch === "*" && s[i + 1] === "*") { out.push({ t: "op", v: "^" }); i += 2; continue; }
		if ("+-*/^".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
		if ("([{".includes(ch)) { out.push({ t: "open", v: ch }); i++; continue; }
		if (")]}".includes(ch)) { out.push({ t: "close", v: ch === ")" ? "(" : ch === "]" ? "[" : "{" }); i++; continue; }
		if (ch === "|") { out.push({ t: "bar" }); i++; continue; }
		if (ch === "\\") {
			const command = /^\\([A-Za-z]+|.)/.exec(s.slice(i))?.[1] ?? fail("Dangling backslash");
			i += command.length + 1;
			if (command === "{") out.push({ t: "open", v: "{" });
			else if (command === "}") out.push({ t: "close", v: "{" });
			else if (command === "|") out.push({ t: "bar" });
			else if (command === "cdot" || command === "times") out.push({ t: "op", v: "*" });
			else if (command === "div") out.push({ t: "op", v: "/" });
			else if (command === "frac" || command === "dfrac" || command === "tfrac") {
				out.push({ t: "frac" });
				// TeX shorthand \frac12 takes one digit per argument.
				for (let n = 0; n < 2; n++) {
					while (s[i] === " ") i++;
					if (!/\d/.test(s[i] ?? "")) break;
					out.push({ t: "num", v: Number(s[i++]) });
				}
			}
			else if (command === "pi") out.push({ t: "const", v: Math.PI });
			else if (FUNCTIONS.includes(command)) out.push(fn(command, true));
			else if (GREEK.has(command)) out.push(name(command));
			else fail(`Unsupported command \\${command}`);
			continue;
		}
		if (/[A-Za-z]/.test(ch)) {
			const word = FUNCTIONS.find((f) => s.startsWith(f, i));
			if (word) { i += word.length; out.push(fn(word, false)); continue; }
			if (s.startsWith("pi", i)) { i += 2; out.push({ t: "const", v: Math.PI }); continue; }
			const greek = ASCII_GREEK.find((g) => s.startsWith(g, i));
			if (greek) { i += greek.length; out.push(name(greek)); continue; }
			i++;
			if (ch === "e" && s[i] !== "_") out.push({ t: "const", v: Math.E });
			else out.push(name(ch));
			continue;
		}
		fail(`Unexpected character ${ch}`);
	}
	return out;
}

function parseTokens(toks: Tok[]): MathNode {
	let p = 0, bars = 0, nesting = 0;
	const peek = (): Tok | undefined => toks[p];
	const isOp = (tok: Tok | undefined, v: string): boolean => tok?.t === "op" && tok.v === v;
	const startsFactor = (tok: Tok | undefined): boolean => tok !== undefined && (tok.t === "num" || tok.t === "const"
		|| tok.t === "var" || tok.t === "fn" || tok.t === "open" || tok.t === "frac" || (tok.t === "bar" && bars === 0));

	// Bracket nesting is bounded too, since groups add no AST node of their own.
	function sum(): MathNode {
		if (++nesting > MAX_DEPTH) fail("Too deeply nested");
		const items = [{ neg: false, a: product() }];
		while (isOp(peek(), "+") || isOp(peek(), "-")) {
			const neg = isOp(toks[p++], "-");
			items.push({ neg, a: product() });
		}
		nesting--;
		return items.length === 1 ? items[0].a : { k: "add", items };
	}
	// Explicit and implicit multiplication share precedence, left to right (1/2x = x/2, like sympy's parser).
	function product(): MathNode {
		const items = [{ div: false, a: unary() }];
		for (;;) {
			const tok = peek();
			if (isOp(tok, "*") || isOp(tok, "/")) {
				p++;
				items.push({ div: isOp(tok, "/"), a: unary() });
			} else if (startsFactor(tok)) {
				items.push({ div: false, a: power() });
			} else break;
		}
		return items.length === 1 ? items[0].a : { k: "mul", items };
	}
	function unary(): MathNode {
		while (isOp(peek(), "+")) p++;
		if (isOp(peek(), "-")) { p++; return { k: "neg", a: unary() }; }
		return power();
	}
	// Exponents associate right and may carry a sign: 2^3^2 = 512, 2^-2 = 1/4.
	function power(): MathNode {
		const base = primary();
		if (!isOp(peek(), "^")) return base;
		p++;
		return { k: "pow", a: base, b: unary() };
	}
	function group(): MathNode {
		const open = toks[p++];
		if (open?.t === "bar") {
			bars++;
			const inner = sum();
			if (toks[p++]?.t !== "bar") fail("Missing |");
			bars--;
			return { k: "fn", f: "abs", a: inner };
		}
		if (open?.t !== "open") fail("Expected group");
		const saved = bars;
		bars = 0;
		const inner = sum();
		bars = saved;
		const close = toks[p++];
		if (close?.t !== "close" || close.v !== open.v) fail("Unbalanced brackets");
		return inner;
	}
	// A \frac or \sqrt argument: a bracketed group or a single atom (\frac{1}{x}, \frac 1 x, \sqrt x).
	function atom(): MathNode {
		const tok = peek();
		if (tok?.t === "open" || tok?.t === "bar") return group();
		if (tok?.t === "num" || tok?.t === "const" || tok?.t === "var") return primary();
		return fail("Expected argument");
	}
	// Function argument: a group, or an unbracketed run of factors (\sin 2x, \ln x^2) stopping at the next function.
	function argument(): MathNode {
		const tok = peek();
		if (isOp(tok, "-")) { p++; return { k: "neg", a: argument() }; }
		if (tok?.t === "open" || tok?.t === "bar") return group();
		const items = [{ div: false, a: power() }];
		while (startsFactor(peek()) && peek()?.t !== "fn") items.push({ div: false, a: power() });
		return items.length === 1 ? items[0].a : { k: "mul", items };
	}
	function primary(): MathNode {
		const tok = peek();
		if (!tok) return fail("Unexpected end");
		if (tok.t === "num" || tok.t === "const") { p++; return { k: "num", v: tok.v }; }
		if (tok.t === "var") { p++; return { k: "var", n: tok.n }; }
		if (tok.t === "open" || tok.t === "bar") return group();
		if (tok.t === "frac") {
			p++;
			const a = atom(), b = atom();
			return { k: "mul", items: [{ div: false, a }, { div: true, a: b }] };
		}
		if (tok.t === "fn") {
			p++;
			if (tok.n === "sqrt" && tok.latex && peek()?.t === "open" && (peek() as { v: string }).v === "[") {
				const index = group();
				return { k: "fn", f: "root", a: atom(), b: index };
			}
			let exponent: MathNode | undefined;
			if (isOp(peek(), "^")) {
				// \sin^2 x means (\sin x)^2; \sin^{-1} (arcsin) is ambiguous, so negative powers are refused.
				p++;
				if (isOp(peek(), "-")) fail("Inverse function notation");
				exponent = atom();
				if (exponent.k === "neg") fail("Inverse function notation");
			}
			const base = tok.sub === undefined ? undefined
				: /^\d+$/.test(tok.sub) ? { k: "num", v: Number(tok.sub) } as MathNode : { k: "var", n: tok.sub } as MathNode;
			const call: MathNode = { k: "fn", f: tok.n, a: tok.n === "sqrt" ? atom() : argument(), b: base };
			return exponent ? { k: "pow", a: call, b: exponent } : call;
		}
		return fail("Unexpected token");
	}

	const tree = sum();
	if (p !== toks.length) fail("Trailing input");
	return tree;
}

function depth(node: MathNode, limit: number): number {
	if (limit < 0) return Infinity;
	switch (node.k) {
		case "num": case "var": return 1;
		case "neg": return 1 + depth(node.a, limit - 1);
		case "pow": return 1 + Math.max(depth(node.a, limit - 1), depth(node.b, limit - 1));
		case "fn": return 1 + Math.max(depth(node.a, limit - 1), node.b ? depth(node.b, limit - 1) : 0);
		case "add": case "mul": return 1 + Math.max(...node.items.map((item) => depth(item.a, limit - 1)));
	}
}

/** Parse LaTeX/ASCII math into an AST; undefined when unsupported, too long (> 300 chars) or too deep (> 50). */
export function parseMath(text: string): MathNode | undefined {
	if (typeof text !== "string" || text.length > MAX_LENGTH) return undefined;
	try {
		const source = prep(text);
		if (!source) return undefined;
		const tree = parseTokens(tokenize(source));
		return depth(tree, MAX_DEPTH) <= MAX_DEPTH ? tree : undefined;
	} catch {
		return undefined;
	}
}

/** Variable names used by an expression (subscripted names like `v_0` are distinct variables). */
export function mathVariables(node: MathNode, into = new Set<string>()): Set<string> {
	if (node.k === "var") into.add(node.n);
	else if (node.k === "neg") mathVariables(node.a, into);
	else if (node.k === "pow") { mathVariables(node.a, into); mathVariables(node.b, into); }
	else if (node.k === "fn") { mathVariables(node.a, into); if (node.b) mathVariables(node.b, into); }
	else if (node.k === "add" || node.k === "mul") for (const item of node.items) mathVariables(item.a, into);
	return into;
}

function apply(f: string, x: number, b: number | undefined): number {
	switch (f) {
		case "sin": return Math.sin(x);
		case "cos": return Math.cos(x);
		case "tan": return Math.tan(x);
		case "sec": return 1 / Math.cos(x);
		case "csc": return 1 / Math.sin(x);
		case "cot": return 1 / Math.tan(x);
		case "arcsin": return Math.asin(x);
		case "arccos": return Math.acos(x);
		case "arctan": return Math.atan(x);
		case "sinh": return Math.sinh(x);
		case "cosh": return Math.cosh(x);
		case "tanh": return Math.tanh(x);
		case "exp": return Math.exp(x);
		case "abs": return Math.abs(x);
		case "sqrt": return Math.sqrt(x);
		case "ln": return Math.log(x);
		// Unsubscripted log is the natural log (sympy/Python convention); log_b x uses base b.
		case "log": return b === undefined ? Math.log(x) : b === 10 ? Math.log10(x) : b === 2 ? Math.log2(x)
			: Math.log(x) / Math.log(b);
		case "root": {
			if (b === undefined || !Number.isInteger(b) || b < 1) return NaN;
			return x < 0 && b % 2 === 1 ? -((-x) ** (1 / b)) : x ** (1 / b);
		}
		default: return NaN;
	}
}

/** Evaluate an AST with the given variable values (pi/e are constants); NaN for unknown variables or bad domains. */
export function evaluateMath(node: MathNode, vars: ReadonlyMap<string, number> = new Map()): number {
	switch (node.k) {
		case "num": return node.v;
		case "var": return vars.get(node.n) ?? NaN;
		case "neg": return -evaluateMath(node.a, vars);
		case "pow": return evaluateMath(node.a, vars) ** evaluateMath(node.b, vars);
		case "fn": return apply(node.f, evaluateMath(node.a, vars), node.b ? evaluateMath(node.b, vars) : undefined);
		case "add": return node.items.reduce((total, item) =>
			total + (item.neg ? -1 : 1) * evaluateMath(item.a, vars), 0);
		case "mul": return node.items.reduce((total, item) => {
			const value = evaluateMath(item.a, vars);
			return item.div ? total / value : total * value;
		}, 1);
	}
}

// A single identifier on the left labels an answer (y, f'(x), dy/dx, ...), rather than contributing a
// variable to the equation.  General left-hand sides are retained so equations can be compared by their residuals.
const IDENTIFIER_LHS = /^\s*(?:\\?[A-Za-z]{1,8}(?:_\{?[A-Za-z0-9]+\}?)?'*(?:\([^()=]*\))?|d[A-Za-z]*\/d[A-Za-z]+|\\frac\{d[A-Za-z]*\}\{d[A-Za-z]+\})\s*$/;

type MathAnswer =
	| { kind: "expression"; text: string }
	| { kind: "equation"; left: string; right: string };

function splitAnswer(text: string): MathAnswer | undefined {
	const parts = prep(text).split("=");
	if (parts.length > 2) return undefined;
	return parts.length === 1
		? { kind: "expression", text: parts[0] }
		: { kind: "equation", left: parts[0], right: parts[1] };
}

function identifierLhs(text: string): string | undefined {
	return IDENTIFIER_LHS.test(text) ? text.replace(/\s+/g, "") : undefined;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function agree(x: number, y: number, tolerance?: number): boolean {
	const diff = Math.abs(x - y);
	return diff <= Math.max(1e-9, 1e-6 * Math.max(Math.abs(x), Math.abs(y))) || (tolerance !== undefined && diff <= tolerance);
}

function compareExpressions(a: MathNode, b: MathNode, tolerance?: number): boolean {
	const names = [...mathVariables(b, mathVariables(a))].sort();
	if (names.length === 0) {
		const x = evaluateMath(a), y = evaluateMath(b);
		return Number.isFinite(x) && Number.isFinite(y)
			&& Math.abs(x - y) <= (tolerance ?? 1e-9 * Math.max(1, Math.abs(y)));
	}
	const random = mulberry32(SEED);
	let valid = 0;
	for (let attempt = 0; attempt < 72 && valid < 12; attempt++) {
		const [low, high] = RANGES[attempt % RANGES.length];
		const vars = new Map(names.map((name) => [name, low + random() * (high - low)]));
		const x = evaluateMath(a, vars), y = evaluateMath(b, vars);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		if (!agree(x, y, tolerance)) return false;
		valid++;
	}
	return valid >= 6;
}

function parseEquationSide(text: string): MathNode | undefined {
	return parseMath(text);
}

function equationTruth(left: MathNode, right: MathNode, tolerance?: number): boolean | undefined {
	const x = evaluateMath(left), y = evaluateMath(right);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	return Math.abs(x - y) <= (tolerance ?? 1e-9 * Math.max(1, Math.abs(y)));
}

function compareResiduals(
	leftA: MathNode,
	rightA: MathNode,
	leftB: MathNode,
	rightB: MathNode,
	tolerance?: number,
): boolean {
	const variablesA = mathVariables(rightA, mathVariables(leftA));
	const variablesB = mathVariables(rightB, mathVariables(leftB));
	if ((variablesA.size === 0) !== (variablesB.size === 0)) return false;
	const namesSet = new Set(variablesA);
	mathVariables(leftB, namesSet);
	mathVariables(rightB, namesSet);
	const names = [...namesSet];
	// A constant equation has a truth value, not a residual that can be compared to a variable equation.
	if (names.length === 0) {
		const truthA = equationTruth(leftA, rightA, tolerance);
		const truthB = equationTruth(leftB, rightB, tolerance);
		return truthA !== undefined && truthB !== undefined && truthA === truthB;
	}

	const variables = names.sort();
	const random = mulberry32(SEED);
	let factor: number | undefined;
	let valid = 0;
	for (let attempt = 0; attempt < 72 && valid < 12; attempt++) {
		const [low, high] = RANGES[attempt % RANGES.length];
		const vars = new Map(variables.map((name) => [name, low + random() * (high - low)]));
		const residualA = evaluateMath(leftA, vars) - evaluateMath(rightA, vars);
		const residualB = evaluateMath(leftB, vars) - evaluateMath(rightB, vars);
		if (!Number.isFinite(residualA) || !Number.isFinite(residualB)) continue;
		const zeroA = Math.abs(residualA) <= 1e-9;
		const zeroB = Math.abs(residualB) <= 1e-9;
		if (zeroA || zeroB) {
			if (zeroA !== zeroB) return false;
			continue;
		}
		const candidate = residualA / residualB;
		if (!Number.isFinite(candidate) || candidate === 0) continue;
		if (factor === undefined) factor = candidate;
		else if (!agree(candidate, factor, tolerance)) return false;
		valid++;
	}
	return valid >= 6;
}

function compareEquations(
	a: Extract<MathAnswer, { kind: "equation" }>,
	b: Extract<MathAnswer, { kind: "equation" }>,
	tolerance?: number,
): boolean | undefined {
	const labeledA = identifierLhs(a.left);
	const labeledB = identifierLhs(b.left);
	if (labeledA !== undefined && labeledA === labeledB) {
		// y=..., f'(x)=..., and dy/dx=... compare their values when the label is identical.
		const rightA = parseEquationSide(a.right), rightB = parseEquationSide(b.right);
		return rightA && rightB ? compareExpressions(rightA, rightB, tolerance) : undefined;
	}
	const leftA = parseEquationSide(a.left), rightA = parseEquationSide(a.right);
	const leftB = parseEquationSide(b.left), rightB = parseEquationSide(b.right);
	if (!leftA || !rightA || !leftB || !rightB) return undefined;
	return compareResiduals(leftA, rightA, leftB, rightB, tolerance);
}

/**
 * Decide whether two math answers are equivalent. Constant expressions compare numerically (`tolerance`, default
 * relative 1e-9); expressions with variables are evaluated at seeded random points. Equations with general
 * left-hand sides compare proportional nonzero residuals, while constant equations compare truth values.
 * Returns undefined when either side cannot be parsed. Never throws.
 */
export function mathEquivalent(answer: string, expected: string, tolerance?: number): boolean | undefined {
	try {
		const a = splitAnswer(answer), b = splitAnswer(expected);
		if (!a || !b) return undefined;
		if (a.kind === "equation" && b.kind === "equation") return compareEquations(a, b, tolerance);
		if (a.kind === "equation") {
			if (b.kind !== "expression" || identifierLhs(a.left) === undefined) return undefined;
			// Only labeled equations may be compared with a bare expression. A general equation must retain both sides.
			const equationRhs = parseEquationSide(a.right);
			const expression = parseMath(b.text);
			return equationRhs && expression ? compareExpressions(equationRhs, expression, tolerance) : undefined;
		}
		if (b.kind === "equation") {
			if (identifierLhs(b.left) === undefined) return undefined;
			const equationRhs = parseEquationSide(b.right);
			const expression = parseMath(a.text);
			return equationRhs && expression ? compareExpressions(equationRhs, expression, tolerance) : undefined;
		}
		const expressionA = parseMath(a.text), expressionB = parseMath(b.text);
		return expressionA && expressionB ? compareExpressions(expressionA, expressionB, tolerance) : undefined;
	} catch {
		return undefined;
	}
}
