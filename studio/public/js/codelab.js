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

/** Mount an accessible, dependency-free code editor. */
export function createCodeEditor(el, { language = "javascript", value = "", onRun } = {}) {
	const wrapper = document.createElement("div");
	wrapper.className = "psi-code-editor";
	const gutter = document.createElement("pre");
	gutter.className = "psi-code-gutter";
	gutter.setAttribute("aria-hidden", "true");
	const input = document.createElement("textarea");
	input.className = "psi-code-input";
	input.setAttribute("aria-label", `${language} code`);
	input.spellcheck = false;
	input.wrap = "off";
	input.value = value;
	const update = () => { gutter.textContent = input.value.split("\n").map((_, i) => i + 1).join("\n"); };
	input.addEventListener("input", update);
	input.addEventListener("scroll", () => { gutter.scrollTop = input.scrollTop; });
	input.addEventListener("keydown", (event) => {
		if (event.isComposing || input.disabled || input.readOnly) return;
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
			event.preventDefault();
			if (onRun) onRun(); else el.dispatchEvent(new Event("run", { bubbles: true }));
			return;
		}
		if (event.key !== "Tab" && event.key !== "Enter") return;
		event.preventDefault();
		const before = input.value.slice(0, input.selectionStart).split("\n").at(-1);
		const insert = event.key === "Tab" ? " ".repeat(language === "javascript" ? 2 : 4)
			: `\n${before.match(/^\s*/)[0]}`;
		input.setRangeText(insert, input.selectionStart, input.selectionEnd, "end");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	wrapper.append(gutter, input);
	el.append(wrapper);
	update();
	return {
		getValue: () => input.value,
		setValue: (next) => { input.value = String(next); update(); },
		focus: () => input.focus(),
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

async function execute(lane, language, payload) {
	const started = performance.now();
	let worker;
	try {
		if (typeof Worker === "undefined") throw new Error("Code execution needs a browser with Web Workers.");
		if (language === "javascript") {
			const result = await isolatedJavascript({ ...payload, id: ++nextId });
			return { ok: !!result.ok, output: result.output ?? "", error: result.error ?? "", ms: performance.now() - started };
		}
		const filename = language === "python" ? "python-worker.js" : "sql-runner.js";
		worker = lane.worker ??= new Worker(new URL(`./runners/${filename}`, import.meta.url));
		const id = ++nextId;
		const result = await withTimeout(new Promise((resolve, reject) => {
			worker.onmessage = (event) => { if (event.data?.id === id) resolve(event.data); };
			worker.onerror = (event) => { event.preventDefault(); reject(new Error(event.message || "Code runner failed.")); };
			worker.onmessageerror = () => reject(new Error("Code runner returned an unreadable response."));
			worker.postMessage({ ...payload, id });
		}), 10000, () => worker.terminate());
		return { ok: !!result.ok, output: result.output ?? "", error: result.error ?? "", ms: performance.now() - started };
	} catch (error) {
		worker?.terminate();
		lane.worker = undefined;
		return { ok: false, output: "", error: String(error?.message ?? error), ms: performance.now() - started };
	} finally {
		if (worker) worker.onmessage = worker.onerror = worker.onmessageerror = null;
	}
}

/** Execute code in a timed worker; serialize runs per runtime to prevent crossed responses. */
export function runCode({ language = "javascript", setup = "", code = "", tests = "", expected } = {}) {
	if (!["python", "javascript", "sql"].includes(language)) {
		return Promise.resolve({ ok: false, output: "", error: `Unsupported language: ${language}`, ms: 0 });
	}
	if (!lanes.has(language)) lanes.set(language, { tail: Promise.resolve(), worker: undefined });
	const lane = lanes.get(language);
	const job = lane.tail.then(() => execute(lane, language, { setup, code, tests, expected }));
	lane.tail = job.catch(() => {});
	return job;
}
