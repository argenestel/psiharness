import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { skillIndex } from "../../crew/src/runner.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
type RecordData = Record<string, unknown>;
type Event = RecordData & { seq: number };
interface Chat {
	id: string; file: string; model?: string; skill?: string; topic?: string;
	child?: ChildProcessWithoutNullStreams; running: boolean; lastOutput: number;
	/** Sequence numbers start above a time-based base so a reconnecting tab from a previous server is detectable. */
	base: number; seq: number; historyEnd: number; loaded: boolean;
	records: Event[]; subscribers: Set<ServerResponse>; timer?: ReturnType<typeof setTimeout>;
	waiters: Map<string, (record: RecordData | undefined) => void>;
}

/** Host settings; milliseconds allow deterministic idle lifecycle tests. */
export interface AgentOptions { bin?: string; idleMs?: number; host?: "pi" | "omp" }
/** Per-chat launch options from POST /api/chat. */
export interface ChatOptions { model?: string; skill?: string; topic?: string }

/** Non-durable records kept for reconnect replay; conversation records are never evicted. */
const LIVE_LIMIT = 2000;
const MAX_LINE = 64 * 1024 * 1024;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Answer-key fields of psi_challenge arguments; the learner sees the card, never the key. */
const SECRET_ARGS = ["expected", "acceptable", "rubric"];

function failure(status: number, message: string): Error & { status: number } {
	return Object.assign(new Error(message), { status });
}
function isObject(value: unknown): value is RecordData {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Remove psi_challenge answer keys from tool calls anywhere in a record (messages, tool events, history). */
export function redactRecord<T>(value: T, depth = 0): T {
	if (depth > 16 || !value || typeof value !== "object") return value;
	if (Array.isArray(value)) { for (const item of value) redactRecord(item, depth + 1); return value; }
	const object = value as RecordData;
	for (const [nameKey, argsKey] of [["name", "arguments"], ["toolName", "args"]]) {
		const args = object[argsKey];
		if (object[nameKey] === "psi_challenge" && isObject(args)) for (const key of SECRET_ARGS) delete args[key];
	}
	for (const item of Object.values(object)) redactRecord(item, depth + 1);
	return value;
}

/** psi tool names registered by the extension, for hosts whose --tools rejects patterns (omp). */
export function psiToolNames(dir = join(repo, "extension/src")): string[] {
	const names = new Set<string>();
	const walk = (folder: string) => {
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			const path = join(folder, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts")) {
				for (const match of readFileSync(path, "utf8").matchAll(/\bname:\s*"(psi_[a-z0-9_]+)"/g)) names.add(match[1]);
			}
		}
	};
	try { walk(dir); } catch { /* Fall back to the pattern below. */ }
	return [...names].sort();
}

/** Argument vector for one chat's RPC host process. */
export function agentArgs(opts: { omp: boolean; directory: string; file: string } & ChatOptions): string[] {
	const tools = process.env.PSI_WEB_TOOLS
		?? (opts.omp ? ["read", ...psiToolNames()].join(",") || "read" : "read,psi_*");
	// omp rejects unknown flags (no --skill/--prompt-template/--no-mcp), so it gets a readable skill index instead.
	const resources = opts.omp
		? ["--append-system-prompt", skillIndex(join(repo, "skills"))]
		: ["--skill", join(repo, "skills"), "--prompt-template", join(repo, "prompts"), "--no-mcp"];
	return ["--mode", "rpc", "--session-dir", opts.directory, "--session", opts.file,
		"-e", join(repo, "extension/src/index.ts"), ...resources, "--psi-tutor=true", "--tools", tools,
		...(opts.skill ? ["--psi-skill", opts.skill] : []), ...(opts.topic ? ["--psi-topic", opts.topic] : []),
		...(opts.model ? ["--model", opts.model] : [])];
}

/** Read JSONL lines from the start of a file, stopping early when `visit` returns true. */
function scanLines(file: string, visit: (record: RecordData) => boolean | void, maxBytes = 8 * 1024 * 1024): void {
	const fd = openSync(file, "r");
	try {
		const chunk = Buffer.alloc(64 * 1024);
		let pending = Buffer.alloc(0), total = 0, read: number;
		while (total < maxBytes && (read = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
			total += read;
			pending = Buffer.concat([pending, chunk.subarray(0, read)]);
			let newline: number;
			while ((newline = pending.indexOf(10)) !== -1) {
				const line = pending.subarray(0, newline).toString("utf8");
				pending = pending.subarray(newline + 1);
				let record: unknown;
				try { record = JSON.parse(line); } catch { continue; } // A torn final line is not fatal.
				if (isObject(record) && visit(record)) return;
			}
		}
	} finally { closeSync(fd); }
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	return Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("") : "";
}

/**
 * Rebuild chat-view records from a pi session file: the active branch's user/assistant messages as
 * `message_end`, and tool results as `tool_execution_end` (with the call's args and the result's details).
 */
export function historyRecords(file: string): RecordData[] {
	let raw: string;
	try { raw = readFileSync(file, "utf8"); } catch { return []; }
	const entries = raw.split("\n").flatMap((line) => {
		try { const value = JSON.parse(line); return isObject(value) && value.type !== "session" ? [value] : []; }
		catch { return []; }
	});
	let path = entries;
	// Entries form a tree; show the branch ending at the latest entry. Legacy linear files have no ids.
	if (entries.length && entries.every((e) => typeof e.id === "string")) {
		const byId = new Map(entries.map((e) => [e.id as string, e]));
		path = [];
		const seen = new Set<string>();
		for (let entry: RecordData | undefined = entries.at(-1); entry && !seen.has(entry.id as string);
			entry = typeof entry.parentId === "string" ? byId.get(entry.parentId) : undefined) {
			seen.add(entry.id as string);
			path.push(entry);
		}
		path.reverse();
	}
	const calls = new Map<string, RecordData>();
	const records: RecordData[] = [];
	for (const entry of path) {
		const message = entry.message;
		if (entry.type !== "message" || !isObject(message)) continue;
		if (message.role === "user" || message.role === "assistant") {
			if (message.role === "assistant" && Array.isArray(message.content)) {
				for (const block of message.content) if (block?.type === "toolCall" && typeof block.id === "string") calls.set(block.id, block);
			}
			records.push({ type: "message_end", message, history: true });
		} else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			const call = calls.get(message.toolCallId);
			records.push({ type: "tool_execution_end", toolCallId: message.toolCallId,
				toolName: message.toolName ?? call?.name, args: call?.arguments ?? {},
				result: { content: message.content ?? [], details: message.details },
				isError: !!message.isError, history: true });
		}
	}
	return records.map((record) => redactRecord(record));
}

/** One persistent RPC process per active chat, with ordered fan-out and reconnect replay. */
export class AgentHub {
	readonly home: string;
	private directory: string;
	private chats = new Map<string, Chat>();
	private options: AgentOptions;
	private children = new Set<ChildProcessWithoutNullStreams>();
	private closed = false;
	private closing?: Promise<void>;

	constructor(home: string, options: AgentOptions = {}) {
		this.home = resolve(home);
		this.directory = join(this.home, "web-sessions");
		this.options = options;
		for (const directory of [this.directory, join(this.home, "workspace")]) {
			try {
				if (lstatSync(directory).isSymbolicLink()) throw new Error("Refusing symlink inside agent home");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		mkdirSync(this.directory, { recursive: true });
		mkdirSync(join(this.home, "workspace"), { recursive: true });
	}

	private register(id: string, file: string, options: ChatOptions = {}, loaded = false): Chat {
		const base = Date.now() * 1000;
		const chat: Chat = { id, file, ...options, running: false, lastOutput: 0, base, seq: base, historyEnd: base,
			loaded, records: [], subscribers: new Set(), waiters: new Map() };
		this.chats.set(id, chat);
		return chat;
	}

	/** Saved chats from pi session headers and first user messages, including chats not active in this process. */
	list(): { id: string; title: string; updatedAt: string }[] {
		return readdirSync(this.directory, { withFileTypes: true }).flatMap((entry) => {
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return [];
			const file = join(this.directory, entry.name);
			try {
				let id: string | undefined, title = "", first = true;
				scanLines(file, (record) => {
					if (first) {
						first = false;
						if (record.type !== "session" || typeof record.id !== "string") return true;
						id = record.id;
						return false;
					}
					const message = record.message;
					if (record.type === "message" && isObject(message) && message.role === "user") {
						title = textOf(message.content).trim();
						return true;
					}
				});
				if (!id) return [];
				const known = this.chats.get(id);
				if (!known) this.register(id, file);
				else if (known.file !== file) return []; // Another file claims a known id; keep the first.
				return [{ id, title: title.replace(/\s+/g, " ").slice(0, 120) || "New chat",
					updatedAt: statSync(file).mtime.toISOString() }];
			} catch { return []; } // A session may be concurrently removed or partially written.
		}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	/** Create a saved chat before spawning, so even an unused chat can be resumed. */
	create(options: ChatOptions | string = {}): { id: string } {
		if (this.closed) throw failure(503, "Agent hub is closed");
		const opts = typeof options === "string" ? { model: options } : options;
		const model = opts.model ?? process.env.PSI_WEB_MODEL;
		if (model !== undefined && !MODEL.test(model)) throw failure(400, "Invalid model");
		for (const key of ["skill", "topic"] as const) {
			if (opts[key] !== undefined && !SLUG.test(opts[key]!)) throw failure(400, `Invalid ${key}`);
		}
		const id = randomUUID();
		const file = join(this.directory, `${id}.jsonl`);
		writeFileSync(file, JSON.stringify({ type: "session", version: 3, id,
			timestamp: new Date().toISOString(), cwd: join(this.home, "workspace") }) + "\n", { flag: "wx" });
		const chat = this.register(id, file, { model, skill: opts.skill, topic: opts.topic }, true);
		this.start(chat);
		return { id };
	}

	private chat(id: string): Chat {
		if (this.closed) throw failure(503, "Agent hub is closed");
		if (!this.chats.has(id)) this.list();
		const chat = this.chats.get(id);
		if (!chat) throw failure(404, "Chat not found");
		return chat;
	}

	/** Seed a chat opened for the first time in this process with its saved conversation. */
	private load(chat: Chat): void {
		if (chat.loaded) return;
		chat.loaded = true;
		for (const record of historyRecords(chat.file)) this.publish(chat, record);
		chat.historyEnd = chat.seq;
	}

	private publish(chat: Chat, record: RecordData): void {
		const type = record.type;
		const update = record.assistantMessageEvent;
		// Partial tool-call JSON can carry answer keys and is never rendered; the completed call follows.
		if (type === "message_update" && isObject(update) && update.type === "toolcall_delta") return;
		redactRecord(record);
		if (type === "agent_end") delete record.messages; // Duplicates every message; the UI does not use it.
		if (type === "agent_start") chat.running = true;
		if (type === "agent_settled") { chat.running = false; this.touch(chat); }
		const event = { ...record, seq: ++chat.seq } as Event;
		this.compact(chat, event);
		chat.records.push(event);
		this.evict(chat);
		if (type === "response" && typeof record.id === "string") {
			const waiter = chat.waiters.get(record.id);
			chat.waiters.delete(record.id);
			waiter?.(record);
		}
		for (const subscriber of chat.subscribers) this.write(subscriber, event);
	}

	/** Drop buffered records superseded by `event`, so replay stays small and equivalent. */
	private compact(chat: Chat, event: Event): void {
		const message = isObject(event.message) ? event.message : undefined;
		let drop: ((r: Event) => boolean) | undefined;
		if (event.type === "message_end" && message) {
			drop = (r) => (r.type === "message_start" && isObject(r.message) && r.message.role === message.role)
				|| (message.role === "assistant" && r.type === "message_update");
		} else if (event.type === "tool_execution_end") {
			drop = (r) => (r.type === "tool_execution_start" || r.type === "tool_execution_update")
				&& r.toolCallId === event.toolCallId;
		} else if (event.type === "extension_ui_request" && ["setStatus", "setWidget"].includes(event.method as string)) {
			const key = event.method === "setStatus" ? "statusKey" : "widgetKey";
			drop = (r) => r.type === "extension_ui_request" && r.method === event.method && r[key] === event[key];
		} else if (event.type === "agent_settled") {
			// The browser closes open dialogs when a run settles; replaying them would ask again.
			drop = (r) => r.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(r.method as string);
		}
		if (drop) chat.records = chat.records.filter((r) => r.seq <= chat.historyEnd || !drop!(r));
	}

	private evict(chat: Chat): void {
		const durable = (r: Event) => r.seq <= chat.historyEnd || r.type === "message_end" || r.type === "tool_execution_end";
		let live = chat.records.filter((r) => !durable(r)).length;
		while (live > LIVE_LIMIT) {
			const index = chat.records.findIndex((r) => !durable(r));
			chat.records.splice(index, 1);
			live--;
		}
	}

	private write(res: ServerResponse, event: Event): void {
		// Disconnect slow browsers rather than retaining an unbounded HTTP write queue.
		if (!res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) res.destroy();
	}

	private idleMs(): number {
		const minutes = Number(process.env.PSI_WEB_IDLE_MIN ?? 30);
		return this.options.idleMs ?? (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60000;
	}

	/** Restart the idle countdown; a running turn that still produces output is never cut off. */
	private touch(chat: Chat): void {
		clearTimeout(chat.timer);
		if (!chat.child) return;
		const idle = this.idleMs();
		chat.timer = setTimeout(() => {
			if (chat.running && Date.now() - chat.lastOutput < idle) this.touch(chat);
			else this.stop(chat);
		}, idle);
		chat.timer.unref();
	}

	private stop(chat: Chat): void {
		clearTimeout(chat.timer);
		const child = chat.child;
		chat.child = undefined;
		chat.running = false;
		if (!child) return;
		child.kill("SIGTERM");
		const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
		timer.unref();
		child.once("close", () => clearTimeout(timer));
	}

	private start(chat: Chat): ChildProcessWithoutNullStreams {
		if (this.closed) throw failure(503, "Agent hub is closed");
		if (chat.child) return chat.child;
		this.load(chat);
		const host = this.options.host ?? (process.env.PSI_HOST === "omp" ? "omp" : "pi");
		const bin = this.options.bin ?? process.env.PSI_BIN ?? host;
		const omp = host === "omp" || /^omp(?:\.exe)?$/i.test(basename(bin));
		const args = agentArgs({ omp, directory: this.directory, file: chat.file,
			model: chat.model ?? process.env.PSI_WEB_MODEL, skill: chat.skill, topic: chat.topic });
		// Skill/topic flags apply once; later respawns resume from the extension's own session entries.
		chat.skill = chat.topic = undefined;
		const child = spawn(bin, args, { cwd: join(this.home, "workspace"),
			env: { ...process.env, PSI_HOME: this.home }, stdio: ["pipe", "pipe", "pipe"], shell: false });
		chat.child = child;
		this.children.add(child);
		let pending = Buffer.alloc(0);
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			if (chat.child === child) chat.lastOutput = Date.now();
			pending = Buffer.concat([pending, chunk]);
			let newline: number;
			// Strict LF framing: U+2028/U+2029 inside JSON strings are content, not record separators.
			while ((newline = pending.indexOf(10)) !== -1) {
				let line = pending.subarray(0, newline);
				pending = pending.subarray(newline + 1);
				if (line.at(-1) === 13) line = line.subarray(0, -1);
				if (!line.length) continue;
				try {
					const record = JSON.parse(line.toString("utf8"));
					if (isObject(record)) this.publish(chat, record);
				} catch { this.publish(chat, { type: "rpc_error", error: "Invalid JSONL record from agent" }); }
			}
			if (pending.length > MAX_LINE) {
				pending = Buffer.alloc(0);
				this.publish(chat, { type: "rpc_error", error: "Oversized JSONL record from agent" });
			}
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (text: string) => { stderr = (stderr + text).slice(-4000); });
		child.stdin.on("error", () => {});
		child.on("error", (error) => this.publish(chat, { type: "agent_error", error: error.message }));
		child.once("close", (code, signal) => {
			this.children.delete(child);
			const current = chat.child === child;
			if (current) { chat.child = undefined; chat.running = false; clearTimeout(chat.timer); }
			for (const waiter of chat.waiters.values()) waiter(undefined);
			chat.waiters.clear();
			// An exit we did not request (bad model, crash) is reported with its diagnostic tail.
			if (current && code !== 0 && code !== null && stderr.trim()) {
				this.publish(chat, { type: "agent_error", error: `Agent exited (${code}): ${stderr.trim().slice(-1500)}` });
			}
			this.publish(chat, { type: "agent_exit", code, signal });
		});
		this.touch(chat);
		child.stdin.write(JSON.stringify({ type: "get_state" }) + "\n");
		return child;
	}

	/**
	 * Forward a protocol command (the server builds it; the browser never chooses its type).
	 * With `wait`, resolves with pi's `response` record for it, or undefined on timeout/exit.
	 */
	send(id: string, command: RecordData, wait = 0): Promise<RecordData | undefined> {
		const chat = this.chat(id);
		const child = this.start(chat);
		this.touch(chat);
		if (command.type === "prompt" && chat.running && !command.streamingBehavior) command.streamingBehavior = "followUp";
		if (command.type === "extension_ui_response") {
			chat.records = chat.records.filter((r) => !(r.type === "extension_ui_request" && r.id === command.id));
		}
		let result: Promise<RecordData | undefined> = Promise.resolve(undefined);
		if (wait > 0) {
			const requestId = randomUUID();
			command = { ...command, id: requestId };
			result = new Promise((done) => {
				const timer = setTimeout(() => { chat.waiters.delete(requestId); done(undefined); }, wait);
				timer.unref();
				chat.waiters.set(requestId, (record) => { clearTimeout(timer); done(record); });
			});
		}
		child.stdin.write(JSON.stringify(command) + "\n");
		return result;
	}

	/** Subscribe and atomically replay records newer than the supplied sequence. */
	subscribe(id: string, res: ServerResponse, since = 0): void {
		const chat = this.chat(id);
		this.load(chat);
		this.touch(chat);
		// A cursor from an earlier server process (or a future one) cannot index this buffer. That tab already
		// shows the saved conversation, so it receives only what happened after the history was loaded.
		const from = since > chat.seq || (since > 0 && since <= chat.base) ? chat.historyEnd : since;
		res.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive",
			"X-Accel-Buffering": "no" });
		res.write(": connected\n\n");
		for (const event of chat.records) if (event.seq > from) this.write(res, event);
		chat.subscribers.add(res);
		const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25000);
		heartbeat.unref();
		res.once("close", () => { clearInterval(heartbeat); chat.subscribers.delete(res); });
	}

	/** Delete a saved session and stop its active child and subscribers. */
	async delete(id: string): Promise<void> {
		const chat = this.chat(id);
		const stopped = chat.child
			? new Promise<void>((done) => chat.child!.once("close", () => done())) : Promise.resolve();
		this.stop(chat);
		for (const res of chat.subscribers) res.end();
		this.chats.delete(id);
		await stopped;
		rmSync(chat.file, { force: true });
	}

	/** Stop and reap every child on server shutdown. */
	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.closed = true;
		const waits = [...this.children].map((child) => new Promise<void>((done) => child.once("close", () => done())));
		for (const chat of this.chats.values()) {
			this.stop(chat);
			for (const res of chat.subscribers) res.end();
		}
		return this.closing = Promise.all(waits).then(() => {});
	}
}
