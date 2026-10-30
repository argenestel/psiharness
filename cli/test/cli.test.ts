import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/args.ts";
import { buildHostArgs } from "../src/host.ts";
import { main } from "../src/psi.ts";
import type { ConceptGraph } from "../../core/src/types.ts";

const entry = fileURLToPath(new URL("../src/psi.ts", import.meta.url));
const corePresent = () => ["store.ts", "graph.ts", "bkt.ts"].every((name) =>
	existsSync(fileURLToPath(new URL(`../../core/src/${name}`, import.meta.url))));
const graph: ConceptGraph = {
	topic: "test-topic", title: "Test Topic", bigIdea: "See connections", createdAt: "2026-01-01", updatedAt: "2026-01-01",
	concepts: [
		{ id: "root", title: "Root", summary: "", prerequisites: [], difficulty: 1 },
		{ id: "next", title: "Next", summary: "", prerequisites: ["root"], difficulty: 2 },
		{ id: "last", title: "Last", summary: "", prerequisites: ["next"], difficulty: 3 },
	],
};

function run(args: string[], home: string, extra: NodeJS.ProcessEnv = {}, input = "") {
	// File descriptors also work in restricted runtimes that prohibit child-process pipes.
	const capture = mkdtempSync(join(tmpdir(), "psi-cli-output-"));
	writeFileSync(join(capture, "in"), input);
	const fds = [openSync(join(capture, "in"), "r"), openSync(join(capture, "out"), "w"),
		openSync(join(capture, "err"), "w")];
	try {
		const result = spawnSync(process.execPath, [entry, ...args], {
			timeout: 20_000, stdio: fds, env: { ...process.env, PSI_HOME: home, NO_COLOR: "1", ...extra },
		});
		if (result.error) throw result.error;
		return { ...result, stdout: readFileSync(join(capture, "out"), "utf8"),
			stderr: readFileSync(join(capture, "err"), "utf8") };
	} finally {
		fds.forEach((fd) => closeSync(fd));
		rmSync(capture, { recursive: true, force: true });
	}
}

function temp(t: { after: (fn: () => void) => void }): string {
	const dir = mkdtempSync(join(tmpdir(), "psi-cli-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function fixture(home: string): string {
	const dir = join(home, "topics", graph.topic);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "graph.json"), JSON.stringify(graph));
	writeFileSync(join(dir, "learner.json"), JSON.stringify({ topic: graph.topic, mastery: {
		root: { conceptId: "root", pKnown: 0.99, attempts: 5, correct: 5 },
	}, notes: [], updatedAt: "2026-01-01" }));
	writeFileSync(join(dir, "cards.json"), JSON.stringify([{
		id: "card-1", topic: graph.topic, conceptId: "root", kind: "recall",
		prompt: "What is a root?", answer: "A starting idea.",
		createdAt: "2026-01-01",
		fsrs: { state: 0, stability: 0, difficulty: 5, reps: 0, lapses: 0, due: "2020-01-01" },
	}]));
	return dir;
}

test("arg parsing handles positionals, aliases, equals, and opaque passthrough", () => {
	assert.deepEqual(parseArgs(["learn", "linear", "algebra", "--host=omp", "--model", "a/b", "--thinking", "high",
		"--topic", "vectors", "--", "--provider", "custom", "--help"]), {
		positionals: ["learn", "linear", "algebra"],
		options: { host: "omp", model: "a/b", thinking: "high", topic: "vectors" },
		passthrough: ["--provider", "custom", "--help"],
	});
	assert.deepEqual(parseArgs(["render", "x.json", "-o", "y.html", "-q", "h", "--docker"]).options,
		{ o: "y.html", q: "h", docker: true });
	assert.equal(parseArgs(["-h"]).options.help, true);
	assert.equal(parseArgs(["--version"]).options.version, true);
});

test("arg parsing rejects missing values and unknown options", () => {
	for (const args of [["--model"], ["--host", "--help"], ["--port="], ["--mystery"], ["--open=true"]]) {
		assert.throws(() => parseArgs(args));
	}
});

test("host arguments include resources, tutor flags, host options, and prompt", () => {
	assert.deepEqual(buildHostArgs({ repo: "/repo", topic: "math", model: "model", thinking: "high", print: true,
		passthrough: ["--provider", "x"], message: "Why?" }), [
		"-e", "/repo/extension/src/index.ts", "--skill", "/repo/skills", "--prompt-template", "/repo/prompts",
		"--psi-tutor", "--psi-topic", "math", "--model", "model", "--thinking", "high", "-p",
		"--provider", "x", "--", "Why?",
	]);
	const minimal = buildHostArgs({ repo: "/repo" });
	assert.ok(minimal.includes("--psi-tutor"));
	assert.ok(!minimal.includes("-p"));
	assert.ok(!minimal.includes("--psi-topic"));
	assert.deepEqual(buildHostArgs({ repo: "/repo", model: "--", message: "-question" }).slice(-4),
		["--model", "--", "--", "-question"]);
	assert.deepEqual(buildHostArgs({ repo: "/repo", passthrough: ["--", "@notes.md"], message: "Why?" }).slice(-3),
		["--", "@notes.md", "Why?"]);
});

test("help lists every command and main returns an exit code", async (t) => {
	const home = temp(t);
	const result = run(["--help"], home);
	assert.equal(result.status, 0, result.stderr);
	for (const command of ["learn", "ask", "topics", "map", "review", "render", "crew", "studio", "import", "doctor"]) {
		assert.match(result.stdout, new RegExp(`\\b${command}\\b`));
	}
	assert.equal(await main(["--help"]), 0);
	assert.equal(run(["nonsense"], home).status, 1);
	assert.match(run(["--version"], home).stdout, /^\d+\.\d+\.\d+/);
});

test("topics and map show mastery, due cards, and graph state", (t) => {
	if (!corePresent()) return t.skip("core implementation is not present yet");
	const home = temp(t);
	fixture(home);
	const topics = run(["topics"], home);
	assert.equal(topics.status, 0, topics.stderr);
	assert.match(topics.stdout, /test-topic\s+Test Topic\s+1\/3\s+1/);
	const map = run(["map", graph.topic], home);
	assert.equal(map.status, 0, map.stderr);
	assert.match(map.stdout, /✓ Root/);
	assert.match(map.stdout, /▶ Next/);
	assert.match(map.stdout, /· Last/);
	assert.ok(map.stdout.indexOf("Root") < map.stdout.indexOf("Next"));
	assert.ok(map.stdout.indexOf("Next") < map.stdout.indexOf("Last"));
	const mermaid = run(["map", graph.topic, "--mermaid"], home);
	assert.equal(mermaid.status, 0, mermaid.stderr);
	assert.match(mermaid.stdout, /(?:graph|flowchart)\s+(?:TD|LR)/);
	assert.equal(run(["map", "absent"], home).status, 1);
});

test("import copies the complete pack and refuses overwrite or unsafe slugs", (t) => {
	if (!corePresent()) return t.skip("core implementation is not present yet");
	const root = temp(t);
	const pack = join(root, "pack");
	mkdirSync(join(pack, "storyboards"), { recursive: true });
	writeFileSync(join(pack, "graph.json"), JSON.stringify(graph));
	writeFileSync(join(pack, "cards.json"), "[]");
	writeFileSync(join(pack, "storyboards", "demo.json"), '{"id":"demo"}');
	const home = join(root, "home");
	const result = run(["import", pack], home);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readFileSync(join(home, "topics", graph.topic, "storyboards", "demo.json"), "utf8"), '{"id":"demo"}');
	assert.equal(readFileSync(join(home, "topics", graph.topic, "cards.json"), "utf8"), "[]");
	assert.equal(run(["import", pack], home).status, 1);
	writeFileSync(join(pack, "graph.json"), JSON.stringify({ ...graph, topic: "../escape" }));
	assert.equal(run(["import", pack], home).status, 1);
	assert.ok(!existsSync(join(home, "escape")));
});

test("learn and ask launch PSI_BIN in the workspace with correct flags", (t) => {
	const root = temp(t);
	const bin = join(root, "host");
	const capture = join(root, "capture.json");
	writeFileSync(bin, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify({
	argv: process.argv.slice(2), cwd: process.cwd()
}));
`, { mode: 0o755 });
	const env = { PSI_BIN: bin, PSI_HOST: "pi", CAPTURE: capture };
	const home = join(root, "home");
	const result = run(["learn", "linear", "algebra", "--model", "chosen", "--", "--offline"], home, env);
	assert.equal(result.status, 0, result.stderr);
	let recorded = JSON.parse(readFileSync(capture, "utf8"));
	assert.equal(recorded.cwd, join(home, "workspace"));
	assert.ok(recorded.argv.includes("--offline"));
	assert.ok(recorded.argv.includes("chosen"));
	assert.equal(recorded.argv.at(-1), "/learn linear algebra");
	assert.equal(run(["ask", "Why?"], home, env).status, 0);
	recorded = JSON.parse(readFileSync(capture, "utf8"));
	assert.ok(recorded.argv.includes("-p"));
	assert.equal(recorded.argv.at(-1), "Why?");
	assert.equal(run([], home, env).status, 0);
	recorded = JSON.parse(readFileSync(capture, "utf8"));
	assert.ok(!recorded.argv.includes("-p"));
	assert.equal(run(["--host", "bad"], home, env).status, 1);
	const missing = run(["learn", "--host", "omp"], home, { ...env, PSI_BIN: join(root, "missing") });
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /bun install -g @oh-my-pi\/pi-coding-agent/);
});

test("host resolves relative storage and binary paths before changing workspace", (t) => {
	const root = temp(t);
	const home = join(root, "home");
	const bin = join(root, "host");
	const capture = join(root, "capture.json");
	writeFileSync(bin, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify({
	home: process.env.PSI_HOME, cwd: process.cwd()
}));
`, { mode: 0o755 });
	const result = run([], relative(process.cwd(), home), {
		PSI_HOST: "pi", PSI_BIN: relative(process.cwd(), bin), CAPTURE: capture,
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), { home, cwd: join(home, "workspace") });
});

test("review reveals, validates rating, persists review, and handles EOF", (t) => {
	if (!corePresent()) return t.skip("core implementation is not present yet");
	const home = temp(t);
	const dir = fixture(home);
	const result = run(["review", graph.topic], home, {}, "\ninvalid\n3\n");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /A starting idea/);
	assert.match(result.stdout, /Next due:/);
	assert.match(result.stdout, /Reviewed 1 card/);
	assert.equal(JSON.parse(readFileSync(join(dir, "cards.json"), "utf8"))[0].fsrs.reps, 1);
	assert.ok(existsSync(join(dir, "reviews.jsonl")));
});

test("render detects both JSON formats and rejects unknown shapes or invalid quality", (t) => {
	const storyboardModule = fileURLToPath(new URL("../../visual/src/storyboard-html.ts", import.meta.url));
	const explorableModule = fileURLToPath(new URL("../../visual/src/explorable.ts", import.meta.url));
	if (!existsSync(storyboardModule) || !existsSync(explorableModule)) {
		return t.skip("visual implementation is not present yet");
	}
	const home = temp(t);
	const story = join(home, "story.json");
	writeFileSync(story, JSON.stringify({ id: "story", topic: graph.topic, title: "Story", style: "plain",
		scenes: [{ id: "one", narration: "Notice the connection", durationSec: 1, elements: [] }] }));
	const storyboard = run(["render", story], home);
	assert.equal(storyboard.status, 0, storyboard.stderr);
	assert.match(readFileSync(join(home, "story.html"), "utf8"), /<!doctype html>/i);
	const interactive = join(home, "interactive.json");
	writeFileSync(interactive, JSON.stringify({
		id: "interactive", topic: graph.topic, title: "Interactive", style: "plain",
		template: "function-plot", params: { fn: "x", domain: [-5, 5] },
		sliders: [], prompts: ["Try it"] }));
	const output = join(home, "out", "interactive.html");
	const explorable = run(["render", interactive, "-o", output], home);
	assert.equal(explorable.status, 0, explorable.stderr);
	assert.match(readFileSync(output, "utf8"), /<!doctype html>/i);
	writeFileSync(join(home, "unknown.json"), "{}");
	assert.equal(run(["render", join(home, "unknown.json")], home).status, 1);
	assert.equal(run(["render", "--manim", story, "-q", "invalid"], home).status, 1);
	assert.equal(run(["render", story, "-o", story], home).status, 1);
});

test("review on EOF leaves the current card untouched", (t) => {
	if (!corePresent()) return t.skip("core implementation is not present yet");
	const home = temp(t);
	const dir = fixture(home);
	const before = readFileSync(join(dir, "cards.json"), "utf8");
	const result = run(["review", graph.topic], home);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Reviewed 0 cards/);
	assert.equal(readFileSync(join(dir, "cards.json"), "utf8"), before);
	assert.ok(!existsSync(join(dir, "reviews.jsonl")));
});
