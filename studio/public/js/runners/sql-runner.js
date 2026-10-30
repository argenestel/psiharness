
const CDN = "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/";
const OFFLINE = "Offline: could not load sql.js from the CDN. Code runs in your browser once you are back online.";
let runtime;

async function loadRuntime() {
	if (!runtime) {
		try {
			importScripts(`${CDN}sql-wasm.js`);
			runtime = await globalThis.initSqlJs({ locateFile: (file) => `${CDN}${file}` });
		} catch { runtime = undefined; throw new Error(OFFLINE); }
	}
	return runtime;
}

self.onmessage = async ({ data: { id, setup = "", code = "", tests = "", expected } }) => {
	const started = performance.now();
	let db, reference;
	let output = "";
	try {
		const { compareRows } = await import("../codelab.js");
		const SQL = await loadRuntime();
		db = new SQL.Database();
		if (setup) db.exec(setup);
		// Evaluate the reference against the same pristine setup, even when learner SQL mutates data.
		let wanted;
		if (expected !== undefined) wanted = typeof expected === "string" ? JSON.parse(expected) : expected;
		else if (tests) {
			reference = new SQL.Database(db.export());
			wanted = reference.exec(tests).at(-1)?.values ?? [];
		}
		const results = db.exec(code);
		output = results.map(({ columns, values }) => [columns.join(" | "),
			...values.map((row) => row.map((v) => v === null ? "NULL" : String(v)).join(" | "))].join("\n"))
			.join("\n\n");
		const actual = results.at(-1)?.values ?? [];
		const ok = wanted === undefined || compareRows(actual, wanted, { ordered: tests.includes("-- ordered") });
		self.postMessage({ id, ok, output, error: ok ? "" : "The result rows did not match the expected rows.",
			ms: performance.now() - started });
	} catch (error) {
		self.postMessage({ id, ok: false, output, error: String(error.message || error), ms: performance.now() - started });
	} finally { db?.close(); reference?.close(); }
};
