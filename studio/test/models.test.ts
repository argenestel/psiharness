import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listModels, parseModels, resetModelCache } from "../src/models.ts";

const table = "provider  model  context  max-out  thinking  images\nlocal  tiny  200K  8K  yes  no\n";
test("parse the pi table including token units and reasoning", () => {
	assert.deepEqual(parseModels(table), [{ id: "local/tiny", provider: "local", name: "tiny",
		context: 200000, reasoning: true }]);
	assert.equal(parseModels(table.replace("200K", "1.5M"))[0].context, 1500000);
	assert.deepEqual(parseModels("No models available"), []);
});
test("model discovery caches for ten minutes and falls back on failure", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "psi-model-test-"));
	t.after(() => { resetModelCache(); rmSync(home, { recursive: true, force: true }); });
	const bin = join(home, "pi.mjs"), calls = join(home, "calls");
	writeFileSync(bin, `#!/bin/sh
printf x >> '${calls}'
printf '%s' '${table}'
`);
	chmodSync(bin, 0o755);
	resetModelCache();
	const first = await listModels({ bin, now: 0 });
	assert.equal(first.error, undefined);
	assert.equal(first.models[0].id, "local/tiny");
	await listModels({ bin, now: 599999 });
	assert.equal(readFileSync(calls, "utf8"), "x");
	await listModels({ bin, now: 600000 });
	assert.equal(readFileSync(calls, "utf8"), "xx");
	const old = process.env.PSI_WEB_MODEL;
	t.after(() => { if (old === undefined) delete process.env.PSI_WEB_MODEL; else process.env.PSI_WEB_MODEL = old; });
	process.env.PSI_WEB_MODEL = "local/default";
	const fallback = await listModels({ bin: join(home, "missing") });
	assert.equal(fallback.default, "local/default");
	assert.equal(fallback.models[0].id, "local/default");
	assert.match(fallback.error!, /discovery failed/);
});
