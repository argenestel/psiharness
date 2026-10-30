const CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const OFFLINE = "Offline: could not load Pyodide from the CDN. Code runs in your browser once you are back online.";
let runtime;
self.onmessage = async ({ data: { id, setup = "", code = "", tests = "" } }) => {
	const started = performance.now();
	const lines = [];
	let globals;
	try {
		if (!runtime) {
			try {
				importScripts(`${CDN}pyodide.js`);
				runtime = await self.loadPyodide({ indexURL: CDN });
			} catch { runtime = undefined; throw new Error(OFFLINE); }
		}
		const capture = (text) => { if (lines.length < 1000) lines.push(text.slice(0, 10000)); };
		runtime.setStdout({ batched: capture });
		runtime.setStderr({ batched: capture });
		globals = runtime.runPython("dict()");
		for (const source of [setup, code, tests]) if (source) await runtime.runPythonAsync(source, { globals });
		self.postMessage({ id, ok: true, output: lines.join("\n"), error: "", ms: performance.now() - started });
	} catch (error) {
		self.postMessage({ id, ok: false, output: lines.join("\n"), error: String(error.message || error),
			ms: performance.now() - started });
	} finally { globals?.destroy(); }
};
