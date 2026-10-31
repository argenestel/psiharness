/** Compare SQL rows without coercing values or discarding duplicates. */
export function compareRows(actual, expected, { ordered = false } = {}) {
	if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
	const a = actual.map((row) => JSON.stringify(row));
	const b = expected.map((row) => JSON.stringify(row));
	if (!ordered) { a.sort(); b.sort(); }
	return a.every((row, i) => row === b[i]);
}

/** Race an operation against a deadline, always clearing the timer. */
export function withTimeout(promise, ms, onTimeout) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			try { onTimeout?.(); } catch { /* The deadline must still settle. */ }
			reject(new Error(`Code timed out after ${ms / 1000} seconds.`));
		}, ms);
		Promise.resolve(promise).then(
			(value) => { clearTimeout(timer); resolve(value); },
			(error) => { clearTimeout(timer); reject(error); },
		);
	});
}

/** Bracket depth change for one line, tracking multi-line strings (rough lexer: strings and comments skipped). */
function scanLine(line, language, state) {
	let depth = 0;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (state.quote) {
			if (ch === "\\") { i++; continue; }
			if (line.startsWith(state.quote, i)) { i += state.quote.length - 1; state.quote = ""; }
			continue;
		}
		if ((language === "python" && ch === "#") || (language !== "python" && line.startsWith("//", i))) break;
		const triple = line.slice(i, i + 3);
		if (language === "python" && (triple === '"""' || triple === "'''")) { state.quote = triple; i += 2; continue; }
		if (ch === '"' || ch === "'" || ch === "`") { state.quote = ch; continue; }
		if ("([{".includes(ch)) depth++;
		else if (")]}".includes(ch)) depth--;
	}
	// Plain quotes never span lines (template literals and triple quotes can).
	if (state.quote === '"' || state.quote === "'") state.quote = "";
	return depth;
}

/** Human label for one test statement: its assertion message, or the assertion itself; null for helper steps. */
export function testLabel(source, language = "python") {
	const text = String(source).trim();
	const message = language === "python"
		? text.match(/^assert\b[\s\S]*,\s*f?(["'])((?:\\.|(?!\1).)*)\1\s*$/)
		: text.match(/,\s*(["'`])((?:\\.|(?!\1).)*)\1\s*\)\s*;?\s*$/);
	if (message) return message[2];
	if (language === "python" ? /^assert\b/.test(text) : /^(?:console\.assert|assert|equal|expect)\b/.test(text)) {
		const first = text.split("\n")[0].replace(/^assert\s+/, "");
		return first.length > 72 ? `${first.slice(0, 70)}…` : first;
	}
	return null;
}

/** Split test source into top-level statements so each assertion can report pass/fail on its own. */
export function splitTests(source = "", language = "python") {
	if (!["python", "javascript"].includes(language) || !String(source).trim()) return [];
	const chunks = [], state = { quote: "" };
	let current = null, depth = 0, comments = [];
	for (const line of String(source).replace(/\r\n?/g, "\n").split("\n")) {
		const trimmed = line.trim(), open = depth > 0 || !!state.quote;
		const previous = current?.at(-1)?.trim() ?? "";
		const continues = current && (open || (trimmed && /^\s/.test(line))
			|| /^(?:elif|else|except|finally)\b|^[)\]}]/.test(trimmed)
			|| (language === "python" && (/[\\:]$/.test(previous) || previous.startsWith("@"))));
		depth = Math.max(0, depth + scanLine(line, language, state));
		if (continues) { current.push(line); continue; }
		if (!trimmed) continue;
		if (trimmed.startsWith(language === "python" ? "#" : "//")) { comments.push(line); continue; }
		current = [...comments, line]; comments = []; chunks.push(current);
	}
	return chunks.map((lines) => ({
		source: lines.join("\n").replace(/\s+$/, ""),
		label: testLabel(lines.filter((l) => !/^\s*(?:#|\/\/)/.test(l)).join("\n"), language),
	}));
}

/** Mount an accessible, dependency-free code editor. Ctrl+Enter runs, Ctrl+Shift+Enter submits, Esc leaves. */
export function createCodeEditor(el, { language = "javascript", value = "", onRun, onSubmit, onFocus } = {}) {
	const wrapper = document.createElement("div");
	wrapper.className = "psi-code-editor";
	const gutter = document.createElement("pre");
	gutter.className = "psi-code-gutter";
	gutter.setAttribute("aria-hidden", "true");
	const input = document.createElement("textarea");
	input.className = "psi-code-input";
	input.setAttribute("aria-label", `${language} code editor`);
	input.setAttribute("aria-keyshortcuts", "Control+Enter Control+Shift+Enter Escape");
	input.title = "Tab indents. Ctrl+Enter runs your code. Press Esc, then Tab, to leave the editor.";
	input.spellcheck = false;
	input.autocapitalize = "off";
	input.setAttribute("autocorrect", "off");
	input.wrap = "off";
	input.value = value;
	const unit = language === "javascript" ? "  " : "    ";
	let lineCount = 0;
	const update = () => {
		const count = input.value.split("\n").length;
		if (count === lineCount) return;
		lineCount = count;
		gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
		// Grow with the code between 10 and 24 visible lines (CSSOM writes are CSP-safe).
		wrapper.style.setProperty("--psi-lines", String(Math.min(24, Math.max(10, count + 1))));
	};
	const insert = (text) => {
		input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	};
	input.addEventListener("input", update);
	input.addEventListener("scroll", () => { gutter.scrollTop = input.scrollTop; });
	input.addEventListener("focus", () => onFocus?.());
	input.addEventListener("keydown", (event) => {
		if (event.isComposing || input.disabled || input.readOnly) return;
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
			event.preventDefault();
			if (event.shiftKey && onSubmit) onSubmit();
			else if (onRun) onRun(); else el.dispatchEvent(new Event("run", { bubbles: true }));
			return;
		}
		if (event.key === "Escape") { event.preventDefault(); input.blur(); wrapper.focus(); return; }
		const lineStart = input.value.lastIndexOf("\n", input.selectionStart - 1) + 1;
		const before = input.value.slice(lineStart, input.selectionStart);
		if (event.key === "Tab" && event.shiftKey) {
			event.preventDefault();
			const indent = input.value.slice(lineStart).match(/^ */)[0].length;
			const remove = Math.min(indent, unit.length);
			if (!remove) return;
			const caret = input.selectionStart;
			input.setRangeText("", lineStart, lineStart + remove, "preserve");
			input.selectionStart = input.selectionEnd = Math.max(lineStart, caret - remove);
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return;
		}
		if (event.key === "Tab" && !event.altKey) { event.preventDefault(); insert(unit); return; }
		if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			const indent = before.match(/^\s*/)[0];
			const opens = language === "python" ? /:\s*(?:#.*)?$/.test(before) : /[{([]\s*$/.test(before);
			insert(`\n${indent}${opens ? unit : ""}`);
		}
	});
	wrapper.tabIndex = -1;
	wrapper.append(gutter, input);
	el.append(wrapper);
	update();
	return {
		getValue: () => input.value,
		setValue: (next) => { input.value = String(next); update(); },
		focus: () => input.focus(),
		get input() { return input; },
	};
}

const lanes = new Map();
let nextId = 0;

// Workers alone are not a network boundary: dynamic import can bypass deleted fetch APIs.
// A sandboxed opaque iframe supplies a restrictive CSP inherited by its blob worker.
const JS_FRAME = `<!doctype html><meta http-equiv="Content-Security-Policy"
content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'">
<script>
addEventListener("message", function initialize(event) {
	if (!event.ports[0]) return;
	removeEventListener("message", initialize);
	const port = event.ports[0];
	try {
		const url = URL.createObjectURL(new Blob([event.data.source], { type: "text/javascript" }));
		const worker = new Worker(url);
		worker.onmessage = ({ data }) => port.postMessage(data);
		worker.onerror = (error) => { error.preventDefault(); port.postMessage({
			id: event.data.payload.id, ok: false, output: "", error: error.message || "JavaScript runner failed."
		}); };
		worker.postMessage(event.data.payload);
	} catch (error) { port.postMessage({ id: event.data.payload.id, ok: false, output: "", error: String(error) }); }
});
</script>`;

async function isolatedJavascript(payload) {
	let frame, channel;
	const controller = new AbortController();
	try {
		return await withTimeout((async () => {
			const response = await fetch(new URL("./runners/js-worker.js", import.meta.url), { signal: controller.signal });
			if (!response.ok) throw new Error("Could not load the JavaScript runner.");
			const source = await response.text();
			return new Promise((resolve, reject) => {
				frame = document.createElement("iframe");
				frame.hidden = true;
				frame.title = "Isolated JavaScript runner";
				frame.setAttribute("sandbox", "allow-scripts");
				channel = new MessageChannel();
				channel.port1.onmessage = ({ data }) => { if (data?.id === payload.id) resolve(data); };
				channel.port1.onmessageerror = () => reject(new Error("JavaScript runner returned an unreadable response."));
				frame.onerror = () => reject(new Error("Could not start the isolated JavaScript runner."));
				frame.onload = () => {
					try { frame.contentWindow.postMessage({ source, payload }, "*", [channel.port2]); }
					catch (error) { reject(error); }
				};
				frame.srcdoc = JS_FRAME;
				document.body.append(frame);
			});
		})(), 5000, () => controller.abort());
	} finally {
		controller.abort();
		channel?.port1.close();
		channel?.port2.close();
		// Removing the owning document terminates its worker, including infinite loops.
		frame?.remove();
	}
}

function post(worker, payload, ms, onStage) {
	const id = ++nextId;
	return withTimeout(new Promise((resolve, reject) => {
		worker.onmessage = (event) => {
			if (event.data?.id !== id) return;
			if (event.data.stage) { try { onStage?.(event.data.stage); } catch { /* Progress is cosmetic. */ } return; }
			resolve(event.data);
		};
		worker.onerror = (event) => { event.preventDefault(); reject(new Error(event.message || "Code runner failed.")); };
		worker.onmessageerror = () => reject(new Error("Code runner returned an unreadable response."));
		worker.postMessage({ ...payload, id });
	}), ms, () => worker.terminate());
}

const warm = new Set(["javascript"]);
const LOAD_MS = 90000, RUN_MS = 10000;

const RUNTIME_NAME = { python: "Python", sql: "SQL" };
const stageListeners = new Set();

async function execute(lane, language, payload, onStage) {
	const started = performance.now();
	let worker, loading = false;
	try {
		if (typeof Worker === "undefined") throw new Error("Code execution needs a browser with Web Workers.");
		if (language === "javascript") {
			const result = await isolatedJavascript({ ...payload, id: ++nextId });
			return { ok: !!result.ok, output: result.output ?? "", error: result.error ?? "", results: result.results,
				ms: performance.now() - started };
		}
		const filename = language === "python" ? "python-worker.js" : "sql-runner.js";
		worker = lane.worker ??= new Worker(new URL(`./runners/${filename}`, import.meta.url));
		if (!warm.has(language)) {
			// Download the WebAssembly runtime under its own generous deadline; learner code keeps the 10 s budget.
			loading = true;
			const loaded = await post(worker, { code: language === "sql" ? "SELECT 1;" : "" }, LOAD_MS, (stage) => {
				onStage?.(stage);
				// A warm-up started on focus reports to whichever lab is waiting on it.
				for (const listener of stageListeners) listener(language, stage);
			});
			if (loaded.offline) return { ok: false, offline: true, system: true, output: "", error: loaded.error, ms: 0 };
			warm.add(language);
			loading = false;
		}
		const begun = performance.now();
		const result = await post(worker, payload, RUN_MS);
		return { ok: !!result.ok, output: result.output ?? "", error: result.error ?? "", results: result.results,
			table: result.table, ms: performance.now() - begun };
	} catch (error) {
		worker?.terminate();
		lane.worker = undefined;
		if (loading) {
			return { ok: false, offline: true, system: true, output: "", ms: performance.now() - started,
				error: `Couldn't load ${RUNTIME_NAME[language]} from the CDN. Check your connection and run again.` };
		}
		const message = String(error?.message ?? error);
		return { ok: false, output: "", error: message, system: /Web Workers|runner/i.test(message),
			ms: performance.now() - started };
	} finally {
		if (worker) worker.onmessage = worker.onerror = worker.onmessageerror = null;
	}
}

/** True once a runtime has loaded in this tab (Python and SQL download a WebAssembly runtime on first use). */
export function isWarm(language) { return warm.has(language); }
let warming;
/** Start downloading a runtime ahead of the first run; harmless when it is already loaded. */
export function warmUp(language) {
	if (warm.has(language) || !["python", "sql"].includes(language)) return Promise.resolve();
	warming ??= runCode({ language, code: language === "sql" ? "SELECT 1;" : "" }).finally(() => { warming = undefined; });
	return warming;
}

/** Headline (last line, e.g. "AssertionError: 4 should be even") plus the trace without Pyodide's own frames. */
export function summarizeError(text = "") {
	const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
	const headline = lines.filter((line) => line.trim()).at(-1)?.trim() ?? "";
	const kept = [];
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*File "\/lib\/python/.test(lines[i])) { if (/^\s{4,}\S/.test(lines[i + 1] ?? "")) i++; continue; }
		kept.push(lines[i]);
	}
	const detail = kept.join("\n").trim();
	return { headline, detail: detail === headline ? "" : detail };
}

/** Pair worker per-case outcomes with their labels; helper steps appear only when they fail. */
function labelled(cases, results) {
	if (!Array.isArray(results) || results.length !== cases.length) return undefined;
	return cases.flatMap((test, i) => {
		const result = results[i];
		if (!test.label && result.ok) return [];
		return [{ label: test.label ?? test.source.split("\n")[0], ok: !!result.ok, skipped: !!result.skipped,
			message: result.message ?? "" }];
	});
}

/**
 * Execute code in a timed worker; serialize runs per runtime to prevent crossed responses.
 * `onStage(stage)` reports a first-run runtime download: "loader" → "runtime" → "ready".
 */
export function runCode({ language = "javascript", setup = "", code = "", tests = "", expected, onStage } = {}) {
	if (!["python", "javascript", "sql"].includes(language)) {
		return Promise.resolve({ ok: false, output: "", error: `Unsupported language: ${language}`, ms: 0 });
	}
	if (!lanes.has(language)) lanes.set(language, { tail: Promise.resolve(), worker: undefined });
	const lane = lanes.get(language);
	const cases = splitTests(tests, language);
	const job = lane.tail.then(async () => {
		if (!cases.some((test) => test.label)) return execute(lane, language, { setup, code, tests, expected }, onStage);
		const result = await execute(lane, language, { setup, code, tests, expected, cases: cases.map((c) => c.source) },
			onStage);
		// A statement split that Python cannot parse falls back to the original, whole test block.
		if (result.results?.some((r) => /^(?:SyntaxError|IndentationError)/.test(r.message ?? ""))) {
			return execute(lane, language, { setup, code, tests, expected }, onStage);
		}
		return { ...result, tests: labelled(cases, result.results) };
	});
	lane.tail = job.catch(() => {});
	return job;
}

/** True for labels that are source code (an assertion without a message) rather than a sentence. */
export function looksLikeCode(label = "") {
	return /[()[\]{}=<>]|\b(?:is|not|in)\s+(?:True|False|None)\b/.test(String(label));
}

/**
 * Plain summary of one run for the output panel (pure; no DOM).
 * → { headline, rows: [{ state: "pass"|"fail"|"skipped", label, message }], output, system, passed, total }
 */
export function runSummary(result = {}, { language = "python", hasTests = false } = {}) {
	const output = String(result.output ?? "");
	if (result.system) return { headline: String(result.error ?? "The code runner stopped."), rows: [], output, system: true,
		passed: 0, total: 0 };
	let rows;
	if (Array.isArray(result.tests) && result.tests.length) {
		rows = result.tests.map((t) => {
			const headline = summarizeError(t.message).headline;
			// "AssertionError: 4 should be even" adds nothing under the label "4 should be even".
			const redundant = headline.replace(/^AssertionError:?\s*/, "") === t.label;
			return { state: t.ok ? "pass" : t.skipped ? "skipped" : "fail", label: t.label, code: looksLikeCode(t.label),
				message: t.ok || redundant ? "" : t.skipped ? "Not run: an earlier check stopped the tests." : headline };
		});
	} else if (language === "sql" && hasTests) {
		const mismatch = /did not match the expected rows/.test(result.error ?? "");
		rows = [{ state: result.ok ? "pass" : "fail",
			label: result.ok ? "Your rows match the expected rows" : mismatch ? "Your rows don't match the expected rows yet"
				: summarizeError(result.error).headline || "Your query didn't run",
			message: !result.ok && !mismatch ? summarizeError(result.error).detail : "" }];
	} else {
		const error = summarizeError(result.error);
		rows = [{ state: result.ok ? "pass" : "fail",
			label: result.ok ? hasTests ? "All checks passed" : "Ran without errors" : error.headline || "Your code didn't pass yet",
			message: result.ok ? "" : error.detail }];
	}
	const passed = rows.filter((r) => r.state === "pass").length, total = rows.length;
	const headline = total > 1 ? passed === total ? `All ${total} checks passed` : `${passed} of ${total} checks passed`
		: result.ok ? "Passed" : "Not passing yet";
	return { headline, rows, output, system: false, passed, total };
}

const SVG_NS = "http://www.w3.org/2000/svg";
function testMark(state) {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 18 18");
	svg.setAttribute("class", `psi-test-mark psi-mark is-${state}`);
	svg.setAttribute("aria-hidden", "true");
	const shape = document.createElementNS(SVG_NS, state === "fail" ? "path" : "circle");
	if (state === "fail") {
		shape.setAttribute("d", "M13.6 4.4 C11.6 2.2 5.4 2.6 4.3 6.6 C3.4 10.2 6.8 14.2 10.6 13.4 C14.2 12.6 15.6 9 14.4 6.4 C13.9 5.3 12.8 4.6 11.4 4.3");
		shape.setAttribute("class", "psi-mark-ring");
	} else {
		shape.setAttribute("cx", "9"); shape.setAttribute("cy", "9");
		shape.setAttribute("r", state === "pass" ? "5.5" : "3");
		shape.setAttribute("class", state === "pass" ? "psi-test-pass" : "psi-test-skip");
	}
	svg.append(shape);
	return svg;
}

function make(tag, className = "", text) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = String(text);
	return el;
}

/** Output panel for a run: a row per test (pass = highlighter dot, fail = pencil ring), then printed output. */
export function renderRunResult(result, { language = "python", hasTests = false } = {}) {
	const summary = runSummary(result, { language, hasTests });
	const panel = make("div", `psi-run-output ${summary.system ? "is-system" : result.ok ? "is-ok" : "is-fail"}`);
	if (summary.system) {
		panel.append(make("p", "psi-run-error", summary.headline));
		return panel;
	}
	const head = make("p", "psi-run-head", summary.headline);
	if (Number.isFinite(result.ms) && result.ms > 0) head.append(make("small", "", `in ${Math.round(result.ms)} ms`));
	panel.append(head);
	const list = make("ul", "psi-tests");
	for (const row of summary.rows) {
		const item = make("li", `psi-test is-${row.state}`);
		const word = { pass: "Passed: ", fail: "Failed: ", skipped: "Not run: " }[row.state];
		const label = make("span", row.code ? "psi-test-label is-code" : "psi-test-label");
		label.append(make("span", "psi-sr", word), document.createTextNode(row.label));
		item.append(testMark(row.state), label);
		if (row.message && row.message !== row.label) item.append(make("span", "psi-test-message", row.message));
		list.append(item);
	}
	panel.append(list);
	const table = result.table;
	if (table?.columns?.length) {
		const details = make("details");
		details.open = true;
		details.append(make("summary", "", `Your result (${table.values.length} ${table.values.length === 1 ? "row" : "rows"})`));
		const wrap = make("div", "psi-run-table");
		const t = make("table"), thead = make("thead"), tr = make("tr");
		for (const column of table.columns) tr.append(make("th", "", column));
		thead.append(tr);
		const tbody = make("tbody");
		for (const values of table.values.slice(0, 50)) {
			const row = make("tr");
			for (const value of values) row.append(make("td", "", value === null ? "NULL" : value));
			tbody.append(row);
		}
		t.append(thead, tbody);
		wrap.append(t);
		details.append(wrap);
		panel.append(details);
	} else if (summary.output.trim()) {
		const lines = summary.output.split("\n").length;
		const details = make("details");
		details.open = lines <= 12;
		details.append(make("summary", "", `Printed output (${lines} ${lines === 1 ? "line" : "lines"})`), make("pre", "", summary.output));
		panel.append(details);
	}
	const detail = !result.ok && !result.tests?.length ? summarizeError(result.error).detail : "";
	if (detail && !summary.rows.some((r) => r.message === detail)) {
		const details = make("details");
		details.append(make("summary", "", "Full error"), make("pre", "", detail));
		panel.append(details);
	}
	return panel;
}

const LOADING = {
	python: "Loading Python in your browser (about 10 MB, once)…",
	sql: "Loading SQL in your browser (about 1 MB, once)…",
};
const STAGES = { loader: 1, runtime: 2, ready: 3 };

/**
 * Code lab: editor on graph paper with line numbers, "Reset to starter", a first-run loading note and the output
 * panel. Returns { el, getValue, setValue, focus, run(), setDisabled(bool), input }.
 * `run()` resolves to the runCode result after rendering it.
 */
export function createCodeLab(el, { language = "python", starterCode = "", setup = "", tests = "", expected,
	onRun, onSubmit } = {}) {
	const root = make("div", "psi-codelab");
	const bar = make("div", "psi-codelab-bar");
	const name = { python: "Python", javascript: "JavaScript", sql: "SQL" }[language] ?? language;
	bar.append(make("span", "psi-codelab-lang", `${name} editor`));
	const reset = make("button", "is-quiet", "Reset to starter");
	reset.type = "button";
	bar.append(reset);
	const mount = make("div");
	const status = make("div", "psi-codelab-status");
	status.setAttribute("role", "status");
	status.hidden = true;
	const output = make("div", "psi-codelab-output");
	output.setAttribute("aria-live", "polite");
	root.append(bar, mount, status, output);
	el.append(root);
	const editor = createCodeEditor(mount, { language, value: starterCode, onRun, onSubmit });
	reset.addEventListener("click", () => {
		if (editor.getValue() === starterCode) return;
		editor.setValue(starterCode);
		editor.focus();
	});
	const hasTests = !!String(tests ?? "").trim() || expected !== undefined;
	let disabled = false;
	return {
		el: root,
		input: editor.input,
		getValue: () => editor.getValue(),
		setValue: (value) => editor.setValue(value),
		focus: () => editor.focus(),
		setDisabled(value) {
			disabled = !!value;
			editor.input.readOnly = disabled;
			reset.disabled = disabled;
		},
		async run() {
			let progress;
			if (LOADING[language] && !isWarm(language)) {
				status.replaceChildren(make("span", "", LOADING[language]));
				progress = make("progress");
				progress.max = 3;
				progress.value = 0;
				progress.setAttribute("aria-label", `Loading ${name}`);
				status.append(progress);
				status.hidden = false;
			}
			const listener = (lang, stage) => {
				if (progress && lang === language) progress.value = Math.max(progress.value, STAGES[stage] ?? 0);
			};
			stageListeners.add(listener);
			try {
				const result = await runCode({ language, setup, code: editor.getValue(), tests, expected });
				output.replaceChildren(renderRunResult(result, { language, hasTests }));
				return result;
			} finally {
				stageListeners.delete(listener);
				status.hidden = true;
				status.replaceChildren();
			}
		},
	};
}
