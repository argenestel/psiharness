/* Each run uses a disposable worker; never expose the DOM to learner code. */
const reply = self.postMessage.bind(self);
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "Worker", "SharedWorker", "EventSource"]) {
	try { delete self[name]; } catch { /* Some engines expose inherited properties. */ }
	Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
}
self.onmessage = async ({ data: { id, setup = "", code = "", tests = "" } }) => {
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
	try {
		// One function scope lets tests access declarations in setup and learner code.
		await new Function("console", `"use strict";\n${setup}\n${code}\n${tests}`)(console);
		reply({ id, ok: true, output: lines.join("\n"), error: "", ms: performance.now() - started });
	} catch (error) {
		reply({ id, ok: false, output: lines.join("\n"), error: String(error.stack || error),
			ms: performance.now() - started });
	}
};
