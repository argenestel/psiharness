import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Dict = Record<string, unknown>;

/** One line emitted by the evaluator runner. Unknown fields are deliberately retained. */
export interface WrappedRecord {
	turn?: unknown;
	attempt?: unknown;
	at?: unknown;
	record?: unknown;
	[key: string]: unknown;
}

export interface ParseError {
	file?: string;
	line: number;
	error: string;
	text?: string;
}

export interface FailureEvidence {
	check: string;
	turn?: string;
	attempt?: unknown;
	message: string;
	evidence?: unknown;
}

export interface CheckScore {
	name: string;
	passed: number;
	applicable: number;
	ratio: number | null;
	failures: FailureEvidence[];
}

export interface LatencySample {
	turn: string;
	attempt?: unknown;
	valueMs: number;
}

export interface LatencyMetric {
	samples: LatencySample[];
	medianMs: number | null;
	p90Ms: number | null;
	slowest5: LatencySample[];
}

export interface TurnLatency {
	turn: string;
	attempt?: unknown;
	ttftMs?: number;
	settleMs?: number;
	deltaMs: number[];
	attemptCount: number;
	toolCount: number;
}

export interface LatencySummary {
	turns: TurnLatency[];
	ttft: LatencyMetric;
	settle: LatencyMetric;
	/** Aliases make the JSON useful to small shell/reporting scripts. */
	TTFT: LatencyMetric;
	settleTime: LatencyMetric;
}

export interface HealthSummary {
	turns: number;
	timeouts: number;
	errors: number;
	missingSettled: number;
	timeoutEvidence: FailureEvidence[];
	errorEvidence: FailureEvidence[];
	missingSettledEvidence: FailureEvidence[];
}

export interface ScenarioScore {
	scenario: string;
	checks: Record<string, CheckScore>;
	checkResults: Record<string, CheckScore>;
	passed: number;
	applicable: number;
	ratio: number | null;
	score: number | null;
	failures: FailureEvidence[];
	health: HealthSummary;
	latency: LatencySummary;
	parseErrors: ParseError[];
}

export interface ReportMetadata {
	model?: string;
	date?: string;
	scenarioCount: number;
}

export interface ScoreReport {
	scenarios: ScenarioScore[];
	checks: Record<string, CheckScore>;
	aggregate: Record<string, CheckScore>;
	overall: { passed: number; applicable: number; nonApplicable: number; ratio: number | null; score: number | null };
	passed: number;
	applicable: number;
	ratio: number | null;
	score: number | null;
	failures: FailureEvidence[];
	health: HealthSummary;
	latency: LatencySummary;
	parseErrors: ParseError[];
	metadata: ReportMetadata;
}

interface Entry {
	index: number;
	turn: string;
	attempt?: unknown;
	at?: unknown;
	record: Dict;
}

interface TimelineEvent {
	pos: number;
	kind: "text" | "delta" | "user" | "settled" | "tool" | "state" | "unknown";
	text?: string;
	toolName?: string;
	args?: Dict;
	record?: Dict;
	state?: Dict;
}

interface ToolCall {
	key: string;
	toolName: string;
	args: Dict;
	result?: unknown;
	firstPos: number;
	lastPos: number;
	isError: boolean;
}

interface TurnView {
	key: string;
	attempt?: unknown;
	entries: Entry[];
	timeline: TimelineEvent[];
	textEvents: TimelineEvent[];
	userTexts: string[];
	calls: ToolCall[];
	settled: TimelineEvent[];
	sentKind?: string;
	sentAt?: unknown;
	state?: Dict;
}

interface ChallengeInfo {
	id?: string;
	skill?: string;
	subskillId?: string;
	prompt?: string;
	expected?: string;
	call: ToolCall;
}

interface ChallengeIndex {
	byId: Map<string, Dict>;
	sources: number;
}

const CHECK_NAMES = [
	"teachFirst",
	"questionCount",
	"settled",
	"continueTeaching",
	"citations",
	"spoilers",
	"attemptOnce",
	"wrongGuessTeaching",
] as const;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isObject(value: unknown): value is Dict {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function recordOf(value: WrappedRecord | unknown): Dict {
	if (isObject(value) && isObject(value.record)) return value.record;
	return isObject(value) ? value : {};
}

function parseArgs(value: unknown): Dict {
	if (isObject(value)) return value;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return isObject(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value.map((item) => isObject(item) && typeof item.text === "string" ? item.text : "").join("");
}

function messageBlocks(message: Dict): unknown[] {
	if (typeof message.content === "string") return [{ type: "text", text: message.content }];
	if (Array.isArray(message.content)) return message.content;
	if (typeof message.text === "string") return [{ type: "text", text: message.text }];
	return [];
}

function toolNameOf(value: Dict): string | undefined {
	for (const key of ["toolName", "name"]) if (typeof value[key] === "string") return value[key] as string;
	const tool = value.tool;
	return isObject(tool) && typeof tool.name === "string" ? tool.name : undefined;
}

function toolIdOf(value: Dict): string | undefined {
	for (const key of ["toolCallId", "callId", "id"]) if (typeof value[key] === "string") return value[key] as string;
	const call = value.toolCall;
	return isObject(call) && typeof call.id === "string" ? call.id : undefined;
}

function argsOf(value: Dict): Dict {
	for (const key of ["args", "arguments", "input", "parameters"]) if (value[key] !== undefined) return parseArgs(value[key]);
	const call = value.toolCall;
	if (isObject(call)) return parseArgs(call.arguments ?? call.args ?? call.input);
	return {};
}

function resultOf(value: Dict): unknown {
	return value.result ?? value.toolResult ?? value.output ?? value.response;
}

function isSettledRecord(record: Dict): boolean {
	if (record.type === "agent_settled") return true;
	return record.type === "harness_turn_settled" && (record.status === undefined || record.status === "settled");
}

function numberOrDate(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const numeric = Number(value);
		if (Number.isFinite(numeric) && value.trim() !== "") return numeric;
		const date = Date.parse(value);
		if (Number.isFinite(date)) return date;
	}
	return undefined;
}

function rawAt(entry: Entry): number | undefined {
	const record = entry.record;
	return numberOrDate(entry.at ?? record.at ?? record.timestamp ?? record.time ?? record.timestampMs);
}

function timeScale(entries: Entry[]): number {
	const values = entries.map(rawAt).filter((value): value is number => value !== undefined);
	const max = Math.max(...values.map((value) => Math.abs(value)), 0);
	return max >= 1e12 ? 1 : max >= 1e8 ? 1000 : 1;
}

function timeMs(entry: Entry, scale: number): number | undefined {
	const value = rawAt(entry);
	if (value === undefined) return undefined;
	const original = entry.at ?? entry.record.at ?? entry.record.timestamp ?? entry.record.time ?? entry.record.timestampMs;
	return value * (typeof original === "number" || (typeof original === "string" && /^\d+(?:\.\d+)?$/.test(original.trim())) ? scale : 1);
}

function turnValue(entry: WrappedRecord | unknown, index: number): string {
	const record = recordOf(entry);
	const value = isObject(entry) ? entry.turn ?? record.turn : record.turn;
	return value === undefined || value === null ? "0" : String(value);
}

function attemptValue(entry: WrappedRecord | unknown): unknown {
	const record = recordOf(entry);
	return isObject(entry) ? entry.attempt ?? record.attempt : record.attempt;
}

function attemptRank(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function normalizeInput(input: unknown): { entries: Entry[]; parseErrors: ParseError[]; scenario?: string; metadata?: Dict } {
	let source: unknown = input;
	let parseErrors: ParseError[] = [];
	let scenario: string | undefined;
	let metadata: Dict | undefined;
	if (isObject(input)) {
		if (Array.isArray(input.events)) source = input.events;
		if (Array.isArray(input.records)) source = input.records;
		if (Array.isArray(input.parseErrors)) parseErrors = input.parseErrors.filter(isObject) as unknown as ParseError[];
		scenario = asString(input.scenario) ?? asString(input.name);
		metadata = isObject(input.metadata) ? input.metadata : undefined;
	}
	const values = Array.isArray(source) ? source : [];
	const entries: Entry[] = [];
	for (const [index, value] of values.entries()) {
		if (!isObject(value)) continue;
		const record = recordOf(value);
		if (value.turn === null) continue;
		if (record.type === "harness_meta") {
			metadata = { ...(metadata ?? {}), ...record };
			continue;
		}
		if ((record.type === "harness_exit" || record.type === "harness_run_end") && value.turn === undefined) continue;
		if (record.type === "harness_turn_sent" && value.turn === undefined && record.turn === undefined) continue;
		entries.push({ index, turn: turnValue(value, index), attempt: attemptValue(value), at: value.at ?? record.at, record });
	}
	return { entries, parseErrors, scenario, metadata };
}

function selectTurns(entries: Entry[]): TurnView[] {
	const groups = new Map<string, Entry[]>();
	for (const entry of entries) groups.set(entry.turn, [...(groups.get(entry.turn) ?? []), entry]);
	const result: TurnView[] = [];
	for (const [key, all] of groups) {
		const attempts = new Map<string, Entry[]>();
		for (const entry of all) {
			const attempt = entry.attempt === undefined ? "__default" : String(entry.attempt);
			attempts.set(attempt, [...(attempts.get(attempt) ?? []), entry]);
		}
		const candidates = [...attempts.entries()].map(([attempt, group]) => ({ attempt, group,
			rank: attemptRank(group[0].attempt), last: group.at(-1)!.index }));
		candidates.sort((a, b) => {
			if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) return a.rank - b.rank;
			return a.last - b.last;
		});
		const selected = candidates.at(-1)?.group ?? [];
		if (!selected.length) continue;
		result.push(buildTurn(key, selected));
	}
	result.sort((a, b) => (a.entries[0]?.index ?? 0) - (b.entries[0]?.index ?? 0));
	return result;
}

function addMessageEvents(events: TimelineEvent[], message: Dict, pos: number): boolean {
	const role = message.role;
	const blocks = messageBlocks(message);
	if (role === "user") {
		const text = textOf(message.content ?? message.text);
		if (text) events.push({ pos, kind: "user", text });
		return false;
	}
	if (role !== "assistant") return false;
	let hasText = false;
	for (const [offset, block] of blocks.entries()) {
		if (!isObject(block)) continue;
		if (block.type === "text" && typeof block.text === "string") {
			hasText = hasText || !!block.text;
			events.push({ pos: pos + offset / 100, kind: "text", text: block.text });
		} else if (block.type === "toolCall") {
			events.push({ pos: pos + offset / 100, kind: "tool", toolName: toolNameOf(block), args: argsOf(block), record: block });
		}
	}
	return hasText;
}

function buildTurn(key: string, entries: Entry[]): TurnView {
	const timeline: TimelineEvent[] = [];
	const deltaEvents: TimelineEvent[] = [];
	let completeText = false;
	let sentKind: string | undefined;
	let sentAt: unknown;
	let state: Dict | undefined;
	for (const entry of entries) {
		const record = entry.record;
		const base = entry.index * 100;
		if (record.type === "harness_turn_sent") {
			if (typeof record.kind === "string") sentKind = record.kind;
			sentAt = record.sentAt ?? record.at ?? entry.at;
			continue;
		}
		if (record.type === "harness_meta") continue;
		if (record.type === "message_end" && isObject(record.message)) {
			completeText = addMessageEvents(timeline, record.message, base) || completeText;
			continue;
		}
		if (record.type === "message" && isObject(record.message)) {
			completeText = addMessageEvents(timeline, record.message, base) || completeText;
			continue;
		}
		const update = isObject(record.assistantMessageEvent) ? record.assistantMessageEvent : record;
		if (record.type === "message_update" && typeof update.delta === "string"
			&& (update.type === "text_delta" || update.type === "text" || update.type === undefined)) {
			const event = { pos: base, kind: "delta" as const, text: update.delta };
			deltaEvents.push(event);
			timeline.push(event);
			continue;
		}
		if (record.type === "message_update" && update.type === "toolcall_end" && isObject(update.toolCall)) {
			timeline.push({ pos: base, kind: "tool", toolName: toolNameOf(update.toolCall), args: argsOf(update.toolCall), record: update.toolCall });
			continue;
		}
		if (record.type === "tool_execution_start" || record.type === "tool_execution_end") {
			timeline.push({ pos: base, kind: "tool", toolName: toolNameOf(record), args: argsOf(record), record });
			continue;
		}
		if (isSettledRecord(record)) {
			timeline.push({ pos: base, kind: "settled", record });
			continue;
		}
		if (record.type === "harness_state" || record.type === "state") {
			state = { ...(state ?? {}), ...(isObject(record.state) ? record.state : record) };
			timeline.push({ pos: base, kind: "state", state, record });
			continue;
		}
		timeline.push({ pos: base, kind: "unknown", record });
	}
	if (completeText) for (const event of deltaEvents) {
		const index = timeline.indexOf(event);
		if (index >= 0) timeline.splice(index, 1);
	}
	timeline.sort((a, b) => a.pos - b.pos);
	const calls: ToolCall[] = [];
	const byId = new Map<string, ToolCall>();
	const openAnon = new Map<string, ToolCall[]>();
	let anon = 0;
	const ensureCall = (event: TimelineEvent): ToolCall | undefined => {
		const name = event.toolName;
		if (!name) return undefined;
		const record = event.record ?? {};
		const id = toolIdOf(record);
		const end = record.type === "tool_execution_end";
		let call = id ? byId.get(`id:${id}`) : undefined;
		if (!call && !id) {
			const open = openAnon.get(name) ?? [];
			call = end ? open.at(-1) : open.find((candidate) => candidate.firstPos < event.pos && !candidate.result);
		}
		if (!call) {
			call = { key: id ? `id:${id}` : `anon:${anon++}`, toolName: name, args: event.args ?? {},
				firstPos: event.pos, lastPos: event.pos, isError: false };
			calls.push(call);
			if (id) byId.set(`id:${id}`, call);
			else openAnon.set(name, [...(openAnon.get(name) ?? []), call]);
		}
		call.firstPos = Math.min(call.firstPos, event.pos);
		call.lastPos = Math.max(call.lastPos, event.pos);
		if (Object.keys(event.args ?? {}).length) call.args = { ...call.args, ...event.args };
		if (record.type === "tool_execution_end") {
			call.result = resultOf(record);
			call.isError = Boolean(record.isError) || (isObject(call.result) && call.result.isError === true);
		}
		return call;
	};
	for (const event of timeline) if (event.kind === "tool") ensureCall(event);
	const textEvents = timeline.filter((event) => (event.kind === "text" || event.kind === "delta") && !!event.text);
	const userTexts = timeline.filter((event) => event.kind === "user").map((event) => event.text ?? "");
	return { key, attempt: entries[0].attempt, entries, timeline, textEvents, userTexts, calls,
		settled: timeline.filter((event) => event.kind === "settled"), sentKind, sentAt, state };
}

function deepField(value: unknown, key: string, depth = 0): unknown {
	if (depth > 8 || value === null || value === undefined) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = deepField(item, key, depth + 1);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (!isObject(value)) return undefined;
	if (value[key] !== undefined) return value[key];
	for (const child of Object.values(value)) {
		const found = deepField(child, key, depth + 1);
		if (found !== undefined) return found;
	}
	return undefined;
}

function challengeIdOf(call: ToolCall): string | undefined {
	const direct = call.args.challengeId ?? (call.toolName === "psi_challenge" || call.toolName === "psi_attempt" ? call.args.id : undefined);
	if (typeof direct === "string" && direct) return direct;
	for (const key of ["challengeId", "id"]) {
		const value = deepField(call.result, key);
		if (typeof value === "string" && value) return value;
	}
	return undefined;
}

function resultIsError(call: ToolCall): boolean {
	if (call.isError) return true;
	const result = call.result;
	if (isObject(result) && Array.isArray(result.errors) && result.errors.length > 0) return true;
	const details = deepField(result, "details");
	return isObject(details) && Array.isArray(details.errors) && details.errors.length > 0;
}

function sourceCount(packData: unknown): number {
	if (Array.isArray(packData)) return packData.length;
	if (!isObject(packData)) return 0;
	if (Array.isArray(packData.sources)) return packData.sources.length;
	if (isObject(packData.sources)) {
		const arrays = Object.values(packData.sources).filter(Array.isArray) as unknown[][];
		if (arrays.length) return arrays.reduce((total, values) => total + values.length, 0);
	}
	let found = 0;
	for (const [key, child] of Object.entries(packData)) {
		if (/sources/i.test(key) && Array.isArray(child)) found += child.length;
		else if (isObject(child)) found = Math.max(found, sourceCount(child));
	}
	return found;
}

function buildChallengeIndex(packData: unknown): ChallengeIndex {
	const byId = new Map<string, Dict>();
	const seen = new Set<unknown>();
	const visit = (value: unknown, depth: number): void => {
		if (depth > 10 || value === null || typeof value !== "object" || seen.has(value)) return;
		seen.add(value);
		if (isObject(value) && typeof value.id === "string"
			&& (typeof value.prompt === "string" || value.expected !== undefined || value.subskillId !== undefined)) byId.set(value.id, value);
		if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
		else if (isObject(value)) for (const child of Object.values(value)) visit(child, depth + 1);
	};
	visit(packData, 0);
	return { byId, sources: sourceCount(packData) };
}

function challengeInfo(call: ToolCall, index: ChallengeIndex): ChallengeInfo {
	const id = challengeIdOf(call);
	const packed = id ? index.byId.get(id) : undefined;
	const field = (key: string): unknown => call.args[key] ?? deepField(call.result, key) ?? packed?.[key];
	const expected = field("expected");
	const prompt = field("prompt");
	const subskillId = field("subskillId");
	const skill = field("skill");
	const expectedText = expected === undefined || expected === null ? undefined
		: typeof expected === "string" ? expected : JSON.stringify(expected);
	return { id, skill: typeof skill === "string" ? skill : undefined,
		subskillId: typeof subskillId === "string" ? subskillId : undefined,
		prompt: typeof prompt === "string" ? prompt : undefined,
		expected: expectedText, call };
}

function cleanProse(value: string): string {
	let text = value.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/`[^`\n]*`/g, " ");
	text = text.split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join("\n");
	let output = "";
	let quote: string | undefined;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quote) {
			if (char === quote || (quote === "“" && char === "”") || (quote === "‘" && char === "’")) quote = undefined;
			else if (char === "\\") i++;
			continue;
		}
		if (["\"", "“", "‘"].includes(char)) {
			if (char === "‘" && /[A-Za-z0-9]/.test(text[i - 1] ?? "")) output += char;
			else quote = char;
			continue;
		}
		if (char === "'" && !(/[A-Za-z0-9]/.test(text[i - 1] ?? "") && /[A-Za-z0-9]/.test(text[i + 1] ?? ""))) {
			quote = char;
			continue;
		}
		output += char;
	}
	return output;
}

/** Count prose questions and add ungraded psi_ask prompts supplied by the caller. */
export function countQuestions(text: string, psiAsk?: number): number;
export function countQuestions(text: unknown, psiAsk = 0): number {
	if (typeof text !== "string") return Math.max(0, Math.floor(psiAsk));
	return (cleanProse(text).match(/[?？]/g) ?? []).length + Math.max(0, Math.floor(psiAsk));
}

function normalizeAnswer(value: string): string {
	return value.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function removePrompt(text: string, prompt?: string): string {
	if (!prompt || !prompt.trim()) return text;
	const escaped = prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return text.replace(new RegExp(escaped, "gi"), " ");
}

function optionTexts(call: ToolCall): string[] {
	const values: string[] = [];
	const add = (value: unknown): void => {
		if (typeof value === "string") values.push(value);
		else if (Array.isArray(value)) for (const item of value) add(item);
		else if (isObject(value)) for (const key of ["label", "message", "text", "title"]) if (value[key] !== undefined) add(value[key]);
	};
	if (call.args.options !== undefined) add(call.args.options);
	else add(deepField(call.result, "options"));
	return values;
}

function optionLabels(call: ToolCall): string[] {
	const source = call.args.options !== undefined ? call.args.options : deepField(call.result, "options");
	if (!Array.isArray(source)) return typeof source === "string" ? [source] : [];
	return source.map((option) => isObject(option) && typeof option.label === "string" ? option.label : typeof option === "string" ? option : "").filter(Boolean);
}

function optionCount(call: ToolCall): number {
	const source = call.args.options !== undefined ? call.args.options : deepField(call.result, "options");
	return Array.isArray(source) ? source.length : 0;
}

function isTeachingText(text: string): boolean {
	const clean = cleanProse(text).replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
	return clean.length >= 40 && !/[?？]/.test(clean);
}

function firstQuestionPos(turn: TurnView): number | undefined {
	let first: number | undefined;
	for (const event of turn.textEvents) if (countQuestions(event.text ?? "") > 0) first = first === undefined ? event.pos : Math.min(first, event.pos);
	for (const call of turn.calls) if (call.toolName === "psi_ask") first = first === undefined ? call.firstPos : Math.min(first, call.firstPos);
	for (const call of turn.calls) if (call.toolName === "psi_challenge") first = first === undefined ? call.firstPos : Math.min(first, call.firstPos);
	return first;
}

function hasTeachingBefore(turn: TurnView, boundary: number | undefined): boolean {
	for (const call of turn.calls) {
		if (boundary !== undefined && call.firstPos >= boundary) continue;
		if ((call.toolName === "psi_lesson" || call.toolName === "psi_run") && !resultIsError(call)) return true;
	}
	for (const event of turn.textEvents) {
		if (boundary !== undefined && event.pos > boundary) continue;
		const text = event.text ?? "";
		if (boundary !== undefined && event.pos === boundary) {
			const beforeQuestion = text.split(/[?？]/, 1)[0] ?? "";
			if (isTeachingText(beforeQuestion)) return true;
		} else if (isTeachingText(text)) return true;
	}
	return false;
}

function failure(check: string, turn: TurnView | undefined, message: string, evidence?: unknown): FailureEvidence {
	return { check, turn: turn?.key, attempt: turn?.attempt, message, evidence };
}

function checkResult(name: string, passed: number, applicable: number, failures: FailureEvidence[]): CheckScore {
	return { name, passed, applicable, ratio: applicable ? passed / applicable : null, failures };
}

function toolCallsBefore(turn: TurnView, position: number | undefined, name: string): ToolCall[] {
	return turn.calls.filter((call) => call.toolName === name && (position === undefined || call.firstPos < position));
}

function wrongGuess(call: ToolCall): boolean {
	const values: unknown[] = [call.args.outcome, call.args.result, deepField(call.result, "outcome"), deepField(call.result, "wrong_guess"), deepField(call.result, "wrongGuess")];
	return values.some((value) => value === true || (typeof value === "string" && /wrong[ _-]?guess/i.test(value)));
}

function challengeForAttempt(call: ToolCall, presentations: Map<string, ChallengeInfo>, index: ChallengeIndex): ChallengeInfo {
	const id = challengeIdOf(call);
	if (id && presentations.has(id)) return presentations.get(id)!;
	return challengeInfo(call, index);
}

function stateChallengeId(turn: TurnView): string | undefined {
	const open = turn.state?.openChallenge ?? turn.state?.challenge ?? turn.state?.open;
	if (typeof open === "string") return open;
	if (isObject(open)) {
		for (const key of ["id", "challengeId"]) if (typeof open[key] === "string") return open[key];
	}
	for (const key of ["challengeId", "openChallengeId"]) if (typeof turn.state?.[key] === "string") return turn.state[key] as string;
	return undefined;
}

function challengeForAttemptInTurn(turn: TurnView, call: ToolCall, presentations: Map<string, ChallengeInfo>, index: ChallengeIndex): ChallengeInfo {
	const direct = challengeForAttempt(call, presentations, index);
	if (direct.id) return direct;
	const stateId = stateChallengeId(turn);
	if (stateId && presentations.has(stateId)) return presentations.get(stateId)!;
	const packed = stateId ? index.byId.get(stateId) : undefined;
	if (packed) return challengeInfo({ ...call, args: { ...call.args, challengeId: stateId } }, index);
	return direct;
}

function challengeFromState(turn: TurnView, presentations: Map<string, ChallengeInfo>, index: ChallengeIndex): ChallengeInfo | undefined {
	const id = stateChallengeId(turn);
	if (!id) return undefined;
	if (presentations.has(id)) return presentations.get(id);
	if (!index.byId.has(id)) return undefined;
	const call: ToolCall = { key: `state:${id}`, toolName: "psi_challenge", args: { id }, firstPos: -1, lastPos: -1, isError: false };
	return challengeInfo(call, index);
}

function normalizedTurnText(turn: TurnView, before?: number): string {
	return turn.textEvents.filter((event) => before === undefined || event.pos < before).map((event) => event.text ?? "").join(" ");
}

function metric(samples: LatencySample[]): LatencyMetric {
	const sorted = [...samples].sort((a, b) => a.valueMs - b.valueMs);
	const values = sorted.map((sample) => sample.valueMs);
	let median: number | null = null;
	if (values.length) {
		const middle = Math.floor(values.length / 2);
		median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
	}
	const p90 = values.length ? values[Math.max(0, Math.ceil(values.length * 0.9) - 1)] : null;
	return { samples: sorted, medianMs: median, p90Ms: p90, slowest5: [...sorted].reverse().slice(0, 5) };
}

function latencyForTurns(turns: TurnView[]): LatencySummary {
	const turnValues: TurnLatency[] = [];
	const ttft: LatencySample[] = [];
	const settle: LatencySample[] = [];
	for (const turn of turns) {
		const scale = timeScale(turn.entries);
		const sent = turn.sentAt === undefined ? undefined : numberOrDate(turn.sentAt);
		const starts = turn.entries.map((entry) => timeMs(entry, scale)).filter((value): value is number => value !== undefined);
		const sentNumeric = typeof turn.sentAt === "number" || (typeof turn.sentAt === "string" && /^\d+(?:\.\d+)?$/.test(turn.sentAt.trim()));
		const start = sent === undefined ? starts[0] : (sentNumeric ? sent * timeScale(turn.entries) : sent);
		const outputEntries = turn.entries.filter((entry) => {
			if (entry.record.type === "tool_execution_start") return true;
			if (entry.record.type === "message_end") return isObject(entry.record.message) && entry.record.message.role === "assistant";
			if (entry.record.type !== "message_update") return false;
			const update = isObject(entry.record.assistantMessageEvent) ? entry.record.assistantMessageEvent : entry.record;
			return typeof update.type === "string" && /(?:^|_)(?:text|thinking|toolcall)(?:_delta|_start)$/.test(update.type);
		});
		const outputTimes = outputEntries.map((entry) => timeMs(entry, scale)).filter((value): value is number => value !== undefined);
		const settledEntry = turn.entries.find((entry) => isSettledRecord(entry.record));
		const settledAt = settledEntry ? timeMs(settledEntry, scale) : undefined;
		const deltas = outputTimes.slice(1).map((value, index) => Math.max(0, value - outputTimes[index]));
		const item: TurnLatency = { turn: turn.key, attempt: turn.attempt, deltaMs: deltas,
			attemptCount: turn.calls.filter((call) => call.toolName === "psi_attempt").length,
			toolCount: turn.calls.length };
		if (start !== undefined && outputTimes[0] !== undefined) {
			item.ttftMs = Math.max(0, outputTimes[0] - start);
			ttft.push({ turn: turn.key, attempt: turn.attempt, valueMs: item.ttftMs });
		}
		if (start !== undefined && settledAt !== undefined) {
			item.settleMs = Math.max(0, settledAt - start);
			settle.push({ turn: turn.key, attempt: turn.attempt, valueMs: item.settleMs });
		}
		turnValues.push(item);
	}
	const ttftMetric = metric(ttft);
	const settleMetric = metric(settle);
	return { turns: turnValues, ttft: ttftMetric, settle: settleMetric, TTFT: ttftMetric, settleTime: settleMetric };
}

function healthForTurns(turns: TurnView[]): HealthSummary {
	const timeoutEvidence: FailureEvidence[] = [];
	const errorEvidence: FailureEvidence[] = [];
	const missingSettledEvidence: FailureEvidence[] = [];
	for (const turn of turns) {
		const records = turn.entries.map((entry) => entry.record);
		const timedOut = records.some((record) => record.type === "timeout" || record.type === "agent_timeout" || record.type === "harness_timeout"
			|| record.timeout === true || record.timedOut === true || record.status === "timeout"
			|| (typeof record.error === "string" && /timeout|timed out/i.test(record.error)));
		if (timedOut) timeoutEvidence.push(failure("runHealth.timeout", turn, "turn reported a timeout"));
		for (const record of records) {
			if (record.type === "error" || record.type === "agent_error" || record.type === "process_error"
				|| record.type === "harness_error" || record.type === "harness_timeout"
				|| (record.type === "response" && record.success === false)) {
				errorEvidence.push(failure("runHealth.error", turn, "turn reported an error", record.error ?? record));
			}
		}
		if (!turn.settled.length) missingSettledEvidence.push(failure("runHealth.missingSettled", turn, "turn has no agent_settled record"));
	}
	return { turns: turns.length, timeouts: timeoutEvidence.length, errors: errorEvidence.length,
		missingSettled: missingSettledEvidence.length, timeoutEvidence, errorEvidence, missingSettledEvidence };
}

function mergeCheckScores(scores: CheckScore[]): CheckScore {
	const first = scores[0] ?? { name: "unknown", passed: 0, applicable: 0, ratio: null, failures: [] };
	const passed = scores.reduce((sum, score) => sum + score.passed, 0);
	const applicable = scores.reduce((sum, score) => sum + score.applicable, 0);
	return checkResult(first.name, passed, applicable, scores.flatMap((score) => score.failures));
}

function mergeHealth(values: HealthSummary[]): HealthSummary {
	return { turns: values.reduce((sum, value) => sum + value.turns, 0),
		timeouts: values.reduce((sum, value) => sum + value.timeouts, 0), errors: values.reduce((sum, value) => sum + value.errors, 0),
		missingSettled: values.reduce((sum, value) => sum + value.missingSettled, 0),
		timeoutEvidence: values.flatMap((value) => value.timeoutEvidence), errorEvidence: values.flatMap((value) => value.errorEvidence),
		missingSettledEvidence: values.flatMap((value) => value.missingSettledEvidence) };
}

function mergeLatency(values: LatencySummary[]): LatencySummary {
	const turns = values.flatMap((value) => value.turns);
	const ttftMetric = metric(values.flatMap((value) => value.ttft.samples));
	const settleMetric = metric(values.flatMap((value) => value.settle.samples));
	return { turns, ttft: ttftMetric, settle: settleMetric, TTFT: ttftMetric, settleTime: settleMetric };
}

function metadataFor(normalized: { metadata?: Dict }, scenarioCount = 1): ReportMetadata {
	const metadata = normalized.metadata;
	const model = metadata && (metadata.model ?? metadata.modelId ?? metadata.modelName);
	const date = metadata && (metadata.date ?? metadata.startedAt ?? metadata.createdAt ?? metadata.timestamp);
	return { model: typeof model === "string" ? model : undefined, date: typeof date === "string" ? date : undefined, scenarioCount };
}

/** Score the final harness attempt for each turn against the tutor contract. */
export function scoreScenario(input: unknown, packData: unknown = {}): ScenarioScore {
	const normalized = normalizeInput(input);
	const turns = selectTurns(normalized.entries);
	let inheritedState: Dict | undefined;
	for (const turn of turns) {
		if (turn.state) inheritedState = { ...(inheritedState ?? {}), ...turn.state };
		else if (inheritedState) turn.state = { ...inheritedState };
	}
	const index = buildChallengeIndex(typeof packData === "string" ? loadPack(packData) : packData);
	const checks: Record<string, CheckScore> = {};

	let teachPassed = 0;
	let teachApplicable = 0;
	const teachFailures: FailureEvidence[] = [];
	const seenSubskills = new Set<string>();
	const lessonSubskill = (call: ToolCall): string | undefined => {
		const direct = call.args.subskillId ?? deepField(call.result, "subskillId") ?? deepField(call.result, "subskill");
		return typeof direct === "string" ? direct : undefined;
	};
	const allCallsBefore = (turn: TurnView, beforeTurn: TurnView, position: number): ToolCall[] => {
		const calls: ToolCall[] = [];
		for (const candidate of turns) {
			if (candidate === beforeTurn) calls.push(...candidate.calls.filter((call) => call.firstPos < position));
			else if (candidate.entries[0].index < beforeTurn.entries[0].index) calls.push(...candidate.calls);
		}
		return calls;
	};
	for (const turn of turns) {
		for (const call of turn.calls.filter((candidate) => candidate.toolName === "psi_challenge")) {
			const info = challengeInfo(call, index);
			const subskill = info.subskillId ?? "__unknown__";
			if (seenSubskills.has(subskill)) continue;
			seenSubskills.add(subskill);
			teachApplicable++;
			const lesson = allCallsBefore(turn, turn, call.firstPos).some((candidate) => candidate.toolName === "psi_lesson"
				&& (candidate.args.action === "show" || candidate.args.action === "write") && !resultIsError(candidate)
				&& lessonSubskill(candidate) === info.subskillId);
			if (lesson) teachPassed++;
			else teachFailures.push(failure("teachFirst", turn, "first challenge has no earlier lesson for the same subskill",
				{ subskillId: info.subskillId, challengeId: info.id }));
		}
	}
	checks.teachFirst = checkResult("teachFirst", teachPassed, teachApplicable, teachFailures);

	let questionPassed = 0;
	const questionFailures: FailureEvidence[] = [];
	for (const turn of turns) {
		const asks = turn.calls.filter((call) => call.toolName === "psi_ask").length;
		const count = countQuestions(turn.textEvents.map((event) => event.text ?? "").join(" "), asks);
		if (count <= 1) questionPassed++;
		else questionFailures.push(failure("questionCount", turn, `turn contains ${count} questions; at most one is allowed`, { count }));
	}
	checks.questionCount = checkResult("questionCount", questionPassed, turns.length, questionFailures);

	let settledPassed = 0;
	const settledFailures: FailureEvidence[] = [];
	for (const turn of turns) {
		const last = [...turn.calls].sort((a, b) => a.lastPos - b.lastPos).at(-1);
		const options = last?.toolName === "psi_next_steps" ? optionTexts(last) : [];
		const labels = last?.toolName === "psi_next_steps" ? optionLabels(last) : [];
		const continueOption = labels.some((option) => /continue|next|go\s*on|keep\s*going|sigue|siguiente|continuar/i.test(option));
		const count = last?.toolName === "psi_next_steps" ? optionCount(last) : 0;
		if (turn.settled.length && last?.toolName === "psi_next_steps" && count >= 2 && count <= 4 && continueOption) settledPassed++;
		else settledFailures.push(failure("settled", turn, "settled turn must end with psi_next_steps containing 2–4 options and Continue", {
			settled: turn.settled.length > 0, lastTool: last?.toolName, options: labels, optionCount: count,
		}));
	}
	checks.settled = checkResult("settled", settledPassed, turns.length, settledFailures);

	let continuePassed = 0;
	let continueApplicable = 0;
	const continueFailures: FailureEvidence[] = [];
	for (const turn of turns) {
		const kind = turn.sentKind?.toLocaleLowerCase().replace(/[- ]+/g, "_");
		const sentContinue = !!kind && /^(?:continue|next|go_on|show|just_show_me|keep_going|sigue|siguiente|continuar)$/.test(kind);
		if (!sentContinue && !turn.userTexts.some((text) => /^\s*(?:continue|next|go on|just show me|show me)\b/i.test(text))) continue;
		continueApplicable++;
		const question = firstQuestionPos(turn);
		if ((question === undefined && hasTeachingBefore(turn, undefined)) || (question !== undefined && hasTeachingBefore(turn, question))) continuePassed++;
		else continueFailures.push(failure("continueTeaching", turn, "continue/show turn asks a question before teaching", { questionPos: question }));
	}
	checks.continueTeaching = checkResult("continueTeaching", continuePassed, continueApplicable, continueFailures);

	let citationPassed = 0;
	let citationApplicable = 0;
	const citationFailures: FailureEvidence[] = [];
	for (const turn of turns) {
		const kind = turn.sentKind?.toLocaleLowerCase().replace(/[- ]+/g, "_");
		const kindApplies = !kind || /^(?:teach|continue|show|stuck|answer|just_show_me)$/.test(kind);
		if (!kindApplies) continue;
		const clean = cleanProse(turn.textEvents.map((event) => event.text ?? "").join(" ")).replace(/\s+/g, " ").trim();
		const sentences = clean.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
		const teaching = sentences.filter((sentence) => {
			const body = sentence.replace(/\[\d+\]/g, "").trim();
			return body.length >= 60 && !/[?？]/.test(body)
				&& !/^(?:answer|result|correct|incorrect|outcome|feedback|hint|your answer)\b/i.test(body);
		});
		if (!teaching.length) continue;
		citationApplicable++;
		const citations = [...clean.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
		const valid = citations.length > 0 && citations.every((number) => number >= 1 && number <= index.sources);
		if (valid) citationPassed++;
		else citationFailures.push(failure("citations", turn, `teaching turn has no valid [1..${index.sources}] citations`, {
			teaching, citations,
		}));
	}
	checks.citations = checkResult("citations", citationPassed, citationApplicable, citationFailures);

	let spoilerPassed = 0;
	let spoilerApplicable = 0;
	const spoilerFailures: FailureEvidence[] = [];
	const presentations = new Map<string, ChallengeInfo>();
	for (const turn of turns) for (const call of turn.calls.filter((candidate) => candidate.toolName === "psi_challenge")) {
		const info = challengeInfo(call, index);
		if (info.id) presentations.set(info.id, info);
	}
	const observations = new Map<string, { info: ChallengeInfo; turn: TurnView; prose: string[]; buttons: string[] }>();
	const checkSpoiler = (turn: TurnView, info: ChallengeInfo, attemptPos?: number): void => {
		const expected = normalizeAnswer(info.expected ?? "");
		if (expected.length < 4) return;
		const key = info.id ?? info.call.key;
		const prose = removePrompt(normalizedTurnText(turn, attemptPos), info.prompt);
		// Next-step buttons are checked even when they were emitted after psi_attempt: they are still learner-visible answers.
		const buttons = turn.calls.filter((candidate) => candidate.toolName === "psi_next_steps").flatMap(optionTexts).join(" ");
		const previous = observations.get(key);
		if (previous) {
			previous.prose.push(prose);
			previous.buttons.push(buttons);
		} else observations.set(key, { info, turn, prose: [prose], buttons: [buttons] });
	};
	for (const turn of turns) {
		for (const call of turn.calls.filter((candidate) => candidate.toolName === "psi_challenge")) {
			const info = challengeInfo(call, index);
			const attemptPos = turn.calls.filter((candidate) => candidate.toolName === "psi_attempt")
				.map((candidate) => candidate.firstPos).find((position) => position > call.firstPos);
			checkSpoiler(turn, info, attemptPos);
		}
		for (const call of turn.calls.filter((candidate) => candidate.toolName === "psi_attempt")) {
			checkSpoiler(turn, challengeForAttemptInTurn(turn, call, presentations, index), call.firstPos);
		}
		if (!turn.calls.some((call) => call.toolName === "psi_challenge" || call.toolName === "psi_attempt")) {
			const info = challengeFromState(turn, presentations, index);
			if (info) checkSpoiler(turn, info);
		}
	}
	for (const observation of observations.values()) {
		const expected = normalizeAnswer(observation.info.expected ?? "");
		spoilerApplicable++;
		const prose = observation.prose.map(normalizeAnswer).join(" ");
		const buttons = observation.buttons.map(normalizeAnswer).join(" ");
		if (!prose.includes(expected) && !buttons.includes(expected)) spoilerPassed++;
		else spoilerFailures.push(failure("spoilers", observation.turn, "expected answer appears before the learner attempt", {
			challengeId: observation.info.id, expected: observation.info.expected,
		}));
	}
	checks.spoilers = checkResult("spoilers", spoilerPassed, spoilerApplicable, spoilerFailures);

	let attemptPassed = 0;
	let attemptApplicable = 0;
	const attemptFailures: FailureEvidence[] = [];
	const session = "scripted";
	const attemptsByTurn = new Map<string, number>();
	const seenAttempts = new Set<string>();
	for (const turn of turns) for (const call of [...turn.calls].sort((a, b) => a.firstPos - b.firstPos)) {
		if (call.toolName === "psi_practice_session") continue;
		if (call.toolName !== "psi_attempt") continue;
		attemptApplicable++;
		const info = challengeForAttemptInTurn(turn, call, presentations, index);
		const id = info.id ?? String(call.args.challengeId ?? "__unknown__");
		const key = `${session}:${id}`;
		const turnCount = (attemptsByTurn.get(turn.key) ?? 0) + 1;
		attemptsByTurn.set(turn.key, turnCount);
		if (seenAttempts.has(key) || turnCount > 1) attemptFailures.push(failure("attemptOnce", turn, "attempt must occur once per challenge/session and at most once per turn", {
			challengeId: info.id, session, turnAttempts: turnCount,
		}));
		else { attemptPassed++; seenAttempts.add(key); }
	}
	checks.attemptOnce = checkResult("attemptOnce", attemptPassed, attemptApplicable, attemptFailures);

	let wrongPassed = 0;
	let wrongApplicable = 0;
	const wrongFailures: FailureEvidence[] = [];
	for (let turnIndex = 0; turnIndex < turns.length - 1; turnIndex++) {
		const turn = turns[turnIndex];
		const kind = turn.sentKind?.toLocaleLowerCase().replace(/[- ]+/g, "_");
		if (!turn.calls.some((call) => call.toolName === "psi_attempt" && wrongGuess(call)) && kind !== "wrong_guess") continue;
		const next = turns[turnIndex + 1];
		wrongApplicable++;
		const boundary = firstQuestionPos(next) ?? next.calls.filter((call) => call.toolName === "psi_challenge").map((call) => call.firstPos).at(0);
		if (boundary === undefined || hasTeachingBefore(next, boundary)) wrongPassed++;
		else wrongFailures.push(failure("wrongGuessTeaching", next, "the turn after wrong_guess must teach before another question/challenge"));
	}
	checks.wrongGuessTeaching = checkResult("wrongGuessTeaching", wrongPassed, wrongApplicable, wrongFailures);

	const passed = CHECK_NAMES.reduce((sum, name) => sum + checks[name].passed, 0);
	const applicable = CHECK_NAMES.reduce((sum, name) => sum + checks[name].applicable, 0);
	const allFailures = CHECK_NAMES.flatMap((name) => checks[name].failures);
	const health = healthForTurns(turns);
	const latency = latencyForTurns(turns);
	const scenario = normalized.scenario ?? "scenario";
	return { scenario, checks, checkResults: checks, passed, applicable, ratio: applicable ? passed / applicable : null,
		score: applicable ? passed / applicable : null, failures: allFailures, health, latency, parseErrors: normalized.parseErrors };
}

function emptyCheck(name: string): CheckScore {
	return checkResult(name, 0, 0, []);
}

/** Combine independently scored scenario files without treating run-health failures as contract checks. */
export function aggregateScores(scenarios: ScenarioScore[], parseErrors: ParseError[] = [], metadata?: ReportMetadata): ScoreReport {
	const checks: Record<string, CheckScore> = {};
	for (const name of CHECK_NAMES) checks[name] = mergeCheckScores(scenarios.map((scenario) => scenario.checks[name] ?? emptyCheck(name)));
	const passed = CHECK_NAMES.reduce((sum, name) => sum + checks[name].passed, 0);
	const applicable = CHECK_NAMES.reduce((sum, name) => sum + checks[name].applicable, 0);
	const health = mergeHealth(scenarios.map((scenario) => scenario.health));
	const latency = mergeLatency(scenarios.map((scenario) => scenario.latency));
	const errors = [...parseErrors, ...scenarios.flatMap((scenario) => scenario.parseErrors)];
	const nonApplicable = CHECK_NAMES.reduce((sum, name) => sum + scenarios.filter((scenario) => (scenario.checks[name]?.applicable ?? 0) === 0).length, 0);
	const overall = { passed, applicable, nonApplicable, ratio: applicable ? passed / applicable : null, score: applicable ? passed / applicable : null };
	return { scenarios, checks, aggregate: checks, overall, ...overall, failures: scenarios.flatMap((scenario) => scenario.failures), health, latency, parseErrors: errors,
		metadata: metadata ?? { scenarioCount: scenarios.length } };
}

function loadPack(reference: string): unknown {
	const candidates = [resolve(reference), resolve(REPO_ROOT, reference), resolve(REPO_ROOT, "examples", reference)];
	for (const candidate of candidates) {
		try {
			if (statSync(candidate).isDirectory()) return loadSkillPack(candidate);
			return JSON.parse(readFileSync(candidate, "utf8"));
		} catch { /* try the next candidate */ }
	}
	return {};
}

function loadSkillPack(reference: string): unknown {
	const directory = resolve(reference);
	const pack: Dict = {};
	for (const file of ["challenges.json", "sources.json", "plan.json"]) {
		try { pack[file.slice(0, -5)] = JSON.parse(readFileSync(join(directory, file), "utf8")); } catch { /* optional pack member */ }
	}
	return pack;
}

function metadataFromEvents(events: WrappedRecord[]): ReportMetadata {
	for (const event of events) {
		const record = recordOf(event);
		if (record.type !== "harness_meta") continue;
		const model = record.model ?? record.modelId ?? record.modelName;
		const date = record.date ?? record.startedAt ?? record.createdAt ?? record.timestamp;
		return { model: typeof model === "string" ? model : undefined, date: typeof date === "string" ? date : undefined, scenarioCount: 1 };
	}
	return { scenarioCount: 1 };
}

function skillPackFromEvents(events: WrappedRecord[]): unknown {
	for (const event of events) {
		const record = recordOf(event);
		if (record.type !== "harness_meta") continue;
		const reference = record.skillPack ?? record.pack ?? record.packPath;
		if (typeof reference === "string") return loadPack(reference);
	}
	return {};
}

function parseJsonl(file: string): { events: WrappedRecord[]; parseErrors: ParseError[] } {
	let raw = "";
	try { raw = readFileSync(file, "utf8"); } catch (error) { return { events: [], parseErrors: [{ file, line: 0, error: String(error) }] }; }
	const events: WrappedRecord[] = [];
	const parseErrors: ParseError[] = [];
	for (const [index, line] of raw.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (isObject(value)) events.push(value as WrappedRecord);
			else parseErrors.push({ file, line: index + 1, error: "JSON line is not an object", text: line.slice(0, 500) });
		} catch (error) { parseErrors.push({ file, line: index + 1, error: String(error), text: line.slice(0, 500) }); }
	}
	return { events, parseErrors };
}

function resolveManifestPack(dir: string): unknown {
	for (const file of ["pack.json", "pack-data.json", "manifest.json", "scenario.json"]) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
			if (isObject(parsed)) {
				const reference = parsed.pack ?? parsed.packPath ?? parsed.packFile;
				if (typeof reference === "string") return loadPack(reference);
				if (parsed.sources !== undefined || parsed.challenges !== undefined || parsed.skills !== undefined) return parsed;
			}
		} catch { /* optional manifest */ }
	}
	return {};
}

/** Score every JSONL scenario in a directory. Pack paths are resolved relative to the repository. */
export function scoreDirectory(directory: string): ScoreReport {
	const dir = resolve(directory);
	const stat = statSync(dir);
	const files = stat.isFile() ? [dir] : readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl")
		.map((entry) => join(dir, entry.name)).sort();
	const scenarios: ScenarioScore[] = [];
	const parseErrors: ParseError[] = [];
	const defaultPack = stat.isFile() ? {} : resolveManifestPack(dir);
	let reportMetadata: ReportMetadata = { scenarioCount: 0 };
	for (const file of files) {
		const parsed = parseJsonl(file);
		parseErrors.push(...parsed.parseErrors);
		const metadata = metadataFromEvents(parsed.events);
		if (!reportMetadata.model && metadata.model) reportMetadata.model = metadata.model;
		if (!reportMetadata.date && metadata.date) reportMetadata.date = metadata.date;
		const eventPack = skillPackFromEvents(parsed.events);
		const pack = isObject(eventPack) && Object.keys(eventPack).length ? eventPack : defaultPack;
		scenarios.push(scoreScenario({ events: parsed.events, scenario: basename(file, ".jsonl") }, pack));
	}
	if (!scenarios.length) scenarios.push(scoreScenario({ events: [], scenario: basename(dir) }, defaultPack));
	reportMetadata.scenarioCount = scenarios.length;
	return aggregateScores(scenarios, parseErrors, reportMetadata);
}

function percent(value: number | null): string {
	return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function reportInput(value: ScoreReport | ScenarioScore): ScoreReport {
	if ("scenarios" in value && Array.isArray(value.scenarios)) return value as ScoreReport;
	return aggregateScores([value as ScenarioScore]);
}

/** Render a Markdown report containing aggregate ratios and every failure witness. */
export function renderReport(value: ScoreReport | ScenarioScore): string {
	const report = reportInput(value);
	const lines: string[] = ["# Tutor contract score", "", `Model: ${report.metadata.model ?? "unknown"}  `,
		`Date: ${report.metadata.date ?? "unknown"}  `, `Scenarios: ${report.metadata.scenarioCount}`, "",
		`Overall: **${percent(report.overall.ratio)}** (${report.overall.passed} pass, ${report.overall.applicable - report.overall.passed} fail, ${report.overall.nonApplicable} N/A; ${report.overall.applicable} applicable checks)`, "",
		"## Aggregate checks", "", "| Check | Pass | Fail | N/A | Score |", "| --- | ---: | ---: | ---: | ---: |"];
	for (const name of CHECK_NAMES) {
		const check = report.checks[name];
		lines.push(`| ${name} | ${check.passed} | ${check.applicable - check.passed} | ${check.applicable ? 0 : 1} | ${percent(check.ratio)} |`);
	}
	lines.push("", "## Scenarios", "", "| Scenario | Score | Pass | Fail | N/A | Run health |", "| --- | ---: | ---: | ---: | ---: | --- |");
	for (const scenario of report.scenarios) {
		const na = CHECK_NAMES.filter((name) => scenario.checks[name].applicable === 0).length;
		lines.push(`| ${scenario.scenario} | ${percent(scenario.ratio)} | ${scenario.passed} | ${scenario.applicable - scenario.passed} | ${na} | ${scenario.health.errors} errors, ${scenario.health.timeouts} timeouts, ${scenario.health.missingSettled} missing settled |`);
		lines.push("", `### ${scenario.scenario} checks`, "", "| Check | Pass | Fail | N/A | Score |", "| --- | ---: | ---: | ---: | ---: |");
		for (const name of CHECK_NAMES) {
			const check = scenario.checks[name];
			lines.push(`| ${name} | ${check.passed} | ${check.applicable - check.passed} | ${check.applicable ? 0 : 1} | ${percent(check.ratio)} |`);
		}
		lines.push(`Latency: TTFT median ${scenario.latency.ttft.medianMs ?? "n/a"} ms, p90 ${scenario.latency.ttft.p90Ms ?? "n/a"}; settle median ${scenario.latency.settle.medianMs ?? "n/a"} ms, p90 ${scenario.latency.settle.p90Ms ?? "n/a"}.`);
	}
	lines.push("", "## Latency", "", `INFO latency: TTFT median ${report.latency.ttft.medianMs ?? "n/a"} ms, p90 ${report.latency.ttft.p90Ms ?? "n/a"} ms; settle median ${report.latency.settle.medianMs ?? "n/a"} ms, p90 ${report.latency.settle.p90Ms ?? "n/a"} ms.`, "");
	lines.push(`TTFT slowest 5: ${report.latency.ttft.slowest5.map((sample) => `${sample.turn}=${sample.valueMs}ms`).join(", ") || "none"}.`);
	lines.push(`Settle slowest 5: ${report.latency.settle.slowest5.map((sample) => `${sample.turn}=${sample.valueMs}ms`).join(", ") || "none"}.`);
	lines.push("", "## Failures", "");
	if (!report.failures.length) lines.push("None.");
	else for (const item of report.failures) lines.push(`- **${item.check}**${item.turn ? ` (turn ${item.turn})` : ""}: ${item.message}${item.evidence === undefined ? "" : ` — \`${JSON.stringify(item.evidence)}\``}`);
	lines.push("", "## Run health", "", `Timeouts: ${report.health.timeouts}; errors: ${report.health.errors}; missing settled: ${report.health.missingSettled}.`);
	if (report.parseErrors.length) {
		lines.push("", "## Parse errors", "");
		for (const error of report.parseErrors) lines.push(`- ${error.file ?? "input"}:${error.line}: ${error.error}`);
	}
	return `${lines.join("\n")}\n`;
}

function runCli(): void {
	const args = process.argv.slice(2);
	const directory = args.find((arg) => !arg.startsWith("-"));
	if (!directory) {
		console.error("Usage: node evals/score.ts <dir-or-jsonl> [--json]");
		process.exitCode = 2;
		return;
	}
	try {
		const report = scoreDirectory(directory);
		const outputDir = statSync(resolve(directory)).isFile() ? dirname(resolve(directory)) : resolve(directory);
		const markdown = renderReport(report);
		writeFileSync(join(outputDir, "report.md"), markdown);
		if (args.includes("--json")) writeFileSync(join(outputDir, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
		process.stdout.write(markdown);
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();

