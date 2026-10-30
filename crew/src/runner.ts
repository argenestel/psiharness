import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PsiStore } from "../../core/src/index.ts";
import type { CrewResult, CrewTask } from "../../core/src/index.ts";
import { ROLE_PROMPTS, ROLE_TOOLS } from "./roles.ts";

/** Host process and storage settings shared by crew operations. */
export interface CrewOptions {
	store?: PsiStore;
	host?: "pi" | "omp";
	model?: string;
	signal?: AbortSignal;
	bin?: string;
	timeoutMs?: number;
	/** Extra host arguments (e.g. `--thinking low`), placed before the `--` message separator. */
	args?: string[];
}

const extensionPath = fileURLToPath(new URL("../../extension/src/index.ts", import.meta.url));
const skillsPath = fileURLToPath(new URL("../../skills", import.meta.url));
const promptsPath = fileURLToPath(new URL("../../prompts", import.meta.url));

/**
 * A skill index for hosts that cannot load skill directories from the command line (omp rejects `--skill`).
 * Agents can `read` the listed SKILL.md files on demand.
 */
export function skillIndex(dir = skillsPath): string {
	let names: string[];
	try { names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
	catch { return ""; }
	const lines = names.flatMap((name) => {
		const file = join(dir, name, "SKILL.md");
		try {
			const description = /^description:\s*(.+)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim() ?? "";
			return [`- ${file}${description ? ` — ${description.slice(0, 200)}` : ""}`];
		} catch { return []; }
	});
	return lines.length ? `## psi skills\nRead the matching SKILL.md with the read tool before doing that kind of work:\n`
		+ lines.join("\n") : "";
}

/** Resolve which host CLI dialect a binary speaks: explicit host, PSI_HOST, or an `omp` binary name. */
export function crewHost(opts: Pick<CrewOptions, "host" | "bin"> = {}): "pi" | "omp" {
	const host = opts.host ?? process.env.PSI_HOST;
	if (host === "omp" || host === "pi") return host;
	const bin = opts.bin ?? process.env.PSI_BIN ?? "";
	return /^omp(\.exe)?$/i.test(basename(bin)) ? "omp" : "pi";
}

// omp has no `ls` and may lack `find` (it rejects unknown or unavailable --tools names); `glob` covers both.
const OMP_TOOL_NAMES: Record<string, string> = { ls: "glob", find: "glob" };

/** A role's tool allowlist in the given host's vocabulary, without duplicates. */
export function roleTools(role: CrewTask["role"], host: "pi" | "omp" = "pi"): string[] {
	const tools = ROLE_TOOLS[role].map((tool) => host === "omp" ? OMP_TOOL_NAMES[tool] ?? tool : tool);
	return [...new Set(tools)];
}

/** Host argv for one role: psi extension, skills and prompts, the role's tool allowlist, then the message. */
export function crewArgs(task: CrewTask, opts: Pick<CrewOptions, "model" | "args" | "host" | "bin"> = {}): string[] {
	const message = taskMessage(task);
	const omp = crewHost(opts) === "omp";
	// pi loads skills/prompts by flag; omp has no such flags (unknown flags abort), so it gets a readable index.
	const resources = omp ? [] : ["--skill", skillsPath, "--prompt-template", promptsPath];
	const system = [ROLE_PROMPTS[task.role], ...(omp ? [skillIndex()] : []), message].filter(Boolean).join("\n\n");
	return ["-p", "--mode", "json", "--no-session", "-e", extensionPath, ...resources,
		"--tools", roleTools(task.role, omp ? "omp" : "pi").join(","), "--append-system-prompt", system,
		...(opts.model ? ["--model", opts.model] : []), ...(opts.args ?? []).filter((arg) => arg !== "--"), "--", message];
}

function snapshot(root: string): Map<string, string> {
	const files = new Map<string, string>();
	function walk(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			// Manim's cache (svgs, partial movies) is noise; psi_manim publishes finished videos into artifacts/.
			if (entry.isDirectory()) { if (relative(root, path).split(sep).join("/") !== "artifacts/media") walk(path); }
			else if (entry.isFile()) {
				const name = relative(root, path).split(sep).join("/");
				if (name === "crew/log.jsonl") continue;
				const stat = statSync(path);
				files.set(name, `${stat.mtimeMs}:${stat.size}`);
			}
		}
	}
	walk(root);
	return files;
}

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "psi_review_next", "psi_mastery"]);

/** Whether a role's allowlist can change files; read-only roles never own changes made by concurrent peers. */
export function roleCanWrite(role: CrewTask["role"]): boolean {
	return ROLE_TOOLS[role].some((tool) => !READ_ONLY_TOOLS.has(tool));
}

function assistantOutput(stdout: string): { output: string; error?: string } {
	let last: Record<string, unknown> | undefined;
	let fallback: Record<string, unknown> | undefined;
	for (const line of stdout.split("\n")) {
		try {
			const event = JSON.parse(line.replace(/\r$/, ""));
			if (event?.type === "message_end" && event.message?.role === "assistant") last = event.message;
			if (event?.type === "agent_end" && Array.isArray(event.messages)) {
				for (const message of event.messages) {
					if (message?.role === "assistant") fallback = message;
				}
			}
		} catch { /* Hosts can interleave diagnostic lines with events. */ }
	}
	const message = last ?? fallback;
	if (!message) return { output: stdout.trim() };
	const output = Array.isArray(message.content)
		? message.content.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text).join("") : "";
	const failed = message.stopReason === "error" || message.stopReason === "aborted";
	return { output, ...(failed ? { error: String(message.errorMessage ?? message.stopReason) } : {}) };
}

function taskMessage(task: CrewTask): string {
	return [task.instructions, `Topic: ${task.topic}`, `Concept ID: ${task.conceptId ?? "whole topic"}`,
		`Read these inputs relative to the topic directory: ${task.inputs?.join(", ") || "none"}.`,
		task.role === "critic" ? "Read only. Return your PASS/FIX checklist; do not save or modify files."
			: "Save deliverables using your permitted psi_ tools; report saved paths in your final message."].join("\n\n");
}

/** Run one isolated host agent, record changed files, and append its result to the topic log. */
export async function runCrewTask(task: CrewTask, opts: CrewOptions = {}): Promise<CrewResult> {
	const started = performance.now();
	const result: CrewResult = { role: task.role, ok: false, output: "", files: [], durationMs: 0 };
	let topicDir: string | undefined;
	let before: Map<string, string> | undefined;
	try {
		const store = opts.store ?? new PsiStore();
		topicDir = store.topicDir(task.topic);
		mkdirSync(topicDir, { recursive: true });
		before = snapshot(topicDir);
		if (opts.signal?.aborted) throw new Error("aborted");
		const bin = opts.bin ?? process.env.PSI_BIN ?? ((opts.host ?? process.env.PSI_HOST) === "omp" ? "omp" : "pi");
		const args = crewArgs(task, { ...opts, bin });
		const execution = await new Promise<{ stdout: string; error?: string }>((resolve) => {
			const child = spawn(bin, args, { cwd: topicDir, env: { ...process.env, PSI_HOME: store.root },
				stdio: ["ignore", "pipe", "pipe"], shell: false });
			let stdout = "";
			let stderr = "";
			let failure: string | undefined;
			let killTimer: ReturnType<typeof setTimeout> | undefined;
			const stop = (reason: string): void => {
				if (failure) return;
				failure = reason;
				child.kill("SIGTERM");
				killTimer = setTimeout(() => child.kill("SIGKILL"), 200);
			};
			const abort = (): void => stop("aborted");
			const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
			const timer = setTimeout(() => stop(`timeout after ${timeoutMs}ms`), timeoutMs);
			opts.signal?.addEventListener("abort", abort, { once: true });
			if (opts.signal?.aborted) abort();
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
			child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-2048); });
			child.on("error", (error) => { failure ??= error.message; });
			child.on("close", (code, signal) => {
				clearTimeout(timer);
				clearTimeout(killTimer);
				opts.signal?.removeEventListener("abort", abort);
				if (code !== 0) failure ??= `Host exited ${code ?? signal}: ${stderr.trim()}`;
				resolve({ stdout, error: failure });
			});
		});
		const parsed = assistantOutput(execution.stdout);
		result.output = parsed.output;
		const error = execution.error ?? parsed.error;
		if (error) result.error = error;
		result.ok = !error;
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
	}
	if (topicDir) {
		try {
			// Concurrent tasks share the topic directory, so a read-only role cannot be credited with peers' writes.
			if (before && roleCanWrite(task.role)) {
				result.files = [...snapshot(topicDir)].filter(([name, stamp]) => before.get(name) !== stamp)
					.map(([name]) => name).sort();
			}
		} catch (error) {
			result.ok = false;
			result.error ??= `File tracking failed: ${String(error)}`;
		}
	}
	result.durationMs = performance.now() - started;
	if (topicDir) {
		try {
			mkdirSync(join(topicDir, "crew"), { recursive: true });
			appendFileSync(join(topicDir, "crew", "log.jsonl"), `${JSON.stringify(result)}\n`);
		} catch (error) {
			result.ok = false;
			result.error = `Result logging failed: ${String(error)}`;
		}
	}
	return result;
}

/** Run a bounded worker pool and return results in the same order as the tasks. */
export async function runCrew(
	tasks: CrewTask[], opts: CrewOptions & { concurrency?: number } = {},
): Promise<CrewResult[]> {
	const requested = opts.concurrency ?? 3;
	const concurrency = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 3;
	const results = new Array<CrewResult>(tasks.length);
	let next = 0;
	async function worker(): Promise<void> {
		while (next < tasks.length) {
			const index = next++;
			results[index] = await runCrewTask(tasks[index], opts);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
	return results;
}

/** Build a lesson in strict intuition/story, visual, and quiz/critique phases. */
export async function buildLesson(topic: string, conceptId: string, opts: CrewOptions = {}): Promise<CrewResult[]> {
	const store = opts.store ?? new PsiStore();
	const options = { ...opts, store };
	const concept = store.readGraph(topic)?.concepts.find((item) => item.id === conceptId);
	const context = `Build a lesson for ${conceptId}.${concept ? ` ${concept.title}: ${concept.summary}` : ""}`;
	const task = (role: CrewTask["role"], instructions: string, inputs?: string[]): CrewTask =>
		({ role, topic, conceptId, instructions: `${context}\n${instructions}`, inputs });
	const [intuition, storyteller] = await Promise.all([
		runCrewTask(task("intuition", "Find the core visual intuition and discovery path."), options),
		runCrewTask(task("storyteller", "Write narrative beats and per-scene narration."), options),
	]);
	const dir = join(store.topicDir(topic), "crew");
	mkdirSync(dir, { recursive: true });
	const save = (result: CrewResult): void => {
		writeFileSync(join(dir, `${result.role}.md`), result.ok ? result.output
			: `FAILED: ${result.error ?? "unknown failure"}\n\n${result.output}`);
	};
	save(intuition);
	save(storyteller);
	const visualizer = await runCrewTask(task("visualizer", "Turn the briefs into saved visual artifacts.",
		["crew/intuition.md", "crew/storyteller.md"]), options);
	save(visualizer);
	const status = visualizer.ok ? "Review the saved visual output."
		: `Visualizer failed: ${visualizer.error}. `
				+ "Inspect the failure recorded in crew/visualizer.md and flag missing visuals.";
	const inputs = ["crew/visualizer.md", "crew/storyteller.md"];
	const [quizmaster, critic] = await Promise.all([
		runCrewTask(task("quizmaster", `Create retrieval checks. ${status}`, inputs), options),
		runCrewTask(task("critic", `Verify the lesson and return a PASS/FIX checklist. ${status}`, inputs), options),
	]);
	return [intuition, storyteller, visualizer, quizmaster, critic];
}
