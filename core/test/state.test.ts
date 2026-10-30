import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StateStore } from "../src/index.ts";

function fixture(t: { after: (fn: () => void) => void }): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-state-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return home;
}

test("state starts empty without writes and round-trips across processes", (t) => {
	const home = fixture(t), store = new StateStore(home);
	assert.ok(Number.isFinite(Date.parse(store.read().updatedAt)));
	assert.deepEqual(fs.readdirSync(home), []);
	const state = store.update({ activeSkill: "sql-queries", activeTopic: "joins",
		openChallenge: { skill: "sql-queries", id: "challenge_123" } });
	assert.deepEqual(new StateStore(home).read(), state);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8")), state);
});

test("updates merge fields and undefined deletes keys in memory and on disk", (t) => {
	const store = new StateStore(fixture(t));
	store.update({ activeSkill: "sql", activeTopic: "joins", openChallenge: { skill: "sql", id: "one" } });
	const merged = store.update({ activeTopic: "select" });
	assert.equal(merged.activeSkill, "sql");
	assert.equal(merged.activeTopic, "select");
	assert.deepEqual(merged.openChallenge, { skill: "sql", id: "one" });
	const state = store.update({ activeSkill: undefined, activeTopic: undefined, openChallenge: undefined });
	assert.deepEqual(Object.keys(state), ["updatedAt"]);
	assert.deepEqual(store.read(), state);
});

test("atomic updates create parents and leave only state.json after replacements", (t) => {
	const home = path.join(fixture(t), "nested"), store = new StateStore(home);
	store.update({ activeSkill: "sql" });
	store.update({ activeSkill: "python" });
	assert.deepEqual(fs.readdirSync(home), ["state.json"]);
	assert.equal(store.read().activeSkill, "python");
});

test("invalid slugs reject updates without modifying persisted state", (t) => {
	const store = new StateStore(fixture(t)), original = store.update({ activeSkill: "valid-123" });
	for (const invalid of ["", "../x", "a/b", "a\\b", "Bad", "two words", "a--b", "-a", "a-", "a%2fb", "x\0y"]) {
		assert.throws(() => store.update({ activeSkill: invalid }), /Invalid.*slug/);
		assert.throws(() => store.update({ activeTopic: invalid }), /Invalid.*slug/);
		assert.throws(() => store.update({ openChallenge: { skill: invalid, id: "one" } }), /Invalid.*slug/);
	}
	assert.throws(() => store.update({ openChallenge: { skill: "sql", id: " " } }), /Invalid openChallenge/);
	assert.deepEqual(store.read(), original);
	assert.deepEqual(fs.readdirSync(store.root), ["state.json"]);
});

test("home defaults to PSI_HOME or ~/.psi, with explicit home taking precedence", (t) => {
	const home = fixture(t), previous = process.env.PSI_HOME;
	try {
		process.env.PSI_HOME = path.join(home, "env");
		const store = new StateStore();
		assert.equal(store.root, process.env.PSI_HOME);
		store.update({ activeSkill: "sql" });
		assert.equal(new StateStore().read().activeSkill, "sql");
		assert.equal(new StateStore(home).root, home);
		delete process.env.PSI_HOME;
		assert.equal(new StateStore().root, path.join(os.homedir(), ".psi"));
	} finally {
		if (previous === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previous;
	}
});

test("state refuses file symlinks and reports malformed saved data", (t) => {
	const home = fixture(t), store = new StateStore(home), file = path.join(home, "state.json");
	const target = path.join(home, "other.json");
	fs.writeFileSync(target, "{}");
	fs.symlinkSync(target, file);
	assert.throws(() => store.read(), /Refusing symlink/);
	assert.throws(() => store.update({}), /Refusing symlink/);
	assert.equal(fs.readFileSync(target, "utf8"), "{}");
	fs.unlinkSync(file);
	fs.writeFileSync(file, "{");
	assert.throws(() => store.read(), SyntaxError);
	fs.writeFileSync(file, JSON.stringify({ activeSkill: "../bad", updatedAt: "now" }));
	assert.throws(() => store.read(), /Invalid.*slug/);
});
