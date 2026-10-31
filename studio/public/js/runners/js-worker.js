/* Each run uses a disposable worker; never expose the DOM to learner code. */
const reply = self.postMessage.bind(self);
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "Worker", "SharedWorker", "EventSource"]) {
	try { delete self[name]; } catch { /* Some engines expose inherited properties. */ }
	Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
}
self.onmessage = async ({ data: { id, setup = "", code = "", tests = "", cases } }) => {
	const started = performance.now();
	const lines = [];
	const log = (...args) => {
		if (lines.length >= 1000) return;
		lines.push(args.map((value) => {
			try { return typeof value === "string" ? value : JSON.stringify(value) ?? String(value); }
			catch { return String(value); }
		}).join(" ").slice(0, 10000));
	};
	const console = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((key) => [key, log]));
	console.assert = (value, ...args) => { if (!value) throw new Error(args.join(" ") || "Assertion failed"); };
	// Split tests keep one shared scope; a marker before each statement tells which check threw.
	const split = Array.isArray(cases) && cases.length > 0;
	let current = -1;
	const mark = (index) => { current = index; };
	const body = split ? `${cases.map((source, i) => `__psiCase(${i});\n${source}`).join("\n")}\n__psiCase(${cases.length});`
		: tests;
	try {
		// One function scope lets tests access declarations in setup and learner code.
		await new Function("console", "__psiCase", `"use strict";\n${setup}\n${code}\n${body}`)(console, mark);
		reply({ id, ok: true, output: lines.join("\n"), error: "", ms: performance.now() - started,
			results: split ? cases.map(() => ({ ok: true })) : undefined });
	} catch (error) {
		const message = String(error?.message ?? error);
		reply({ id, ok: false, output: lines.join("\n"), error: String(error?.stack || error),
			ms: performance.now() - started, results: split && current >= 0 ? cases.map((_, i) => i < current ? { ok: true }
				: i === current ? { ok: false, message } : { ok: false, skipped: true }) : undefined });
	}
};
