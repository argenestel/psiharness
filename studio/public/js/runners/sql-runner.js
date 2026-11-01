
const CDN = "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/";
const OFFLINE = "Couldn't load SQL from the CDN. Check your connection and run again.";
let runtime;

class Offline extends Error {}

async function loadRuntime(id) {
	if (!runtime) {
		try {
			// Stage messages let the page explain the one-time download while it happens.
			self.postMessage({ id, stage: "loader" });
			importScripts(`${CDN}sql-wasm.js`);
			self.postMessage({ id, stage: "runtime" });
			runtime = await globalThis.initSqlJs({ locateFile: (file) => `${CDN}${file}` });
			self.postMessage({ id, stage: "ready" });
		} catch { runtime = undefined; throw new Offline(OFFLINE); }
	}
	return runtime;
}

self.onmessage = async ({ data: { id, setup = "", code = "", tests = "", expected } }) => {
	const started = performance.now();
	let db, reference, table;
	let output = "";
	try {
		/** @type {PsiCodelabModule} */
		const { compareRows } = await import("../codelab.js");
		const SQL = await loadRuntime(id);
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
		const last = results.at(-1);
		table = last ? { columns: last.columns, values: last.values.slice(0, 200) } : undefined;
		output = results.map(({ columns, values }) => [columns.join(" | "),
			...values.map((row) => row.map((v) => v === null ? "NULL" : String(v)).join(" | "))].join("\n"))
			.join("\n\n");
		const actual = results.at(-1)?.values ?? [];
		const ok = wanted === undefined || compareRows(actual, wanted, { ordered: tests.includes("-- ordered") });
		self.postMessage({ id, ok, output, table, error: ok ? "" : "The result rows did not match the expected rows.",
			ms: performance.now() - started });
	} catch (error) {
		self.postMessage({ id, ok: false, offline: error instanceof Offline, output, table,
			error: String(error.message || error), ms: performance.now() - started });
	} finally { db?.close(); reference?.close(); }
};
