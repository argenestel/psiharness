import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webToolNames } from "../extension/src/tool-policy.ts";

type JsonObject = Record<string, unknown>;

/** A single scripted tutor turn. */
export interface EvalTurn {
	kind: "teach" | "continue" | "show" | "challenge" | "wrong_guess" | "stuck" | "correct_answer" | "verify" | "answer" | "other";
	message?: string;
}

/** The supported answer-key shape. Keys may be flat or scoped by challenge id. */
export interface AnswerKey {
	correct?: string;
	wrong?: string;
}

/** A scenario file consumed by the eval runner. */
export interface EvalScenario {
	id: string;
	title: string;
	skillPack: string | { path: string; slug?: string };
	turns: EvalTurn[];
	expectations?: { subskills: string[]; notes: string };
	keys?: JsonObject | AnswerKey | string;
}

/** A validated scenario and its source pack. */
export interface LoadedScenario {
	scenario: EvalScenario;
	scenarioFile: string;
	packDir: string;
	slug: string;
	plan: JsonObject;
	challenges: JsonObject[];
	keys: unknown;
}

/** CLI-independent options for a single scenario run. */
export interface ScenarioRunOptions {
	model: string;
	outDir: string;
	codeExec?: boolean;
	keep?: boolean;
	pi?: string;
	timeoutMs?: number;
	handledWaitMs?: number;
	importTimeoutMs?: number;
	/** 1-based repeat index; with `repeats` > 1 the trace file gets a `.r<k>` suffix. */
	repeat?: number;
	repeats?: number;
	progress?: (line: string) => void;
	warn?: (line: string) => void;
}

/** One scenario's persisted result. */
export interface ScenarioResult {
	id: string;
	title: string;
	success: boolean;
	turns: number;
	completedTurns: number;
	toolCalls: number;
	durationMs: number;
	path: string;
	psiHome?: string;
	cwd?: string;
	errors: string[];
	repeat: number;
	model: string;
	startedAt: string;
	finishedAt: string;
	/** Answer turns (correct_answer / wrong_guess): answered from a key for the open challenge vs scripted fallback. */
	answers: { dynamic: number; fallback: number };
}

/** The challenge the learner currently faces, as last presented by psi_challenge or persisted in state.json. */
export interface OpenChallenge {
	id: string;
	skill?: string;
	format?: string;
	source: "widget" | "state";
}

/** Parsed command line for the eval CLI. */
export interface EvalCliOptions {
	scenarios: string[];
	model: string;
	out: string;
	codeExec: boolean;
	dryRun: boolean;
	list: boolean;
	keep: boolean;
	concurrency: number;
	repeat: number;
}

const DEFAULT_MODEL = "xai/grok-4.6";
const STDERR_LIMIT = 8 * 1024;
const MAX_RPC_LINE = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_HANDLED_WAIT_MS = 60_000;
const DEFAULT_IMPORT_TIMEOUT_MS = 60_000;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const TURN_KINDS = new Set(["teach", "continue", "show", "challenge", "wrong_guess", "stuck", "correct_answer", "verify", "answer", "other"]);
const CHALLENGE_KINDS = new Set(["quickfire", "predict", "debug", "apply", "explain", "build", "boss"]);

/** Root of the repository containing this runner. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const extensionFile = join(repoRoot, "extension", "src", "index.ts");
export const bundledSkills = join(repoRoot, "skills");
export const bundledPrompts = join(repoRoot, "prompts");
export const scenariosDir = join(repoRoot, "evals", "scenarios");

function object(value: unknown): value is JsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
	return value;
}

function slugify(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function relativeRepoPath(value: string): string {
	return relative(repoRoot, value).split("\\").join("/");
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function resolveFrom(base: string, value: string): string {
	if (isAbsolute(value)) return resolve(value);
	const fromBase = resolve(base, value);
	if (existsSync(fromBase)) return fromBase;
	return resolve(repoRoot, value);
}

function scenarioPackValue(scenario: JsonObject): string | { path: string; slug?: string } {
	const value = scenario.skillPack ?? scenario.pack;
	if (typeof value === "string") return value;
	if (object(value) && typeof value.path === "string") return {
		path: value.path,
		slug: typeof value.slug === "string" ? value.slug : undefined,
	};
	throw new Error("scenario.skillPack (or pack) must be a path or {path, slug}");
}

function normalizeTurn(value: unknown, index: number): EvalTurn {
	if (typeof value === "string") return { kind: "other", message: value };
	if (!object(value)) throw new Error(`turn ${index + 1} must be a string or object`);
	const rawKind = typeof value.kind === "string" ? value.kind : "other";
	if (!TURN_KINDS.has(rawKind)) throw new Error(`turn ${index + 1} has unsupported kind ${rawKind}`);
	const kind = rawKind as EvalTurn["kind"];
	if (!(["correct_answer", "wrong_guess"].includes(kind)) && typeof value.message !== "string") throw new Error(`turn ${index + 1} kind ${kind} requires message`);
	return { kind, ...(typeof value.message === "string" ? { message: value.message } : {}) };
}

/** Validate and normalize one scenario JSON value. */
export function validateScenario(value: unknown, file = "scenario.json"): EvalScenario {
	if (!object(value)) throw new Error(`${file} must contain an object`);
	const id = string(value.id ?? basename(file, ".json"), `${file}: id`);
	const title = string(value.title ?? id, `${file}: title`);
	const skillPack = scenarioPackValue(value);
	const rawTurns = value.turns ?? value.messages;
	if (!Array.isArray(rawTurns) || rawTurns.length === 0) throw new Error(`${file}: turns must be a non-empty array`);
	const turns = rawTurns.map((turn, index) => normalizeTurn(turn, index));
	const rawExpectations = value.expectations;
	if (!object(rawExpectations) || !Array.isArray(rawExpectations.subskills)
		|| rawExpectations.subskills.some((subskill) => typeof subskill !== "string")
		|| typeof rawExpectations.notes !== "string") throw new Error(`${file}: expectations requires subskills[] and notes`);
	return { id, title, skillPack, turns,
		expectations: { subskills: rawExpectations.subskills as string[], notes: rawExpectations.notes as string },
		...(value.keys !== undefined ? { keys: value.keys as JsonObject } : {}) };
}

/** Validate the pack files used by `psi import-skill`. */
export function validatePack(packDir: string): { plan: JsonObject; challenges: JsonObject[]; slug: string } {
	const planFile = join(packDir, "plan.json");
	const challengesFile = join(packDir, "challenges.json");
	if (!existsSync(planFile)) throw new Error(`Skill pack is missing plan.json: ${packDir}`);
	if (!existsSync(challengesFile)) throw new Error(`Skill pack is missing challenges.json: ${packDir}`);
	const plan = readJson(planFile);
	if (!object(plan)) throw new Error(`${planFile} must contain an object`);
	const skill = string(plan.skill, `${planFile}: skill`);
	const slug = slugify(skill);
	if (!slug) throw new Error(`${planFile}: skill does not produce a slug`);
	const challenges = readJson(challengesFile);
	if (!Array.isArray(challenges)) throw new Error(`${challengesFile} must contain an array`);
	const ids = new Set<string>();
	for (const [index, challenge] of challenges.entries()) {
		if (!object(challenge)) throw new Error(`${challengesFile}: challenge ${index + 1} must be an object`);
		const id = string(challenge.id, `${challengesFile}: challenge ${index + 1} id`);
		if (ids.has(id)) throw new Error(`${challengesFile}: duplicate challenge id ${id}`);
		ids.add(id);
		if (typeof challenge.kind !== "string" || !CHALLENGE_KINDS.has(challenge.kind)) throw new Error(`${challengesFile}: challenge ${id} has unsupported kind`);
		string(challenge.prompt, `${challengesFile}: challenge ${id} prompt`);
		if (challenge.hints !== undefined && (!Array.isArray(challenge.hints) || challenge.hints.some((hint) => typeof hint !== "string"))) {
			throw new Error(`${challengesFile}: challenge ${id} hints must be strings`);
		}
	}
	return { plan, challenges: challenges as JsonObject[], slug };
}

function validateKeyPair(value: JsonObject, file: string): void {
	for (const name of ["correct", "wrong"]) {
		if (value[name] !== undefined && typeof value[name] !== "string") throw new Error(`${file}: ${name} must be a string`);
	}
}

function validateKeys(value: unknown, file: string): unknown {
	if (value === undefined) return {};
	if (typeof value === "string") return value;
	if (!object(value) && !Array.isArray(value)) throw new Error(`${file} must contain an object or array`);
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			if (!object(item)) throw new Error(`${file}: key ${index + 1} must be an object`);
			string(item.challengeId ?? item.id, `${file}: key ${index + 1} challengeId`);
			validateKeyPair(item, `${file}: key ${index + 1}`);
		}
		return value;
	}
	if (value.kind !== undefined && value.kind !== "keys") throw new Error(`${file}: kind must be keys`);
	if (value.challenges !== undefined && !object(value.challenges)) throw new Error(`${file}: challenges must be an object`);
	if (value.challenges && object(value.challenges)) {
		for (const [id, pair] of Object.entries(value.challenges)) {
			if (!object(pair)) throw new Error(`${file}: challenge ${id} key must be an object`);
			validateKeyPair(pair, `${file}: challenge ${id}`);
		}
	} else if (value.correct !== undefined || value.wrong !== undefined) validateKeyPair(value, file);
	else {
		for (const [id, pair] of Object.entries(value)) {
			if (id === "kind" || id === "skill") continue;
			if (!object(pair)) throw new Error(`${file}: challenge ${id} key must be an object`);
			validateKeyPair(pair, `${file}: challenge ${id}`);
		}
	}
	return value;
}

function validateKeyIds(value: unknown, challengeIds: Set<string>, file: string): void {
	if (!object(value) || value.correct !== undefined || value.wrong !== undefined) return;
	const entries = object(value.challenges) ? Object.entries(value.challenges) : Object.entries(value);
	for (const [id] of entries) if (id !== "kind" && id !== "skill" && !challengeIds.has(id)) throw new Error(`${file}: unknown challenge id ${id}`);
}

/** Load and validate a scenario plus its pack and answer keys. */
export function loadScenario(file: string): LoadedScenario {
	const scenarioFile = resolve(file);
	const scenario = validateScenario(readJson(scenarioFile), scenarioFile);
	const packValue = scenario.skillPack;
	const packPath = typeof packValue === "string" ? packValue : packValue.path;
	const packDir = resolveFrom(dirname(scenarioFile), packPath);
	if (!existsSync(packDir)) throw new Error(`${scenarioFile}: skill pack not found: ${packDir}`);
	const pack = validatePack(packDir);
	let keys: unknown = scenario.keys;
	if (typeof keys === "string") keys = readJson(resolveFrom(dirname(scenarioFile), keys));
	if (keys === undefined && existsSync(join(packDir, "keys.json"))) keys = readJson(join(packDir, "keys.json"));
	if (keys === undefined) {
		for (const candidate of [join(dirname(scenarioFile), "..", "answer-keys", `${pack.slug}.json`), join(repoRoot, "evals", "answer-keys", `${pack.slug}.json`),
			join(dirname(scenarioFile), "..", "keys", `${pack.slug}.json`), join(repoRoot, "evals", "keys", `${pack.slug}.json`)]) {
			if (existsSync(candidate)) { keys = readJson(candidate); break; }
		}
	}
	keys = validateKeys(keys, `${scenarioFile}: keys`);
	validateKeyIds(keys, new Set(pack.challenges.map((challenge) => String(challenge.id))), `${scenarioFile}: keys`);
	const requestedSlug = typeof packValue === "object" ? packValue.slug : undefined;
	if (requestedSlug !== undefined && slugify(requestedSlug) !== pack.slug) throw new Error(`${scenarioFile}: pack slug ${requestedSlug} does not match plan skill ${pack.slug}`);
	return { scenario, scenarioFile, packDir, slug: pack.slug, plan: pack.plan, challenges: pack.challenges, keys };
}

/** Find scenario JSON files in stable lexical order. */
export function listScenarioFiles(directory = scenariosDir): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => join(directory, entry.name)).sort((a, b) => basename(a).localeCompare(basename(b)));
}

/** Resolve `--scenario` values as ids, filenames, paths, or comma-separated groups. */
export function selectScenarioFiles(values: string[] = [], directory = scenariosDir): string[] {
	if (!values.length) return listScenarioFiles(directory);
	const all = listScenarioFiles(directory), byId = new Map<string, string>();
	for (const file of all) {
		byId.set(basename(file, ".json"), file);
		try { byId.set(validateScenario(readJson(file), file).id, file); } catch { /* selected validation reports the useful error */ }
	}
	const selected: string[] = [];
	for (const raw of values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean)) {
		const candidate = isAbsolute(raw) || raw.includes("/") || raw.endsWith(".json") ? resolveFrom(directory, raw) : byId.get(raw);
		if (!candidate || !existsSync(candidate)) throw new Error(`Scenario not found: ${raw}`);
		if (!selected.includes(candidate)) selected.push(candidate);
	}
	return selected.sort((a, b) => basename(a).localeCompare(basename(b)));
}

/** Environment for eval children, matching the studio child policy and read root. */
export function evalAgentEnv(home: string, codeExec = false, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...source, PSI_HOME: home, PSI_WEB_READ_ROOT: home };
	if (codeExec) env.PSI_CODE_EXEC = "1";
	else delete env.PSI_CODE_EXEC;
	return env;
}

/** RPC argv for one eval child; no session path is supplied so every run is isolated. */
export function evalAgentArgs(slug: string, model: string, codeExec = false): string[] {
	const effectiveEnv: NodeJS.ProcessEnv = { ...process.env };
	if (codeExec) effectiveEnv.PSI_CODE_EXEC = "1";
	else delete effectiveEnv.PSI_CODE_EXEC;
	const tools = webToolNames(effectiveEnv).join(",");
	if (!tools) throw new Error("No permitted web tools are available");
	return ["--mode", "rpc", "--no-session", "-e", extensionFile, "--skill", bundledSkills, "--prompt-template", bundledPrompts,
		"--no-mcp", "--psi-tutor=true", "--psi-skill", slug, "--tools", tools, "--model", model];
}

/** Resolve PSI_EVAL_PI, invoking Node explicitly for TypeScript/ES module fake hosts. */
export function evalPiCommand(value = process.env.PSI_EVAL_PI ?? "pi"): { command: string; prefix: string[] } {
	const resolved = /[/\\]/.test(value) ? resolve(value) : value;
	return /\.(?:ts|mjs)$/i.test(resolved) ? { command: process.execPath, prefix: [resolved] } : { command: resolved, prefix: [] };
}

/** Generate a compact, filesystem-safe scenario output directory name. */
export function safeOutputName(id: string): string {
	const result = id.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return result || "scenario";
}

/** Trace/summary basename for one scenario run; repeats beyond a single run get a `.r<k>` suffix. */
export function runFileStem(id: string, repeat = 1, repeats = 1): string {
	return repeats > 1 ? `${safeOutputName(id)}.r${repeat}` : safeOutputName(id);
}

/**
 * Tracks the open challenge from the RPC stream: the latest psi_challenge widget (tool_execution_end
 * details.widget) stays open until a successful psi_attempt for it; state.json is the fallback.
 */
export class ChallengeTracker {
	private latest?: OpenChallenge;
	private readonly attempted = new Set<string>();
	private readonly startArgs = new Map<string, JsonObject>();

	/** Feed one raw pi record. */
	observe(record: JsonObject): void {
		const callId = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
		if (record.type === "tool_execution_start" && callId && object(record.args)) this.startArgs.set(callId, record.args);
		if (record.type !== "tool_execution_end" || record.isError === true) return;
		const result = object(record.result) ? record.result : {};
		const details = object(result.details) ? result.details : {};
		if (Array.isArray(details.errors) && details.errors.length) return;
		if (record.toolName === "psi_challenge") {
			const widget = object(details.widget) ? details.widget : undefined;
			if (widget && widget.type === "challenge" && typeof widget.id === "string") {
				this.latest = { id: widget.id, source: "widget",
					...(typeof widget.skill === "string" ? { skill: widget.skill } : {}),
					...(typeof widget.format === "string" ? { format: widget.format } : {}) };
				this.attempted.delete(widget.id);
			}
		}
		if (record.toolName === "psi_attempt") {
			const args = { ...(callId ? this.startArgs.get(callId) : undefined), ...(object(record.args) ? record.args : {}) };
			const id = typeof args.challengeId === "string" ? args.challengeId : typeof args.id === "string" ? args.id
				: typeof details.challengeId === "string" ? details.challengeId : this.latest?.id;
			if (id) this.attempted.add(id);
		}
	}

	/** The challenge still awaiting an answer, if any. */
	open(state: { challengeId?: string; activeSkill?: string }): OpenChallenge | undefined {
		if (this.latest && !this.attempted.has(this.latest.id)) return this.latest;
		if (state.challengeId && !this.attempted.has(state.challengeId)) {
			return { id: state.challengeId, source: "state", ...(state.activeSkill ? { skill: state.activeSkill } : {}) };
		}
		return undefined;
	}
}

function appendLine(file: string, value: unknown): void {
	writeFileSync(file, `${JSON.stringify(value)}\n`, { flag: "a" });
}

function now(): number { return Date.now(); }

interface ExitInfo { code: number | null; signal: NodeJS.Signals | null; stderr: string }

interface ProcessOptions {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	onRecord: (record: JsonObject) => void;
	onExit: (exit: ExitInfo) => void;
	onDiagnostic: (message: string) => void;
}

/** Byte-accurate RPC child transport. It intentionally does not use readline. */
export class RpcProcess {
	readonly child: ChildProcessWithoutNullStreams;
	private pending = Buffer.alloc(0);
	private stderr = "";
	private closed = false;
	private closePromise: Promise<ExitInfo>;
	private readonly onRecord: (record: JsonObject) => void;
	private readonly onDiagnostic: (message: string) => void;

	constructor(options: ProcessOptions) {
		const spawnOptions: SpawnOptionsWithoutStdio = { cwd: options.cwd, env: options.env, shell: false };
		this.child = spawn(options.command, options.args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"] });
		this.onRecord = options.onRecord;
		this.onDiagnostic = options.onDiagnostic;
		this.closePromise = new Promise<ExitInfo>((resolveExit) => {
			this.child.stdout.on("data", (chunk: Buffer | string) => this.consume(Buffer.from(chunk)));
			this.child.stderr.on("data", (chunk: Buffer | string) => { this.stderr = (this.stderr + Buffer.from(chunk).toString("utf8")).slice(-STDERR_LIMIT); });
			this.child.on("error", (error) => this.onDiagnostic(`spawn: ${error.message}`));
			this.child.once("close", (code, signal) => {
				this.closed = true;
				const info = { code, signal, stderr: this.stderr };
				options.onExit(info);
				resolveExit(info);
			});
		});
	}

	private consume(chunk: Buffer): void {
		this.pending = Buffer.concat([this.pending, chunk]);
		let newline: number;
		while ((newline = this.pending.indexOf(10)) !== -1) {
			let line = this.pending.subarray(0, newline);
			this.pending = this.pending.subarray(newline + 1);
			if (line.at(-1) === 13) line = line.subarray(0, -1);
			if (!line.length) continue;
			if (line.length > MAX_RPC_LINE) { this.onDiagnostic("RPC line exceeds 64 MiB"); continue; }
			try {
				const value = JSON.parse(line.toString("utf8"));
				if (object(value)) this.onRecord(value);
				else this.onDiagnostic("RPC record is not an object");
			} catch (error) { this.onDiagnostic(`invalid RPC JSON: ${error instanceof Error ? error.message : String(error)}`); }
		}
		if (this.pending.length > MAX_RPC_LINE) { this.pending = Buffer.alloc(0); this.onDiagnostic("RPC unterminated line exceeds 64 MiB"); }
	}

	/** Write one command with LF framing, honoring stdin backpressure. */
	async send(command: JsonObject): Promise<void> {
		if (this.closed || this.child.stdin.destroyed) throw new Error("RPC child is closed");
		const line = `${JSON.stringify(command)}\n`;
		if (this.child.stdin.write(line)) return;
		await new Promise<void>((resolveWrite, rejectWrite) => {
			const onDrain = () => { cleanup(); resolveWrite(); };
			const onError = (error: Error) => { cleanup(); rejectWrite(error); };
			const cleanup = () => { this.child.stdin.off("drain", onDrain); this.child.stdin.off("error", onError); };
			this.child.stdin.once("drain", onDrain);
			this.child.stdin.once("error", onError);
		});
	}

	/** Wait for process shutdown, killing after the bounded grace period. */
	async close(graceMs = 5_000): Promise<ExitInfo> { if (!this.closed) { try { this.child.stdin.end(); } catch { /* already closed */ } } return this.waitOrKill(graceMs); }

	/** Abort a run and wait briefly for the child to exit. */
	async sendAbort(): Promise<void> {
		if (!this.closed) await this.send({ type: "abort", id: `abort-${randomUUID()}` });
	}

	/** Abort a run and wait briefly for the child to exit. */
	async abort(graceMs = 5_000): Promise<ExitInfo> {
		try { await this.sendAbort(); } catch { /* child may have exited */ }
		return this.waitOrKill(graceMs);
	}

	private async waitOrKill(graceMs: number): Promise<ExitInfo> {
		if (this.closed) return this.closePromise;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<ExitInfo>((resolveWait) => {
			timer = setTimeout(() => {
				try { this.child.kill("SIGTERM"); } catch { /* gone */ }
				const hard = setTimeout(() => { try { this.child.kill("SIGKILL"); } catch { /* gone */ } }, 500);
				hard.unref();
				void this.closePromise.then(resolveWait);
			}, graceMs);
			timer.unref();
		});
		const result = await Promise.race([this.closePromise, timeout]);
		if (timer) clearTimeout(timer);
		return result;
	}
}

interface TurnState {
	turn: number;
	attempt: number;
	commandId: string;
	started: boolean;
	settled: boolean;
	settledRecord?: JsonObject;
	response?: JsonObject;
	settledAt?: number;
	aborted: boolean;
	timedOut?: boolean;
	retryable: boolean;
	modelError?: string;
	status?: string;
	errors: string[];
	exits: JsonObject[];
	toolCalls: number;
	resolve: () => void;
}

function isAssistantMessage(message: unknown): message is JsonObject { return object(message) && message.role === "assistant"; }

function stateAfterSettlement(home: string, skill: string): { challengeId?: string; activeSkill: string } {
	let state: unknown;
	try { state = readJson(join(home, "state.json")); } catch { state = undefined; }
	let challengeId: string | undefined, activeSkill: string | undefined;
	if (object(state)) {
		if (typeof state.challengeId === "string") challengeId = state.challengeId;
		if (object(state.openChallenge) && typeof state.openChallenge.id === "string") challengeId = state.openChallenge.id;
		if (typeof state.activeSkill === "string") activeSkill = state.activeSkill;
	}
	return { ...(challengeId ? { challengeId } : {}), activeSkill: activeSkill ?? skill };
}

function keyFor(keys: unknown, challengeId: string | undefined, name: "correct" | "wrong"): string | undefined {
	if (!challengeId) return undefined;
	const candidates: unknown[] = [];
	if (Array.isArray(keys)) {
		const item = keys.find((entry) => object(entry) && (entry.challengeId === challengeId || entry.id === challengeId));
		if (item) candidates.push(item);
	} else if (object(keys)) {
		if (object(keys.challenges) && object(keys.challenges[challengeId])) candidates.push(keys.challenges[challengeId]);
		if (object(keys[challengeId])) candidates.push(keys[challengeId]);
		candidates.push(keys);
	}
	for (const candidate of candidates) if (object(candidate) && typeof candidate[name] === "string") return candidate[name];
	return undefined;
}

function fallbackMessage(turn: EvalTurn): string {
	return turn.message ?? (turn.kind === "correct_answer" ? "My answer is the correct answer." : "My guess is wrong.");
}

function scenarioKeyString(keys: unknown): unknown {
	if (typeof keys === "string") { try { return JSON.parse(keys); } catch { return keys; } }
	return keys;
}

async function runImport(packDir: string, home: string, cwd: string, timeoutMs: number): Promise<{ ok: boolean; stderr: string; stdout: string; error?: string }> {
	const cli = join(repoRoot, "cli", "src", "psi.ts"), env = evalAgentEnv(home, false);
	return new Promise((done) => {
		const child = spawn(process.execPath, [cli, "import-skill", packDir], { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "", stderr = "", finished = false;
		const finish = (result: { ok: boolean; stderr: string; stdout: string; error?: string }) => { if (!finished) { finished = true; clearTimeout(timer); done(result); } };
		child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
		child.stdout.on("data", (value: string) => { stdout = (stdout + value).slice(-STDERR_LIMIT); });
		child.stderr.on("data", (value: string) => { stderr = (stderr + value).slice(-STDERR_LIMIT); });
		child.once("error", (error) => finish({ ok: false, stdout, stderr, error: error.message }));
		child.once("close", (code, signal) => finish({ ok: code === 0, stdout, stderr, error: code === 0 ? undefined : `import exited ${code ?? signal ?? "unknown"}` }));
		const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* gone */ } finish({ ok: false, stdout, stderr, error: `import timed out after ${timeoutMs}ms` }); }, timeoutMs);
		timer.unref();
	});
}

/** Execute one validated scenario and persist its wrapped RPC trace. */
export async function runScenario(loaded: LoadedScenario, options: ScenarioRunOptions): Promise<ScenarioResult> {
	const startedAt = new Date().toISOString();
	const scenarioDir = options.outDir;
	mkdirSync(scenarioDir, { recursive: true });
	const repeat = options.repeat ?? 1, repeats = Math.max(options.repeats ?? 1, repeat);
	const eventsFile = join(scenarioDir, `${runFileStem(loaded.scenario.id, repeat, repeats)}.jsonl`);
	if (existsSync(eventsFile)) rmSync(eventsFile);
	const tracker = new ChallengeTracker(), answers = { dynamic: 0, fallback: 0 };
	const home = mkdtempSync(join(tmpdir(), "psi-eval-home-")), cwd = mkdtempSync(join(tmpdir(), "psi-eval-cwd-"));
	const warnings: string[] = [], errors: string[] = [];
	const warn = options.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
	const log = (turn: number | null, attempt: number, record: JsonObject): void => appendLine(eventsFile, { turn, attempt, at: now(), record });
	const harness = (record: JsonObject, turn: number | null = null, attempt = 0): void => log(turn, attempt, record);
	harness({ type: "harness_meta", id: loaded.scenario.id, scenarioId: loaded.scenario.id, title: loaded.scenario.title,
		skillPack: relativeRepoPath(loaded.packDir), skillPackSlug: loaded.slug,
		model: options.model, startedAt, PSI_HOME: home, cwd, repeat, repeats,
		turns: loaded.scenario.turns.map((turn, index) => ({ turn: index + 1, kind: turn.kind })) });
	let processHandle: RpcProcess | undefined, current: TurnState | undefined, childExit: ExitInfo | undefined;
	let attemptNumber = 0, totalTools = 0;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS, handledWaitMs = options.handledWaitMs ?? DEFAULT_HANDLED_WAIT_MS;
	const importResult = await runImport(loaded.packDir, home, cwd, options.importTimeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS);
	if (!importResult.ok) {
		const message = `skill pack import failed: ${importResult.error ?? "unknown error"}${importResult.stderr ? `: ${importResult.stderr}` : ""}`;
		errors.push(message); harness({ type: "harness_import", ok: false, error: message });
		const result: ScenarioResult = { id: loaded.scenario.id, title: loaded.scenario.title, success: false, turns: loaded.scenario.turns.length,
			completedTurns: 0, toolCalls: 0, durationMs: now() - Date.parse(startedAt), path: eventsFile,
			...(options.keep ? { psiHome: home, cwd } : {}), errors, repeat, model: options.model, startedAt,
			finishedAt: new Date().toISOString(), answers };
		if (!options.keep) { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); }
		return result;
	}
	harness({ type: "harness_import", ok: true, stdout: importResult.stdout });

	const handledTimers = new Map<number, ReturnType<typeof setTimeout>>();
	let finishTurn: (state: TurnState, status: string, aborted: boolean) => void = () => {};
	const maybeFinishSettled = (state: TurnState): void => {
		if (!state.settled && state.settledRecord) finishTurn(state, state.settledRecord.aborted === true ? "aborted" : "settled", state.settledRecord.aborted === true);
	};
	const scheduleHandledWait = (state: TurnState): void => {
		if (handledTimers.has(state.turn)) return;
		const timer = setTimeout(() => { handledTimers.delete(state.turn); if (!state.settled) finishTurn(state, "handled", false); }, handledWaitMs);
		timer.unref(); handledTimers.set(state.turn, timer);
	};
	const observeAssistantMessage = (message: JsonObject): void => {
		const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
		const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
		if (current && (stopReason === "error" || errorMessage)) {
			current.retryable = true;
			current.modelError = errorMessage ?? "assistant model error";
		}
	};
	const spawnChild = (): RpcProcess => {
		const pi = evalPiCommand(options.pi), args = [...pi.prefix, ...evalAgentArgs(loaded.slug, options.model, options.codeExec)];
		childExit = undefined;
		return new RpcProcess({ command: pi.command, args, cwd, env: evalAgentEnv(home, options.codeExec),
			onDiagnostic: (message) => { if (current) current.errors.push(message); harness({ type: "harness_diagnostic", message }, current?.turn ?? null, current?.attempt ?? attemptNumber); },
			onExit: (exit) => {
				childExit = exit;
				if (current && !current.settled) current.exits.push({ code: exit.code, signal: exit.signal, stderr: exit.stderr });
				harness({ type: "harness_exit", code: exit.code, signal: exit.signal, stderr: exit.stderr }, current?.turn ?? null, current?.attempt ?? attemptNumber);
				if (current && !current.settled) {
					current.retryable = true;
					finishTurn(current, "child_exit", false);
				}
			},
			onRecord: (record) => {
				const turn = current?.turn ?? null, attempt = current?.attempt ?? attemptNumber;
				log(turn, attempt, record);
				tracker.observe(record);
				if (record.type === "tool_execution_start" || record.type === "toolCall") { totalTools++; if (current) current.toolCalls++; }
				if (record.type === "extension_ui_request" && typeof record.id === "string" && DIALOG_METHODS.has(String(record.method))) {
					const method = String(record.method);
					void processHandle?.send({ type: "extension_ui_response", id: record.id, cancelled: true }).then(() => harness({ type: "harness_ui_auto_cancel", id: record.id, method, cancelled: true }, turn, attempt)).catch((error: unknown) => harness({ type: "harness_ui_auto_cancel", id: record.id, method, cancelled: true, error: error instanceof Error ? error.message : String(error) }, turn, attempt));
				}
				if (record.type === "response" && record.command === "prompt" && current && (!record.id || record.id === current.commandId)) {
					current.response = record;
					const disposition = object(record.data) && typeof record.data.disposition === "string" ? record.data.disposition : undefined;
					if (record.success === false) finishTurn(current, "response_error", false);
					else if (disposition === "handled") { if (current.settledRecord) maybeFinishSettled(current); else scheduleHandledWait(current); }
					else if (current.settledRecord) finishTurn(current, "settled", !!current.settledRecord.aborted);
				}
				if (record.type === "agent_start" && current) {
					current.started = true;
					const timer = handledTimers.get(current.turn);
					if (timer) clearTimeout(timer);
					handledTimers.delete(current.turn);
					if (current.response && object(current.response.data) && current.response.data.disposition === "handled") maybeFinishSettled(current);
				}
				if (record.type === "auto_retry_end" && record.success === false && current) {
					current.retryable = true;
					harness({ type: "harness_retry_end", success: false, reason: "auto_retry", error: record.error }, turn, attempt);
				}
				if (record.type === "agent_settled" && current) { current.settledRecord = record; current.aborted = record.aborted === true; if (current.response) finishTurn(current, current.aborted ? "aborted" : current.modelError ? "model_error" : "settled", current.aborted); }
				if (record.type === "message_end" && isAssistantMessage(record.message)) observeAssistantMessage(record.message);
				if (record.type === "agent_end" && Array.isArray(record.messages)) for (const message of record.messages) if (isAssistantMessage(message)) observeAssistantMessage(message);
			},
		});
	};
	finishTurn = (state, status, aborted) => {
		if (state.settled) return;
		if (state.timedOut) status = "timeout";
		state.settled = true; state.status = status; state.aborted = aborted; state.settledAt = now();
		const timer = handledTimers.get(state.turn); if (timer) clearTimeout(timer); handledTimers.delete(state.turn);
		if (status === "timeout") state.errors.push(`turn timed out after ${timeoutMs}ms`);
		if (state.modelError && !state.errors.includes(state.modelError)) state.errors.push(state.modelError);
		harness({ type: "harness_turn_settled", turn: state.turn, attempt: state.attempt, settledAt: state.settledAt, aborted,
			status, ...(state.errors.length ? { errors: state.errors } : {}), ...(state.exits.length ? { exits: state.exits } : {}) }, state.turn, state.attempt);
		const persisted = stateAfterSettlement(home, loaded.slug);
		harness({ type: "harness_state", turn: state.turn, challengeId: persisted.challengeId, skill: persisted.activeSkill, activeSkill: persisted.activeSkill }, state.turn, state.attempt);
		state.resolve();
	};

	const sendTurn = async (turn: EvalTurn, turnIndex: number, message: string, attempt: number): Promise<{ state: TurnState; childExited: boolean }> => {
		const commandId = `prompt-${loaded.scenario.id}-${turnIndex + 1}-${attempt}-${randomUUID()}`, started = now();
		let resolveTurn!: () => void;
		const promise = new Promise<void>((resolvePromise) => { resolveTurn = resolvePromise; });
		const turnState: TurnState = { turn: turnIndex + 1, attempt, commandId, started: false, settled: false, aborted: false, retryable: false, errors: [], exits: [], toolCalls: 0, resolve: resolveTurn };
		current = turnState;
		harness({ type: "harness_turn_sent", turn: turnIndex + 1, attempt, kind: turn.kind, message, sentAt: started, commandId }, turnIndex + 1, attempt);
		harness({ type: "harness_message", turn: turnIndex + 1, attempt, message, sentAt: started, commandId }, turnIndex + 1, attempt);
		try { await processHandle!.send({ id: commandId, type: "prompt", message }); }
		catch (error) { turnState.errors.push(error instanceof Error ? error.message : String(error)); finishTurn(turnState, "child_exit", false); }
		const overall = setTimeout(() => {
			if (turnState.settled) return;
			turnState.timedOut = true; turnState.retryable = false; turnState.aborted = true;
			harness({ type: "harness_timeout", turn: turnIndex + 1, attempt, timeoutMs }, turnIndex + 1, attempt);
			void processHandle?.sendAbort().catch(() => {}).finally(() => finishTurn(turnState, "timeout", true));
		}, timeoutMs);
		overall.unref();
		await promise;
		clearTimeout(overall); current = undefined;
		const elapsed = ((turnState.settledAt ?? now()) - started) / 1000;
		options.progress?.(`scenario=${loaded.scenario.id} turn=${turnIndex + 1}/${loaded.scenario.turns.length} attempt=${attempt} seconds=${elapsed.toFixed(1)} tools=${turnState.toolCalls}`);
		return { state: turnState, childExited: !!childExit && turnState.status === "child_exit" };
	};

	let completedTurns = 0;
	try {
		processHandle = spawnChild();
		for (let index = 0; index < loaded.scenario.turns.length; index++) {
			const turn = loaded.scenario.turns[index], persisted = stateAfterSettlement(home, loaded.slug);
			let message = turn.message;
			if (turn.kind === "correct_answer" || turn.kind === "wrong_guess") {
				const open = tracker.open(persisted), which = turn.kind === "correct_answer" ? "correct" : "wrong";
				const key = keyFor(scenarioKeyString(loaded.keys), open?.id, which);
				if (key !== undefined) { message = key; answers.dynamic++; }
				else {
					message = fallbackMessage(turn); answers.fallback++;
					const warning = `scenario ${loaded.scenario.id} turn ${index + 1}: no ${turn.kind} key for open challenge ${open?.id ?? "none"}; using fallback message`;
					warnings.push(warning); warn(warning); harness({ type: "harness_warning", message: warning }, index + 1, 0);
				}
				harness({ type: "harness_answer", turn: index + 1, kind: turn.kind, mode: key !== undefined ? "dynamic" : "fallback",
					challengeId: open?.id, openFrom: open?.source, format: open?.format }, index + 1, 0);
			}
			if (message === undefined) throw new Error(`turn ${index + 1} has no message`);
			let attemptResult: { state: TurnState; childExited: boolean } | undefined;
			for (let attempt = 1; attempt <= 2; attempt++) {
				if (attempt > 1) {
					harness({ type: "harness_retry_start", turn: index + 1, attempt, reason: attemptResult?.state.modelError ? "model_error" : "child_exit" }, index + 1, attempt);
					if (attemptResult?.childExited) processHandle = spawnChild();
				}
				attemptResult = await sendTurn(turn, index, message, attempt);
				if (!attemptResult.state.retryable) break;
				harness({ type: "harness_retry_end", turn: index + 1, attempt, success: false,
					reason: attemptResult.state.modelError ? "model_error" : attemptResult.state.status ?? "child_exit",
					error: attemptResult.state.modelError }, index + 1, attempt);
			}
			if (attemptResult) {
				if (attemptResult.state.retryable || attemptResult.state.status === "timeout" || attemptResult.state.status === "model_error" || attemptResult.state.status === "child_exit") {
					if (attemptResult.state.errors.length) errors.push(...attemptResult.state.errors.map((error) => `turn ${index + 1}: ${error}`));
				}
				if (attemptResult.state.status === "settled" || attemptResult.state.status === "handled" || attemptResult.state.status === "aborted") completedTurns++;
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error); errors.push(message); harness({ type: "harness_error", error: message }, current?.turn ?? null, current?.attempt ?? attemptNumber);
	} finally {
		if (processHandle) { try { await processHandle.sendAbort(); } catch { /* already exited */ } try { await processHandle.close(5_000); } catch { /* already exited */ } }
	}
	const result: ScenarioResult = { id: loaded.scenario.id, title: loaded.scenario.title, success: completedTurns === loaded.scenario.turns.length && errors.length === 0,
		turns: loaded.scenario.turns.length, completedTurns, toolCalls: totalTools, durationMs: now() - Date.parse(startedAt), path: eventsFile,
		...(options.keep ? { psiHome: home, cwd } : {}), errors, repeat, model: options.model, startedAt, finishedAt: new Date().toISOString(), answers };
	if (!options.keep) { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); }
	return result;
}

/** Parse eval CLI flags. Unknown flags are rejected to prevent accidental broad runs. */
export function parseEvalArgs(argv: string[]): EvalCliOptions {
	const scenarios: string[] = [];
	let model = process.env.PSI_EVAL_MODEL ?? DEFAULT_MODEL, out = "", codeExec = false, dryRun = false, list = false, keep = false;
	let concurrency = 1, repeat = 1;
	const positive = (name: string, value: string | undefined): number => {
		const parsed = Number(value);
		if (!value || !Number.isInteger(parsed) || parsed < 1 || parsed > 64) throw new Error(`${name} requires an integer from 1 to 64`);
		return parsed;
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--scenario") { if (!argv[i + 1]) throw new Error("--scenario requires a value"); scenarios.push(argv[++i]); }
		else if (arg.startsWith("--scenario=")) scenarios.push(arg.slice("--scenario=".length));
		else if (arg === "--model") model = argv[++i] ?? (() => { throw new Error("--model requires a value"); })();
		else if (arg.startsWith("--model=")) model = arg.slice("--model=".length);
		else if (arg === "--out") out = argv[++i] ?? (() => { throw new Error("--out requires a value"); })();
		else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
		else if (arg === "--concurrency") concurrency = positive("--concurrency", argv[++i]);
		else if (arg.startsWith("--concurrency=")) concurrency = positive("--concurrency", arg.slice("--concurrency=".length));
		else if (arg === "--repeat") repeat = positive("--repeat", argv[++i]);
		else if (arg.startsWith("--repeat=")) repeat = positive("--repeat", arg.slice("--repeat=".length));
		else if (arg === "--code-exec") codeExec = true;
		else if (arg === "--dry-run") dryRun = true;
		else if (arg === "--list") list = true;
		else if (arg === "--keep") keep = true;
		else if (arg === "-h" || arg === "--help") throw new Error("help");
		else throw new Error(`Unknown option: ${arg}`);
	}
	if (!out) { const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-"); out = join(repoRoot, "evals", "results", stamp); }
	return { scenarios, model: string(model, "model"), out: resolve(out), codeExec, dryRun, list, keep, concurrency, repeat };
}

/** Compact CLI usage text. */
export const evalHelp = `Usage: node evals/run.ts [--scenario id[,id...]] [--model provider/model] [--out dir]
  --concurrency N  run up to N scenario sessions at once (default 1)
  --repeat K       run every selected scenario K times; the report shows mean ± range per check
  --code-exec  opt in to execution tools
  --dry-run     validate and print selected scenarios without launching pi
  --list        list available scenarios
  --keep        preserve per-scenario PSI_HOME and cwd for inspection`;

/** Build the score summary written at the end of a run. */
export function scoreResults(results: ScenarioResult[]): JsonObject {
	const passed = results.filter((result) => result.success).length;
	return { scenarios: results.length, passed, failed: results.length - passed, passRate: results.length ? passed / results.length : 1,
		turns: results.reduce((sum, result) => sum + result.turns, 0), completedTurns: results.reduce((sum, result) => sum + result.completedTurns, 0),
		toolCalls: results.reduce((sum, result) => sum + result.toolCalls, 0),
		dynamicAnswers: results.reduce((sum, result) => sum + (result.answers?.dynamic ?? 0), 0),
		fallbackAnswers: results.reduce((sum, result) => sum + (result.answers?.fallback ?? 0), 0) };
}

