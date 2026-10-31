const CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const OFFLINE = "Couldn't load Python from the CDN. Check your connection and run again.";
let runtime;
const lastLine = (text) => String(text).trim().split("\n").filter(Boolean).at(-1) ?? "";
self.onmessage = async ({ data: { id, setup = "", code = "", tests = "", cases } }) => {
	const started = performance.now();
	const lines = [];
	let globals;
	try {
		if (!runtime) {
			try {
				// Stage messages let the page explain the one-time download while it happens.
				self.postMessage({ id, stage: "loader" });
				importScripts(`${CDN}pyodide.js`);
				self.postMessage({ id, stage: "runtime" });
				runtime = await self.loadPyodide({ indexURL: CDN });
				self.postMessage({ id, stage: "ready" });
			} catch {
				runtime = undefined;
				self.postMessage({ id, ok: false, offline: true, output: "", error: OFFLINE, ms: performance.now() - started });
				return;
			}
		}
		const capture = (text) => { if (lines.length < 1000) lines.push(text.slice(0, 10000)); };
		runtime.setStdout({ batched: capture });
		runtime.setStderr({ batched: capture });
		globals = runtime.runPython("dict()");
		for (const source of [setup, code]) if (source) await runtime.runPythonAsync(source, { globals });
		let results;
		if (Array.isArray(cases) && cases.length) {
			// Each top-level test statement runs on its own so the learner sees every passing and failing check.
			results = [];
			for (const source of cases) {
				try { await runtime.runPythonAsync(source, { globals }); results.push({ ok: true }); }
				catch (error) { results.push({ ok: false, message: lastLine(error.message || error) }); }
			}
		} else if (tests) await runtime.runPythonAsync(tests, { globals });
		const failed = results?.find((result) => !result.ok);
		self.postMessage({ id, ok: !failed, output: lines.join("\n"), error: failed ? failed.message : "", results,
			ms: performance.now() - started });
	} catch (error) {
		self.postMessage({ id, ok: false, output: lines.join("\n"), error: String(error.message || error),
			ms: performance.now() - started });
	} finally { globals?.destroy(); }
};
