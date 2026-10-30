import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PsiStore } from "../../core/src/index.ts";
import type { CrewRole, CrewTask } from "../../core/src/index.ts";
import { buildLesson, crewArgs, crewHost, roleCanWrite, roleTools, ROLE_PROMPTS, ROLE_TOOLS, runCrew, runCrewTask } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "psi-crew-"));
after(() => rmSync(root, { recursive: true, force: true }));
const bin = join(root, "fake-host");
writeFileSync(bin, `#!/usr/bin/env node
// The fake host emits JSONL rather than the inherited Node test IPC protocol.
delete process.env.NODE_TEST_CONTEXT;
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const message = args[args.indexOf("--") + 1];
const prompt = args[args.indexOf("--append-system-prompt") + 1];
const tools = args[args.indexOf("--tools") + 1];
const role = prompt.match(/^You are the (architect|intuition|storyteller|visualizer|quizmaster|critic)/)[1];
const log = path.join(process.env.PSI_HOME, "events.jsonl");
function record(event) { fs.appendFileSync(log, JSON.stringify({role,event,time:Date.now(),message}) + "\\n"); }
function emit(event) { fs.writeSync(1, JSON.stringify(event) + "\\n"); }
record("start");
if (message.includes("FAKE_SLEEP")) {
	process.on("SIGTERM", () => {});
	setInterval(() => {}, 1000);
} else {
	const delay = message.includes("FAKE_SHORT") ? 160 : 15;
	setTimeout(() => {
		fs.writeFileSync(path.join(process.cwd(), role + ".txt"), message);
		fs.writeFileSync(path.join(process.cwd(), role + "-args.json"), JSON.stringify({args,tools,prompt,message}));
		record("end");
		if (message.includes("FAKE_FAIL")) { fs.writeSync(2, "fake host failure detail\\n"); process.exit(1); }
		if (message.includes("FAKE_RAW")) { fs.writeSync(1, "plain raw reply\\n"); return; }
		emit({type:"session",version:3});
		emit({type:"agent_start"});
		fs.writeSync(1, "not-json\\n");
		emit({type:"future_event",payload:123});
		emit({type:"message_end",message:{role:"system",sections:[]}});
		emit({type:"message_end",message:{role:"user",content:[{type:"text",text:message}]}});
		if (!message.includes("FAKE_END_ONLY")) {
			emit({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"old answer"}]}});
		}
		const assistant = {role:"assistant",content:[{type:"text",text:role + " final"},
			{type:"toolCall",name:"ignored"},{type:"text",text:" reply"}],
			stopReason:message.includes("FAKE_ERROR") ? "error" : message.includes("FAKE_ABORTED") ? "aborted" : "stop",
			errorMessage:"assistant failure detail"};
		if (!message.includes("FAKE_FALLBACK") && !message.includes("FAKE_END_ONLY")) {
			emit({type:"message_end",message:assistant});
		}
		emit({type:"turn_end",message:assistant});
		emit({type:"agent_end",messages:[assistant]});
		emit({type:"agent_settled",aborted:false});
	}, delay);
}
`);
chmodSync(bin, 0o755);
let serial = 0;
function fixture(): { store: PsiStore; topic: string } {
	const home = join(root, `home-${serial++}`);
	mkdirSync(home);
	return { store: new PsiStore(home), topic: "example" };
}
function task(instructions = "Explain the idea", role: CrewRole = "intuition"): CrewTask {
	return { role, topic: "example", conceptId: "core-idea", instructions };
}
function events(store: PsiStore): { role: CrewRole; event: string; time: number; message: string }[] {
	return readFileSync(join(store.root, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

test("role prompts cover the contract and critic has strictly read-only tools", () => {
	const roles: CrewRole[] = ["architect", "intuition", "storyteller", "visualizer", "quizmaster", "critic"];
	assert.deepEqual(Object.keys(ROLE_PROMPTS).sort(), [...roles].sort());
	assert.deepEqual(Object.keys(ROLE_TOOLS).sort(), [...roles].sort());
	for (const role of roles) {
		const words = ROLE_PROMPTS[role].trim().split(/\s+/).length;
		assert.ok(words >= 300 && words <= 700, `${role}: ${words} words`);
		assert.ok(ROLE_TOOLS[role].length);
	}
	assert.deepEqual(ROLE_TOOLS.critic, ["read", "grep", "find", "ls"]);
});

test("parses last assistant text, ignores unknown events, tracks files, and logs once", async () => {
	const { store, topic } = fixture();
	mkdirSync(store.topicDir(topic), { recursive: true });
	writeFileSync(join(store.topicDir(topic), "unchanged.txt"), "keep");
	const result = await runCrewTask({ ...task("-a message"), inputs: ["unchanged.txt"] }, { store, bin, model: "test" });
	assert.equal(result.ok, true);
	assert.equal(result.output, "intuition final reply");
	assert.deepEqual(result.files, ["intuition-args.json", "intuition.txt"]);
	assert.ok(result.durationMs > 0);
	const args = JSON.parse(readFileSync(join(store.topicDir(topic), "intuition-args.json"), "utf8"));
	assert.equal(args.tools, ROLE_TOOLS.intuition.join(","));
	assert.ok(args.args.includes("--no-session"));
	assert.ok(args.args.includes("test"));
	assert.match(args.args[args.args.indexOf("-e") + 1], /extension\/src\/index.ts$/);
	assert.match(args.message, /core-idea/);
	assert.match(args.message, /unchanged.txt/);
	const log = readFileSync(join(store.topicDir(topic), "crew/log.jsonl"), "utf8").trim().split("\n");
	assert.equal(log.length, 1);
	assert.deepEqual(JSON.parse(log[0]), result);
});

test("PSI_BIN environment selects the fake host and raw stdout is a fallback", async () => {
	const { store } = fixture();
	const previous = process.env.PSI_BIN;
	process.env.PSI_BIN = bin;
	try {
		const result = await runCrewTask(task("FAKE_RAW"), { store });
		assert.equal(result.ok, true);
		assert.equal(result.output, "plain raw reply");
	} finally {
		if (previous === undefined) delete process.env.PSI_BIN;
		else process.env.PSI_BIN = previous;
	}
});

test("non-zero exit, assistant errors, aborted messages, and spawn errors become failed results", async () => {
	for (const [instructions, error] of [["FAKE_FAIL", /fake host failure detail/],
		["FAKE_ERROR", /assistant failure detail/], ["FAKE_ABORTED", /assistant failure detail/]] as const) {
		const { store } = fixture();
		const result = await runCrewTask(task(instructions), { store, bin });
		assert.equal(result.ok, false);
		assert.match(result.error!, error);
	}
	const { store } = fixture();
	const result = await runCrewTask(task(), { store, bin: join(root, "missing") });
	assert.equal(result.ok, false);
	assert.match(result.error!, /ENOENT/);
});

test("last message_end takes priority over agent_end fallback", async () => {
	const { store } = fixture();
	const result = await runCrewTask(task("FAKE_FALLBACK"), { store, bin });
	assert.equal(result.output, "old answer");
});

test("agent_end supplies the final assistant when no assistant message_end exists", async () => {
	const { store } = fixture();
	const result = await runCrewTask(task("FAKE_END_ONLY"), { store, bin });
	assert.equal(result.ok, true);
	assert.equal(result.output, "intuition final reply");
});

test("abort kills a SIGTERM-resistant child quickly and logs the failure", async () => {
	const { store, topic } = fixture();
	const controller = new AbortController();
	const pending = runCrewTask(task("FAKE_SLEEP"), { store, bin, signal: controller.signal });
	const timer = setTimeout(() => controller.abort(), 150);
	try {
		const result = await pending;
		assert.equal(result.ok, false);
		assert.equal(result.error, "aborted");
		assert.ok(result.durationMs < 3000);
		assert.ok(existsSync(join(store.topicDir(topic), "crew/log.jsonl")));
	} finally { clearTimeout(timer); }
});

test("pre-aborted signals never spawn a host", async () => {
	const { store } = fixture();
	const result = await runCrewTask(task(), { store, bin, signal: AbortSignal.abort() });
	assert.equal(result.error, "aborted");
	assert.equal(existsSync(join(store.root, "events.jsonl")), false);
});

test("timeout kills a sleeping host", async () => {
	const { store } = fixture();
	const result = await runCrewTask(task("FAKE_SLEEP"), { store, bin, timeoutMs: 300 });
	assert.equal(result.ok, false);
	assert.equal(result.error, "timeout after 300ms");
	assert.ok(result.durationMs < 3000);
});

test("worker pool preserves order and bounds concurrency including the default of three", async () => {
	for (const concurrency of [undefined, 2]) {
		const { store, topic } = fixture();
		const roles: CrewRole[] = ["intuition", "critic", "architect", "storyteller", "quizmaster", "visualizer"];
		const results = await runCrew(roles.map((role) => task("FAKE_SHORT", role)), { store, bin, concurrency });
		assert.deepEqual(results.map((result) => result.role), roles);
		assert.ok(results.every((result) => result.ok));
		let active = 0;
		let max = 0;
		for (const event of events(store)) {
			active += event.event === "start" ? 1 : -1;
			max = Math.max(max, active);
		}
		assert.equal(active, 0);
		assert.equal(max, concurrency ?? 3);
		const lines = readFileSync(join(store.topicDir(topic), "crew/log.jsonl"), "utf8").trim().split("\n");
		assert.equal(lines.length, roles.length);
	}
	assert.deepEqual(await runCrew([], { bin }), []);
});

test("buildLesson strictly orders phases, writes briefs, and passes graph context", async () => {
	const { store, topic } = fixture();
	const now = new Date().toISOString();
	store.writeGraph(topic, { topic, title: "Topic", bigIdea: "See the idea", createdAt: now, updatedAt: now,
		concepts: [{ id: "core-idea", title: "The important concept", summary: "A testable summary.",
			prerequisites: [], difficulty: 1 }] });
	const results = await buildLesson(topic, "core-idea", { store, bin });
	assert.deepEqual(results.map((result) => result.role),
		["intuition", "storyteller", "visualizer", "quizmaster", "critic"]);
	assert.ok(results.every((result) => result.ok));
	const history = events(store);
	const index = (role: CrewRole, event: string): number =>
			history.findIndex((row) => row.role === role && row.event === event);
	for (const role of ["intuition", "storyteller"] as const) {
		assert.ok(index(role, "start") < index("visualizer", "start"));
		assert.ok(index(role, "end") < index("visualizer", "start"));
	}
	for (const role of ["quizmaster", "critic"] as const) {
		assert.ok(index("visualizer", "end") < index(role, "start"));
	}
	assert.ok(history.every((row) => row.message.includes("The important concept: A testable summary.")));
	for (const role of ["intuition", "storyteller", "visualizer"]) {
		assert.match(readFileSync(join(store.topicDir(topic), "crew", `${role}.md`), "utf8"), /final reply/);
	}
	assert.match(history.find((row) => row.role === "critic")!.message, /crew\/visualizer.md/);
	assert.equal(readFileSync(join(store.topicDir(topic), "crew/log.jsonl"), "utf8").trim().split("\n").length, 5);
});

test("buildLesson continues after a visualizer failure and tells the critic", async () => {
	const { store, topic } = fixture();
	// A tiny wrapper injects failure only into the visualizer's message.
	const wrapper = join(root, "fail-visualizer");
	writeFileSync(wrapper, `#!/usr/bin/env node
delete process.env.NODE_TEST_CONTEXT;
const {spawnSync} = require("node:child_process");
const args = process.argv.slice(2);
if (args[args.indexOf("--append-system-prompt") + 1].startsWith("You are the visualizer")) {
	args[args.indexOf("--") + 1] += " FAKE_FAIL";
}
const result = spawnSync(${JSON.stringify(bin)}, args, {stdio:"inherit"});
process.exit(result.status ?? 1);
`);
	chmodSync(wrapper, 0o755);
	const results = await buildLesson(topic, "core-idea", { store, bin: wrapper });
	assert.equal(results[2].ok, false);
	assert.equal(results[3].ok, true);
	assert.equal(results[4].ok, true);
	assert.match(events(store).find((row) => row.role === "critic")!.message, /Visualizer failed/);
	assert.match(readFileSync(join(store.topicDir(topic), "crew/visualizer.md"), "utf8"), /^FAILED:/);
});

test("role agents get the psi extension, skills, prompts, model and extra host args", () => {
	const args = crewArgs(task("Quiz", "quizmaster"), { model: "xai/grok-4.6", args: ["--thinking", "low", "--"] });
	assert.match(args[args.indexOf("-e") + 1], /extension\/src\/index.ts$/);
	const skills = args[args.indexOf("--skill") + 1];
	assert.match(skills, /[\\/]skills$/);
	assert.ok(existsSync(join(skills, "retrieval-practice", "SKILL.md")));
	assert.match(args[args.indexOf("--prompt-template") + 1], /[\\/]prompts$/);
	assert.equal(args[args.indexOf("--tools") + 1], ROLE_TOOLS.quizmaster.join(","));
	assert.equal(args[args.indexOf("--model") + 1], "xai/grok-4.6");
	assert.equal(args[args.indexOf("--thinking") + 1], "low");
	assert.equal(args.filter((arg) => arg === "--").length, 1, "only the message separator");
	assert.equal(args.at(-2), "--");
	assert.match(args.at(-1)!, /^Quiz/);
});

test("role tool allowlists name only real pi built-ins or registered psi tools", async () => {
	const builtins = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
	const psi = new Set<string>();
	const extension = (await import("../../extension/src/index.ts")).default;
	extension({ registerTool: (tool: { name: string }) => psi.add(tool.name), registerCommand() {}, registerFlag() {},
		getFlag() {}, on() {}, appendEntry() {}, sendUserMessage() {}, sendMessage() {} } as never);
	for (const [role, tools] of Object.entries(ROLE_TOOLS)) {
		for (const tool of tools) assert.ok(builtins.has(tool) || psi.has(tool), `${role}: unknown tool ${tool}`);
	}
});

test("a read-only critic running beside a writer is not credited with the writer's files", async () => {
	const { store } = fixture();
	const [quizmaster, critic] = await runCrew([task("FAKE_SHORT", "quizmaster"), task("FAKE_SHORT", "critic")],
		{ store, bin, concurrency: 2 });
	assert.ok(quizmaster.files.includes("quizmaster.txt"));
	assert.deepEqual(critic.files, []);
	assert.equal(roleCanWrite("critic"), false);
	assert.equal(roleCanWrite("quizmaster"), true);
});

test("omp role agents skip pi-only resource flags and get a readable skill index", () => {
	const args = crewArgs(task("Quiz", "quizmaster"), { host: "omp" });
	assert.ok(!args.includes("--skill"));
	assert.ok(!args.includes("--prompt-template"));
	assert.match(args[args.indexOf("--append-system-prompt") + 1], /^You are the quizmaster[\s\S]*## psi skills[\s\S]*SKILL\.md/);
	assert.equal(crewHost({ bin: "/opt/omp/bin/omp" }), process.env.PSI_HOST === "pi" ? "pi" : "omp");
	assert.equal(crewHost({ host: "pi", bin: "/opt/omp/bin/omp" }), "pi");
	// omp rejects `ls` (unknown) and `find` (unavailable without fd); glob replaces both.
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,glob,psi_cards_add,psi_note");
	assert.deepEqual(roleTools("critic", "omp"), ["read", "grep", "glob"]);
	assert.deepEqual(roleTools("critic", "pi"), ROLE_TOOLS.critic);
});

test("manim's media cache is not reported as crew output", async () => {
	const { store, topic } = fixture();
	const wrapper = join(root, "media-host");
	writeFileSync(wrapper, `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
fs.mkdirSync(path.join(process.cwd(), "artifacts/media/texts"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "artifacts/media/texts/a.svg"), "x");
fs.writeFileSync(path.join(process.cwd(), "artifacts/scene.mp4"), "v");
`);
	chmodSync(wrapper, 0o755);
	const result = await runCrewTask(task("Draw", "visualizer"), { store, bin: wrapper });
	assert.deepEqual(result.files, ["artifacts/scene.mp4"]);
	assert.ok(existsSync(join(store.topicDir(topic), "artifacts/media/texts/a.svg")));
});
