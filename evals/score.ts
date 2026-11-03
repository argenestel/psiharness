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
	/** Scenario label (trace basename) the failure belongs to; filled in by scoreScenario. */
	scenario?: string;
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
	/** Items the check deliberately did not score, with the reason (e.g. a spoiler check with no matchable answer). */
	notApplicable?: NotApplicable[];
}

/** An explicitly unscored item. */
export interface NotApplicable {
	check: string;
	scenario?: string;
	turn?: string;
	challengeId?: string;
	reason: string;
}

/** psi-guard interventions: custom session entries the extension appends when it corrects the tutor. */
export interface GuardSummary {
	count: number;
	byTurn: Record<string, number>;
}

/** How scripted answer turns were filled: from an answer key for the open challenge, or scripted fallback text. */
export interface AnswerSummary {
	dynamic: number;
	fallback: number;
	turns: { turn: string; kind?: string; mode: string; challengeId?: string }[];
}

/** One scenario run's runner summary (`<id>[.r<k>].summary.json`, or a legacy summary.json entry). */
export interface RunSummary {
	id: string;
	repeat: number;
	success: boolean;
	turns: number;
	completedTurns: number;
	toolCalls: number;
	durationMs: number;
	model?: string;
	errors: string[];
	answers?: { dynamic: number; fallback: number };
	file: string;
}

/** Spread of one ratio across repeats. */
export interface Spread {
	mean: number | null;
	min: number | null;
	max: number | null;
	n: number;
}

/** Per-check and per-scenario spread when every scenario ran K > 1 times. */
export interface VarianceSummary {
	repeats: number;
	checks: Record<string, Spread>;
	overall: Spread;
	scenarios: Record<string, Spread>;
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

/** Informational practice density; overall first-rep latency is the mean of scenarios that present a rep. */
export interface PracticeMetrics {
	turnsToFirstRep: number | null;
	repsPerTeachingTurn: number | null;
	maxTeachStreak: number;
	gradedAttempts: number;
	teachingTurns: number;
	presentedChallenges: number;
}

/** Cadence is scored separately from the original contract checks and headline ratio. */
export interface PracticeSummary {
	metrics: PracticeMetrics;
	checks: { "practice-cadence": CheckScore };
	modeDetection: string;
}

export interface ScenarioScore {
	scenario: string;
	/** Scenario id from harness_meta (falls back to the label); repeats share it. */
	scenarioId: string;
	repeat: number;
	guard: GuardSummary;
	answers: AnswerSummary;
	practice: PracticeSummary;
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
	practice: PracticeSummary;
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
	guard: GuardSummary;
	notApplicable: NotApplicable[];
	runs: RunSummary[];
	variance?: VarianceSummary;
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
	format?: string;
	language?: string;
	choices?: string[];
	call: ToolCall;
}

interface ChallengeIndex {
	byId: Map<string, Dict>;
	sources: number;
	sourceUrls: Set<string>;
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

interface Normalized {
	entries: Entry[];
	parseErrors: ParseError[];
	scenario?: string;
	metadata?: Dict;
	guard: GuardSummary;
	answers: AnswerSummary;
}

/** True for a pi `entry_appended` record carrying a psi-guard custom entry. */
export function isGuardRecord(record: Dict): boolean {
	if (record.type !== "entry_appended") return false;
	const entry = isObject(record.entry) ? record.entry : record;
	return entry.customType === "psi-guard";
}

function normalizeInput(input: unknown): Normalized {
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
	const guard: GuardSummary = { count: 0, byTurn: {} };
	const answers: AnswerSummary = { dynamic: 0, fallback: 0, turns: [] };
	for (const [index, value] of values.entries()) {
		if (!isObject(value)) continue;
		const record = recordOf(value);
		// Guard entries are counted before the turn filter: they may arrive between turns (turn null).
		if (isGuardRecord(record)) {
			guard.count++;
			const key = value.turn === null || value.turn === undefined ? "between turns" : String(value.turn);
			guard.byTurn[key] = (guard.byTurn[key] ?? 0) + 1;
		}
		if (record.type === "harness_answer") {
			const mode = record.mode === "dynamic" ? "dynamic" : "fallback";
			answers[mode]++;
			answers.turns.push({ turn: String(value.turn ?? record.turn ?? "?"), mode,
				...(typeof record.kind === "string" ? { kind: record.kind } : {}),
				...(typeof record.challengeId === "string" ? { challengeId: record.challengeId } : {}) });
		}
		if (record.type === "harness_meta") {
			metadata = { ...(metadata ?? {}), ...record };
			continue;
		}
		if (value.turn === null) continue;
		if ((record.type === "harness_exit" || record.type === "harness_run_end") && value.turn === undefined) continue;
		if (record.type === "harness_turn_sent" && value.turn === undefined && record.turn === undefined) continue;
		entries.push({ index, turn: turnValue(value, index), attempt: attemptValue(value), at: value.at ?? record.at, record });
	}
	return { entries, parseErrors, scenario, metadata, guard, answers };
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
	const updateCalls: TimelineEvent[] = [];
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
			const event = { pos: base, kind: "tool" as const, toolName: toolNameOf(update.toolCall), args: argsOf(update.toolCall), record: update.toolCall };
			updateCalls.push(event);
			timeline.push(event);
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
	// A streamed toolcall_end arrives before its message_end, so it would sort ahead of the text that precedes the
	// call in the same message. When the finalized message carries the call, its block order wins.
	const finalized = new Set(timeline.filter((event) => event.kind === "tool" && event.record?.type === "toolCall")
		.map((event) => toolIdOf(event.record!)).filter(Boolean));
	for (const event of updateCalls) {
		const id = toolIdOf(event.record!);
		const index = id && finalized.has(id) ? timeline.indexOf(event) : -1;
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

/** A psi_attempt the tool actually saved: not rejected (error) and not a recorded:false no-op. */
function attemptRecorded(call: ToolCall): boolean {
	return !resultIsError(call) && deepField(call.result, "recorded") !== false;
}

function resultIsError(call: ToolCall): boolean {
	if (call.isError) return true;
	const result = call.result;
	if (isObject(result) && Array.isArray(result.errors) && result.errors.length > 0) return true;
	const details = deepField(result, "details");
	return isObject(details) && Array.isArray(details.errors) && details.errors.length > 0;
}

/** Normalize a source URL the way SourceStore dedupes: no scheme, www, hash, or trailing slash; lower case. */
export function normalizeSourceUrl(url: string): string {
	return url.trim().toLowerCase().replace(/#.*$/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function sourceUrls(packData: unknown): Set<string> {
	const urls = new Set<string>();
	const list = isObject(packData) && Array.isArray(packData.sources) ? packData.sources : Array.isArray(packData) ? packData : [];
	for (const source of list) if (isObject(source) && typeof source.url === "string") urls.add(normalizeSourceUrl(source.url));
	return urls;
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
	return { byId, sources: sourceCount(packData), sourceUrls: sourceUrls(packData) };
}

function challengeInfo(call: ToolCall, index: ChallengeIndex): ChallengeInfo {
	const id = challengeIdOf(call);
	const packed = id ? index.byId.get(id) : undefined;
	const field = (key: string): unknown => call.args[key] ?? deepField(call.result, key) ?? packed?.[key];
	const expected = field("expected");
	const prompt = field("prompt");
	const subskillId = field("subskillId");
	const skill = field("skill");
	const format = field("format");
	const language = field("language");
	const choices = field("choices");
	const expectedText = expected === undefined || expected === null ? undefined
		: typeof expected === "string" ? expected : JSON.stringify(expected);
	return { id, skill: typeof skill === "string" ? skill : undefined,
		subskillId: typeof subskillId === "string" ? subskillId : undefined,
		prompt: typeof prompt === "string" ? prompt : undefined,
		expected: expectedText, call,
		format: typeof format === "string" ? format : undefined,
		language: typeof language === "string" ? language : undefined,
		choices: Array.isArray(choices) ? choices.map(String) : undefined };
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
	return (withoutExamples(cleanProse(text)).match(/[?？]/g) ?? []).length + Math.max(0, Math.floor(psiAsk));
}

/**
 * Drop markdown table rows ("| Austin? | price ≥ 8? |" are column labels) and Spanish-style ¿…? spans: an inverted
 * question mark marks a target-language example being taught ("**¿Cómo se llama?**"), not a question to the learner.
 */
function withoutExamples(text: string): string {
	return withoutTableRows(text).replace(/¿[^?？\n]*[?？]/g, " ");
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

/** At least 40 characters of non-question, non-meta prose ("Next piece: …" announces teaching; it is not teaching). */
function isTeachingText(text: string): boolean {
	const sentences = proseSentences(text).map((sentence) => sentence.replace(/¿[^?？]*[?？]/g, " ").trim());
	if (sentences.some((sentence) => /[?？]/.test(sentence))) return false;
	const clean = sentences.filter((sentence) => !isMetaSentence(sentence)).join(" ").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
	return clean.length >= 40;
}

function firstQuestionPos(turn: TurnView): number | undefined {
	let first: number | undefined;
	for (const event of turn.textEvents) if (countQuestions(event.text ?? "") > 0) first = first === undefined ? event.pos : Math.min(first, event.pos);
	// A psi_ask the teach-first guard blocked was never shown.
	for (const call of turn.calls) {
		if (call.toolName === "psi_ask" && !resultIsError(call)) first = first === undefined ? call.firstPos : Math.min(first, call.firstPos);
	}
	// A challenge the teach-first guard blocked never reached the learner, so it is not a question.
	for (const call of turn.calls) {
		if (call.toolName === "psi_challenge" && !resultIsError(call)) first = first === undefined ? call.firstPos : Math.min(first, call.firstPos);
	}
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

function normalizedTurnText(turn: TurnView, before?: number, after?: number): string {
	return turn.textEvents.filter((event) => (before === undefined || event.pos < before) && (after === undefined || event.pos > after))
		.map((event) => event.text ?? "").join(" ");
}

/** 1-based record number in the scenario trace (the JSONL line when the file has no blank lines). */
function eventSeq(pos: number | undefined): number | undefined {
	return pos === undefined ? undefined : Math.floor(pos / 100) + 1;
}

const LEARNER_ANSWER_KINDS = new Set(["correct_answer", "wrong_guess", "answer"]);

// Instructional/meta prose is not factual teaching: invitations, peeking rules, next-step offers, and remarks about
// the tutoring machinery (challenges, attempts, grading, hints, XP). Questions are excluded separately.
const META_OPENER = new RegExp("^(?:don['’]?t (?:peek|look|scroll|worry)|no peeking|try (?:this|it|one|again|that|the|a|to)\\b"
	+ "|your (?:turn|move|go)\\b|give (?:it|this) a\\b|take a (?:guess|shot|moment|stab|second)|have a go|when(?:ever)? you['’]?re ready"
	+ "|ready\\b|pick (?:one|an?)\\b|choose (?:one|an option)\\b|click\\b|tap\\b|press\\b|reply\\b|type (?:your|it|in|out)\\b|send\\b|say it\\b|write (?:your|it|down)\\b"
	+ "|next(?:,|:| up| we| step| chunk| time| piece| bit| move)|up next|we can\\b|we['’]?ll\\b|let['’]?s\\b|let me\\b|i['’]?ll\\b|i will\\b|i['’]?m going to"
	+ "|i won['’]?t\\b|now (?:try|you|it['’]?s your)|go ahead|feel free|if you['’]?d like|if you want|want to\\b|nice\\b|great\\b|good (?:job|work|try|question)"
	+ "|well done|exactly\\b|not quite|almost\\b"
	// Verdicts on the learner's answer and remarks about where the session is ("We're still on …", "Continue keeps …").
	+ "|that['’]?s (?:right|correct|it|exactly|the (?:right|one))\\b|we['’]?re (?:still )?on\\b"
	+ "|we (?:still )?owe\\b|this (?:answer|line) is already\\b|continue\\b)", "i");
const META_MECHANICS = /\b(?:challenges?|drills?|cards?|attempts?|attempted|graded|grading|re-?grade|recorded|xp|streaks?|badges?|buttons?|quiz(?:zes)?|chunks?)\b|(?<!type )\bhints?\b/i;

/** True for an instructional or meta sentence that should not require a citation. */
export function isMetaSentence(sentence: string): boolean {
	const body = sentence.replace(/\[\d+\]/g, "").replace(/[*_~]+/g, "").replace(/^\s*(?:[-+•]|\d+[.)])\s+/, "").trim();
	return META_OPENER.test(body) || META_MECHANICS.test(body);
}

/** Split assistant prose into sentences, keeping line/list boundaries, after code and quotes are removed. */
function proseSentences(text: string): string[] {
	return withoutTableRows(cleanProse(text)).split(/\n+/).flatMap((line) => line.split(/(?<=[.!?])\s+/))
		.map((sentence) => sentence.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function withoutTableRows(text: string): string {
	return text.split(/\r?\n/).filter((line) => !/^\s*\|.*\|\s*$/.test(line)).join("\n");
}

/** Factual teaching sentences: long, not questions, not verdicts, not meta/instructional prose. */
export function factualSentences(text: string): string[] {
	return proseSentences(text).filter((sentence) => {
		const body = sentence.replace(/\[\d+\]/g, "").trim();
		return body.length >= 60 && !/[?？]/.test(body)
			&& !/^(?:answer|result|correct|incorrect|outcome|feedback|hint|your answer)\b/i.test(body.replace(/^[*_\s]+/, ""))
			&& !isMetaSentence(body);
	});
}

interface SpoilerMatcher {
	/** How the expected answer is matched. */
	mode: "literal" | "numeric" | "math" | "choice";
	test: (prose: string, buttons: string) => boolean;
}

const NUMBER_TOKEN = /(?<![\p{L}\p{N}_.=^])[-+−]?\d+(?:[.,]\d+)?(?![\p{L}\p{N}_^]|[.,]\d)/gu;

function numericValue(text: string): number | undefined {
	const match = /^\s*([-+−]?\d+(?:\.\d+)?)\s*(?:[\p{L}%/°]+[\p{L}\d/^%]*)?\s*$/u.exec(text);
	return match ? Number(match[1].replace("−", "-")) : undefined;
}

function hasNumber(text: string, value: number): boolean {
	// Citation markers like [3] are source numbers, not answers.
	for (const match of text.replace(/\[\d+\]/g, " ").matchAll(NUMBER_TOKEN)) {
		const token = Number(match[0].replace("−", "-").replace(",", "."));
		if (Number.isFinite(token) && Math.abs(token - value) <= 1e-9 * Math.max(1, Math.abs(value))) return true;
	}
	return false;
}

function hasChoiceLetter(text: string, letter: string, labels: string[]): boolean {
	// The label stays case-sensitive so "the answer is a list" never reads as choice A. A label counts only when
	// no other label is named the same way: a re-listed menu ("(A) … (B) …", "Option A … Option B") is not a spoiler.
	const patterns = [
		(value: string) => new RegExp(`\\b(?:[Aa]nswer|[Cc]hoice|[Oo]ption)\\s*(?:is\\s*|was\\s*)?[:(]?\\s*\\(?${value}\\)?(?![\\p{L}\\p{N}])`, "u"),
		(value: string) => new RegExp(`\\(${value}\\)`, "u"),
	];
	const l = letter.toUpperCase();
	return patterns.some((pattern) => pattern(l).test(text) && !labels.filter((other) => other !== l).some((other) => pattern(other).test(text)));
}

/** Build the matcher for one challenge's expected answer, or say why the challenge cannot be checked. */
export function spoilerMatcher(info: { expected?: string; format?: string; language?: string; choices?: string[] }): SpoilerMatcher | { skip: string } {
	const expected = info.expected?.trim();
	const format = info.format ?? "text";
	if (format === "code" && info.language === "sql" && expected) return { skip: "SQL expected value is a result row set; query text cannot be literal-matched" };
	if (!expected) return { skip: format === "code" ? `${info.language ?? "code"} challenge without an expected value (graded by tests)` : "no expected value (rubric/tutor-graded)" };
	const normalized = normalizeAnswer(expected);
	const literal = normalized.length >= 4 ? (text: string) => normalizeAnswer(text).includes(normalized) : undefined;
	const number = format === "number" || /^[-+−]?\d+(?:\.\d+)?$/.test(expected) ? numericValue(expected) : undefined;
	if (format === "choice") {
		const clean = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
		const labels = (info.choices ?? []).map((_, index) => String.fromCharCode(65 + index));
		const index = (info.choices ?? []).findIndex((choice) => clean(choice) === clean(expected));
		const letter = index >= 0 ? labels[index] : /^[a-z]$/i.test(expected) ? expected.toUpperCase() : undefined;
		if (!literal && number === undefined && !letter) return { skip: "choice answer too short to match and has no label" };
		return { mode: "choice", test: (prose, buttons) => [prose, buttons].some((text) => (literal?.(text) ?? false)
			|| (number !== undefined && hasNumber(text, number)) || (letter !== undefined && hasChoiceLetter(text, letter, labels))) };
	}
	if (number !== undefined) return { mode: "numeric", test: (prose, buttons) => hasNumber(prose, number) || hasNumber(buttons, number) };
	if (format === "math") {
		const compact = (value: string) => value.toLowerCase().replace(/\s+/g, "").replace(/\*\*/g, "^").replace(/[·*]/g, "");
		const target = compact(expected);
		if (target.length < 3) return { skip: "math answer shorter than 3 characters" };
		return { mode: "math", test: (prose, buttons) => compact(prose).includes(target) || compact(buttons).includes(target) };
	}
	if (!literal) return { skip: "text answer shorter than 4 normalized characters" };
	return { mode: "literal", test: (prose, buttons) => literal(prose) || literal(buttons) };
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
	// Each harness_state is a full snapshot taken after the turn settled (an absent challengeId means none is open),
	// so it replaces the previous one; only a turn without a snapshot inherits the last known state.
	for (const turn of turns) {
		if (turn.state) inheritedState = { ...turn.state };
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
		// A challenge a guard blocked never reached the learner, so it cannot be the subskill's first challenge.
		for (const call of turn.calls.filter((candidate) => candidate.toolName === "psi_challenge" && !resultIsError(candidate))) {
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
		const asks = turn.calls.filter((call) => call.toolName === "psi_ask" && !resultIsError(call)).length;
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
		else continueFailures.push(failure("continueTeaching", turn, question === undefined
			? "continue/show turn has no teaching content"
			: "continue/show turn asks a question before teaching", { eventSeq: eventSeq(question) }));
	}
	checks.continueTeaching = checkResult("continueTeaching", continuePassed, continueApplicable, continueFailures);

	let citationPassed = 0;
	let citationApplicable = 0;
	const citationFailures: FailureEvidence[] = [];
	// Sources the tutor adds during the session (psi_sources add) extend the citable range beyond the pack's list.
	const sessionSources = new Set<string>();
	for (const turn of turns) {
		for (const call of turn.calls) {
			if (call.toolName !== "psi_sources" || call.args.action !== "add" || typeof call.args.url !== "string" || resultIsError(call)) continue;
			const url = normalizeSourceUrl(call.args.url);
			if (!index.sourceUrls.has(url)) sessionSources.add(url);
		}
		const kind = turn.sentKind?.toLocaleLowerCase().replace(/[- ]+/g, "_");
		const kindApplies = !kind || /^(?:teach|continue|show|stuck|answer|just_show_me)$/.test(kind);
		if (!kindApplies) continue;
		const prose = turn.textEvents.map((event) => event.text ?? "").join("\n");
		const teaching = factualSentences(prose);
		if (!teaching.length) continue;
		citationApplicable++;
		const bound = index.sources + sessionSources.size;
		const citations = [...cleanProse(prose).matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
		const validMarkers = [...new Set(citations.filter((number) => number >= 1 && number <= bound))].sort((a, b) => a - b);
		const invalidMarkers = [...new Set(citations.filter((number) => number < 1 || number > bound))].sort((a, b) => a - b);
		if (validMarkers.length && !invalidMarkers.length) citationPassed++;
		else {
			const range = `[1..${bound}]${sessionSources.size ? ` (${index.sources} pack + ${sessionSources.size} added this session)` : ""}`;
			const message = !citations.length
				? `${teaching.length} factual sentence(s) but no citation markers; valid range ${range}`
				: `invalid markers ${invalidMarkers.map((n) => `[${n}]`).join(" ")} outside ${range}; valid markers ${validMarkers.map((n) => `[${n}]`).join(" ") || "none"}`;
			citationFailures.push(failure("citations", turn, message, {
				validMarkers, invalidMarkers, bound, packSources: index.sources, sessionSources: sessionSources.size,
				teaching: teaching.map((sentence) => sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence),
			}));
		}
	}
	checks.citations = checkResult("citations", citationPassed, citationApplicable, citationFailures);

	let spoilerPassed = 0;
	let spoilerApplicable = 0;
	const spoilerFailures: FailureEvidence[] = [];
	const spoilerSkipped: NotApplicable[] = [];
	const presentations = new Map<string, ChallengeInfo>();
	// A blocked psi_challenge (teach-first / lesson-first guards) never showed a card, so it has no answer to spoil.
	const shown = (call: ToolCall) => call.toolName === "psi_challenge" && !resultIsError(call);
	for (const turn of turns) for (const call of turn.calls.filter(shown)) {
		const info = challengeInfo(call, index);
		if (info.id) presentations.set(info.id, info);
	}
	const observations = new Map<string, { info: ChallengeInfo; turn: TurnView; matcher: SpoilerMatcher; prose: string[]; buttons: string[] }>();
	const skippedSpoilers = new Set<string>();
	const checkSpoiler = (turn: TurnView, info: ChallengeInfo, attemptPos?: number): void => {
		const key = info.id ?? info.call.key;
		const matcher = spoilerMatcher(info);
		if ("skip" in matcher) {
			if (!skippedSpoilers.has(key)) {
				skippedSpoilers.add(key);
				spoilerSkipped.push({ check: "spoilers", turn: turn.key, ...(info.id ? { challengeId: info.id } : {}), reason: matcher.skip });
			}
			return;
		}
		// Once the learner has sent an answer, echoing it before grading is not a spoiler: only text after the
		// first psi_attempt of an answer turn (e.g. a new challenge) is learner-facing pre-attempt material.
		const answerTurn = LEARNER_ANSWER_KINDS.has(turn.sentKind ?? "");
		const firstAttempt = turn.calls.filter((candidate) => candidate.toolName === "psi_attempt" && attemptRecorded(candidate))
			.map((candidate) => candidate.firstPos).sort((a, b) => a - b)[0];
		const after = answerTurn ? Math.max(firstAttempt ?? Number.POSITIVE_INFINITY, info.call.firstPos) : undefined;
		const prose = removePrompt(normalizedTurnText(turn, attemptPos, after), info.prompt);
		// Next-step buttons count until this challenge's own grade: after it is recorded the challenge is closed, and
		// naming its answer ("Why was it 5?") is review, not a spoiler.
		const buttons = turn.calls.filter((candidate) => candidate.toolName === "psi_next_steps"
			&& (attemptPos === undefined || candidate.firstPos < attemptPos)).flatMap(optionTexts).join(" ");
		const previous = observations.get(key);
		if (previous) {
			previous.prose.push(prose);
			previous.buttons.push(buttons);
		} else observations.set(key, { info, turn, matcher, prose: [prose], buttons: [buttons] });
	};
	for (const turn of turns) {
		for (const call of turn.calls.filter(shown)) {
			const info = challengeInfo(call, index);
			const attemptPos = turn.calls.filter((candidate) => candidate.toolName === "psi_attempt" && attemptRecorded(candidate))
				.map((candidate) => candidate.firstPos).find((position) => position > call.firstPos);
			checkSpoiler(turn, info, attemptPos);
		}
		for (const call of turn.calls.filter((candidate) => candidate.toolName === "psi_attempt" && attemptRecorded(candidate))) {
			checkSpoiler(turn, challengeForAttemptInTurn(turn, call, presentations, index), call.firstPos);
		}
		if (!turn.calls.some((call) => call.toolName === "psi_challenge" || call.toolName === "psi_attempt")) {
			const info = challengeFromState(turn, presentations, index);
			if (info) checkSpoiler(turn, info);
		}
	}
	for (const observation of observations.values()) {
		spoilerApplicable++;
		const prose = observation.prose.join("\n");
		const buttons = observation.buttons.join("\n");
		if (!observation.matcher.test(prose, buttons)) spoilerPassed++;
		else spoilerFailures.push(failure("spoilers", observation.turn, `expected answer appears before the learner attempt (${observation.matcher.mode} match)`, {
			challengeId: observation.info.id, expected: observation.info.expected,
		}));
	}
	checks.spoilers = { ...checkResult("spoilers", spoilerPassed, spoilerApplicable, spoilerFailures), notApplicable: spoilerSkipped };

	let attemptPassed = 0;
	let attemptApplicable = 0;
	const attemptFailures: FailureEvidence[] = [];
	const session = "scripted";
	const attemptsByTurn = new Map<string, number>();
	const seenAttempts = new Set<string>();
	const attemptSkipped: NotApplicable[] = [];
	for (const turn of turns) for (const call of [...turn.calls].sort((a, b) => a.firstPos - b.firstPos)) {
		if (call.toolName === "psi_practice_session") continue;
		if (call.toolName !== "psi_attempt") continue;
		// The tool's own duplicate/validation guard rejected it, so nothing was graded or saved.
		if (!attemptRecorded(call)) {
			const id = challengeIdOf(call);
			attemptSkipped.push({ check: "attemptOnce", turn: turn.key, ...(id ? { challengeId: id } : {}),
				reason: `rejected by psi_attempt, nothing recorded (event seq ${eventSeq(call.firstPos)})` });
			continue;
		}
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
	checks.attemptOnce = { ...checkResult("attemptOnce", attemptPassed, attemptApplicable, attemptFailures), notApplicable: attemptSkipped };

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
	const health = healthForTurns(turns);
	const latency = latencyForTurns(turns);
	const meta = normalized.metadata ?? {};
	const scenario = normalized.scenario ?? asString(meta.scenarioId) ?? "scenario";
	const scenarioId = asString(meta.scenarioId) ?? asString(meta.id) ?? scenario.replace(/\.r\d+$/, "");
	const repeat = typeof meta.repeat === "number" && meta.repeat >= 1 ? meta.repeat : Number(/\.r(\d+)$/.exec(scenario)?.[1] ?? 1);
	// Every witness names its scenario so a merged Failures list stays attributable.
	for (const name of CHECK_NAMES) {
		for (const item of checks[name].failures) item.scenario = scenario;
		for (const item of checks[name].notApplicable ?? []) item.scenario = scenario;
	}
	for (const item of [...health.timeoutEvidence, ...health.errorEvidence, ...health.missingSettledEvidence]) item.scenario = scenario;
	const allFailures = CHECK_NAMES.flatMap((name) => checks[name].failures);
	return { practice: practiceForTurns(turns, meta, scenario), scenario, scenarioId, repeat,
		guard: normalized.guard, answers: normalized.answers, checks, checkResults: checks, passed, applicable,
		ratio: applicable ? passed / applicable : null, score: applicable ? passed / applicable : null, failures: allFailures, health, latency,
		parseErrors: normalized.parseErrors };
}

function practiceForTurns(turns: TurnView[], metadata: Dict, scenario: string): PracticeSummary {
	const metrics: PracticeMetrics = { turnsToFirstRep: null, repsPerTeachingTurn: null, maxTeachStreak: 0,
		gradedAttempts: 0, teachingTurns: 0, presentedChallenges: 0 };
	let streak = 0;
	// Only explicit tutorMode fields are evidence; natural-language mentions of tests are not mode switches.
	const modes = [metadata.tutorMode, ...turns.flatMap((turn) => turn.timeline
		.filter((event) => event.kind === "state").map((event) => event.state?.tutorMode))]
		.filter((mode) => mode === "teach" || mode === "practice" || mode === "test");
	for (const [index, turn] of turns.entries()) {
		const reps = turn.calls.filter((call) => {
			const details = isObject(call.result) ? call.result.details : undefined;
			return call.toolName === "psi_challenge" && !resultIsError(call) && isObject(details)
				&& typeof details.challengeId === "string" && details.challengeId.length > 0;
		}).length;
		const attempts = turn.calls.filter((call) => call.toolName === "psi_attempt"
			&& call.result !== undefined && attemptRecorded(call)).length;
		const prose = cleanProse(turn.textEvents.map((event) => event.text ?? "").join(""))
			.replace(/\s+/g, " ").trim();
		const teaching = prose.length >= 200 || turn.calls.some((call) => call.toolName === "psi_run"
			|| (call.toolName === "psi_lesson" && ["show", "write"].includes(String(call.args.action))
				&& call.result !== undefined && !resultIsError(call)));
		if (reps && metrics.turnsToFirstRep === null) metrics.turnsToFirstRep = index + 1;
		metrics.presentedChallenges += reps;
		metrics.gradedAttempts += attempts;
		if (teaching) metrics.teachingTurns++;
		// Like the runtime counter (taughtSinceCheck): only a presented challenge or a recorded attempt resets the streak;
		// short non-teaching turns ("ok", "thanks") neither add to it nor reset it.
		streak = reps || attempts ? 0 : teaching ? streak + 1 : streak;
		metrics.maxTeachStreak = Math.max(metrics.maxTeachStreak, streak);
	}
	metrics.repsPerTeachingTurn = metrics.teachingTurns ? metrics.presentedChallenges / metrics.teachingTurns : null;
	const name = "practice-cadence";
	const testMode = modes.includes("test");
	const applicable = metrics.teachingTurns >= 3 && !testMode;
	const passed = applicable && metrics.maxTeachStreak <= 3;
	const check = checkResult(name, Number(passed), Number(applicable), applicable && !passed
		? [{ check: name, scenario, message: `maxTeachStreak ${metrics.maxTeachStreak} exceeds 3`, evidence: metrics }] : []);
	if (!applicable) check.notApplicable = [{ check: name, scenario,
		reason: testMode ? "explicit test mode observed" : "fewer than 3 teaching turns" }];
	return { metrics, checks: { [name]: check }, modeDetection: modes.length
		? `Explicit tutorMode observed: ${[...new Set(modes)].join(", ")}; any test mode exempts the scenario.`
		: "Test mode not detectable; cadence applies to all scenarios with >= 3 teaching turns." };
}

function mergePractice(scenarios: ScenarioScore[]): PracticeSummary {
	const values = scenarios.map((scenario) => scenario.practice.metrics);
	const sum = (key: "teachingTurns" | "presentedChallenges" | "gradedAttempts") =>
		values.reduce((total, value) => total + value[key], 0);
	const firstReps = values.map((value) => value.turnsToFirstRep).filter((value) => value !== null);
	const teachingTurns = sum("teachingTurns");
	const presentedChallenges = sum("presentedChallenges");
	const checks = scenarios.map((scenario) => scenario.practice.checks["practice-cadence"]);
	return { metrics: {
		turnsToFirstRep: firstReps.length ? firstReps.reduce((total, value) => total + value, 0) / firstReps.length : null,
		repsPerTeachingTurn: teachingTurns ? presentedChallenges / teachingTurns : null,
		maxTeachStreak: Math.max(0, ...values.map((value) => value.maxTeachStreak)),
		gradedAttempts: sum("gradedAttempts"), teachingTurns, presentedChallenges,
	}, checks: { "practice-cadence": { ...mergeCheckScores(checks), name: "practice-cadence",
		notApplicable: checks.flatMap((check) => check.notApplicable ?? []) } },
	modeDetection: `${scenarios.filter((scenario) =>
			scenario.practice.modeDetection.startsWith("Test mode not detectable")).length}`
		+ `/${scenarios.length} scenarios: test mode not detectable; apply cadence when >= 3 teaching turns.` };
}

function emptyCheck(name: string): CheckScore {
	return checkResult(name, 0, 0, []);
}

function spread(values: (number | null)[]): Spread {
	const present = values.filter((value): value is number => value !== null);
	if (!present.length) return { mean: null, min: null, max: null, n: 0 };
	return { mean: present.reduce((sum, value) => sum + value, 0) / present.length,
		min: Math.min(...present), max: Math.max(...present), n: present.length };
}

/** Per-check, overall and per-scenario spread of ratios across repeats; undefined unless some scenario repeats. */
export function varianceFor(scenarios: ScenarioScore[]): VarianceSummary | undefined {
	const repeats = Math.max(0, ...scenarios.map((scenario) => scenario.repeat));
	if (repeats <= 1) return undefined;
	const byRepeat = new Map<number, ScenarioScore[]>();
	for (const scenario of scenarios) byRepeat.set(scenario.repeat, [...(byRepeat.get(scenario.repeat) ?? []), scenario]);
	const groups = [...byRepeat.values()];
	const checks: Record<string, Spread> = {};
	for (const name of CHECK_NAMES) {
		checks[name] = spread(groups.map((group) => mergeCheckScores(group.map((scenario) => scenario.checks[name] ?? emptyCheck(name))).ratio));
	}
	const overall = spread(groups.map((group) => {
		const passed = group.reduce((sum, scenario) => sum + scenario.passed, 0), applicable = group.reduce((sum, scenario) => sum + scenario.applicable, 0);
		return applicable ? passed / applicable : null;
	}));
	const byScenario = new Map<string, ScenarioScore[]>();
	for (const scenario of scenarios) byScenario.set(scenario.scenarioId, [...(byScenario.get(scenario.scenarioId) ?? []), scenario]);
	const perScenario: Record<string, Spread> = {};
	for (const [id, group] of byScenario) perScenario[id] = spread(group.map((scenario) => scenario.ratio));
	return { repeats, checks, overall, scenarios: perScenario };
}

/** Combine independently scored scenario files without treating run-health failures as contract checks. */
export function aggregateScores(scenarios: ScenarioScore[], parseErrors: ParseError[] = [], metadata?: ReportMetadata, runs: RunSummary[] = []): ScoreReport {
	const checks: Record<string, CheckScore> = {};
	for (const name of CHECK_NAMES) {
		const merged = mergeCheckScores(scenarios.map((scenario) => scenario.checks[name] ?? emptyCheck(name)));
		const notApplicable = scenarios.flatMap((scenario) => scenario.checks[name]?.notApplicable ?? []);
		checks[name] = notApplicable.length ? { ...merged, notApplicable } : merged;
	}
	const passed = CHECK_NAMES.reduce((sum, name) => sum + checks[name].passed, 0);
	const applicable = CHECK_NAMES.reduce((sum, name) => sum + checks[name].applicable, 0);
	const health = mergeHealth(scenarios.map((scenario) => scenario.health));
	const latency = mergeLatency(scenarios.map((scenario) => scenario.latency));
	const errors = [...parseErrors, ...scenarios.flatMap((scenario) => scenario.parseErrors)];
	const nonApplicable = CHECK_NAMES.reduce((sum, name) => sum + scenarios.filter((scenario) => (scenario.checks[name]?.applicable ?? 0) === 0).length, 0);
	const overall = { passed, applicable, nonApplicable, ratio: applicable ? passed / applicable : null, score: applicable ? passed / applicable : null };
	const guard: GuardSummary = { count: 0, byTurn: {} };
	for (const scenario of scenarios) {
		guard.count += scenario.guard?.count ?? 0;
		for (const [turn, count] of Object.entries(scenario.guard?.byTurn ?? {})) guard.byTurn[`${scenario.scenario}:${turn}`] = count;
	}
	const variance = varianceFor(scenarios);
	return { practice: mergePractice(scenarios), scenarios, checks, aggregate: checks, overall, ...overall,
		failures: scenarios.flatMap((scenario) => scenario.failures), health, latency, parseErrors: errors,
		metadata: metadata ?? { scenarioCount: scenarios.length }, guard,
		notApplicable: CHECK_NAMES.flatMap((name) => checks[name].notApplicable ?? []), runs, ...(variance ? { variance } : {}) };
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

function runSummary(value: Dict, file: string): RunSummary | undefined {
	if (typeof value.id !== "string") return undefined;
	const answers = isObject(value.answers) && typeof value.answers.dynamic === "number" && typeof value.answers.fallback === "number"
		? { dynamic: value.answers.dynamic, fallback: value.answers.fallback } : undefined;
	const number = (key: string): number => typeof value[key] === "number" ? value[key] as number : 0;
	return { id: value.id, repeat: typeof value.repeat === "number" ? value.repeat : 1, success: value.success === true,
		turns: number("turns"), completedTurns: number("completedTurns"), toolCalls: number("toolCalls"), durationMs: number("durationMs"),
		...(typeof value.model === "string" ? { model: value.model } : {}),
		errors: Array.isArray(value.errors) ? value.errors.map(String) : [], ...(answers ? { answers } : {}), file };
}

/**
 * Merge runner summaries: one `<id>[.r<k>].summary.json` per scenario run, plus a legacy `summary.json` whose
 * `scenarios` array is used only for runs no per-scenario file covers.
 */
export function readRunSummaries(directory: string): RunSummary[] {
	const runs = new Map<string, RunSummary>();
	const add = (run: RunSummary | undefined, override: boolean): void => {
		if (!run) return;
		const key = `${run.id}#${run.repeat}`;
		if (override || !runs.has(key)) runs.set(key, run);
	};
	let names: string[] = [];
	try { names = readdirSync(directory).sort(); } catch { return []; }
	for (const name of names.filter((entry) => entry.endsWith(".summary.json"))) {
		try { const value: unknown = JSON.parse(readFileSync(join(directory, name), "utf8")); if (isObject(value)) add(runSummary(value, name), true); }
		catch { /* a partial summary is reported by its absence */ }
	}
	if (names.includes("summary.json")) {
		try {
			const value: unknown = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
			if (isObject(value) && Array.isArray(value.scenarios)) for (const item of value.scenarios) if (isObject(item)) add(runSummary(item, "summary.json"), false);
		} catch { /* legacy file is optional */ }
	}
	return [...runs.values()].sort((a, b) => a.id.localeCompare(b.id) || a.repeat - b.repeat);
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
	return aggregateScores(scenarios, parseErrors, reportMetadata, stat.isFile() ? [] : readRunSummaries(dir));
}

function percent(value: number | null): string {
	return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function reportInput(value: ScoreReport | ScenarioScore): ScoreReport {
	if ("scenarios" in value && Array.isArray(value.scenarios)) return value as ScoreReport;
	return aggregateScores([value as ScenarioScore]);
}

function checkRow(name: string, check: CheckScore, na: number | string, extra = ""): string {
	return `| ${name} | ${check.passed} | ${check.applicable - check.passed} | ${na} | ${percent(check.ratio)} |${extra}`;
}

function spreadText(value: Spread | undefined): string {
	if (!value || value.mean === null) return "n/a";
	return `${percent(value.mean)} (range ${percent(value.min)}–${percent(value.max)}, n=${value.n})`;
}

/** Evidence as compact JSON; position fields are record sequence numbers, so label them "event seq". */
function evidenceText(evidence: unknown): string {
	return JSON.stringify(evidence).replace(/"eventSeq":/g, '"event seq":');
}

/** Render a Markdown report containing aggregate ratios and every failure witness. */
export function renderReport(value: ScoreReport | ScenarioScore): string {
	const report = reportInput(value);
	const variance = report.variance;
	const lines: string[] = ["# Tutor contract score", "", `Model: ${report.metadata.model ?? "unknown"}  `,
		`Date: ${report.metadata.date ?? "unknown"}  `, `Scenarios: ${report.metadata.scenarioCount}${variance ? ` (${variance.repeats} repeats)` : ""}`, "",
		`Overall: **${percent(report.overall.ratio)}** (${report.overall.passed} pass, ${report.overall.applicable - report.overall.passed} fail, ${report.overall.nonApplicable} N/A; ${report.overall.applicable} applicable checks)`];
	if (variance) lines.push("", `Overall across repeats: ${spreadText(variance.overall)}`);
	lines.push("", `Guard interventions (psi-guard entries): ${report.guard?.count ?? 0}`, "", "## Aggregate checks", "",
		`| Check | Pass | Fail | N/A scenarios | Score |${variance ? " Mean across repeats |" : ""}`,
		`| --- | ---: | ---: | ---: | ---: |${variance ? " --- |" : ""}`);
	for (const name of CHECK_NAMES) {
		const na = report.scenarios.filter((scenario) => (scenario.checks[name]?.applicable ?? 0) === 0).length;
		lines.push(checkRow(name, report.checks[name], na, variance ? ` ${spreadText(variance.checks[name])} |` : ""));
	}
	lines.push("", "## Practice (separate from headline score)", "", report.practice.modeDetection,
		"Overall turnsToFirstRep = mean over scenarios with a rep; density = pooled reps / teaching turns; streak = maximum.",
		"", "| Scenario | turnsToFirstRep | repsPerTeachingTurn | maxTeachStreak | gradedAttempts"
			+ " | Teaching turns | Reps | practice-cadence |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
	for (const [label, practice] of [["Overall", report.practice],
		...report.scenarios.map((scenario) => [scenario.scenario, scenario.practice] as const)] as const) {
		const m = practice.metrics;
		const cadence = practice.checks["practice-cadence"];
		const status = cadence.applicable
			? `${cadence.passed}/${cadence.applicable} pass (${percent(cadence.ratio)})` : "N/A";
		lines.push(`| ${label} | ${m.turnsToFirstRep ?? "null"} | ${m.repsPerTeachingTurn ?? "null"}`
			+ ` | ${m.maxTeachStreak} | ${m.gradedAttempts} | ${m.teachingTurns} | ${m.presentedChallenges} | ${status} |`);
	}
	for (const scenario of report.scenarios) {
		lines.push(`Mode [${scenario.scenario}]: ${scenario.practice.modeDetection}`);
		for (const item of scenario.practice.checks["practice-cadence"].notApplicable ?? []) {
			lines.push(`N/A practice-cadence [${scenario.scenario}]: ${item.reason}`);
		}
	}
	for (const item of report.practice.checks["practice-cadence"].failures) {
		lines.push(`FAIL practice-cadence [${item.scenario}]: ${item.message}`);
	}
	// The scenario summary table stays contiguous; per-scenario details follow it.
	lines.push("", "## Scenarios", "", "| Scenario | Score | Pass | Fail | N/A | Dynamic answers | Guard | Run health |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
	for (const scenario of report.scenarios) {
		const na = CHECK_NAMES.filter((name) => scenario.checks[name].applicable === 0).length;
		const answerTotal = (scenario.answers?.dynamic ?? 0) + (scenario.answers?.fallback ?? 0);
		const answers = answerTotal ? `${scenario.answers.dynamic}/${answerTotal}` : "–";
		lines.push(`| ${scenario.scenario} | ${percent(scenario.ratio)} | ${scenario.passed} | ${scenario.applicable - scenario.passed} | ${na} | ${answers} | ${scenario.guard?.count ?? 0} | ${scenario.health.errors} errors, ${scenario.health.timeouts} timeouts, ${scenario.health.missingSettled} missing settled |`);
	}
	if (variance) {
		lines.push("", "### Scenario spread across repeats", "", "| Scenario | Mean score (range) |", "| --- | --- |");
		for (const [id, item] of Object.entries(variance.scenarios)) lines.push(`| ${id} | ${spreadText(item)} |`);
	}
	if (report.runs?.length) {
		lines.push("", "## Run summaries", "", "| Scenario | Repeat | Run | Turns | Tools | Answers (dynamic/fallback) | Duration | Errors |",
			"| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |");
		for (const run of report.runs) {
			lines.push(`| ${run.id} | ${run.repeat} | ${run.success ? "ok" : "failed"} | ${run.completedTurns}/${run.turns} | ${run.toolCalls} | ${run.answers ? `${run.answers.dynamic}/${run.answers.fallback}` : "n/a"} | ${(run.durationMs / 1000).toFixed(1)} s | ${run.errors.length} |`);
		}
	}
	lines.push("", "## Scenario details");
	for (const scenario of report.scenarios) {
		lines.push("", `### ${scenario.scenario}`, "", "| Check | Pass | Fail | N/A | Score |", "| --- | ---: | ---: | ---: | ---: |");
		for (const name of CHECK_NAMES) lines.push(checkRow(name, scenario.checks[name], scenario.checks[name].applicable ? 0 : 1));
		lines.push("", `Latency: TTFT median ${scenario.latency.ttft.medianMs ?? "n/a"} ms, p90 ${scenario.latency.ttft.p90Ms ?? "n/a"} ms; settle median ${scenario.latency.settle.medianMs ?? "n/a"} ms, p90 ${scenario.latency.settle.p90Ms ?? "n/a"} ms.`);
		if (scenario.answers?.turns.length) lines.push("", `Answer turns: ${scenario.answers.turns.map((item) => `turn ${item.turn} ${item.kind ?? "answer"} ${item.mode}${item.challengeId ? ` (${item.challengeId})` : ""}`).join("; ")}.`);
		const guardTurns = Object.entries(scenario.guard?.byTurn ?? {});
		if (guardTurns.length) lines.push("", `Guard interventions by turn: ${guardTurns.map(([turn, count]) => `${turn}=${count}`).join(", ")}.`);
	}
	lines.push("", "## Latency", "", `INFO latency: TTFT median ${report.latency.ttft.medianMs ?? "n/a"} ms, p90 ${report.latency.ttft.p90Ms ?? "n/a"} ms; settle median ${report.latency.settle.medianMs ?? "n/a"} ms, p90 ${report.latency.settle.p90Ms ?? "n/a"} ms.`, "");
	const sample = (item: LatencySample) => `turn ${item.turn}=${item.valueMs}ms`;
	const slowest = (metricName: "ttft" | "settle") => report.scenarios.flatMap((scenario) => scenario.latency[metricName].samples
		.map((item) => ({ ...item, scenario: scenario.scenario }))).sort((a, b) => b.valueMs - a.valueMs).slice(0, 5)
		.map((item) => `${item.scenario} ${sample(item)}`).join(", ") || "none";
	lines.push(`TTFT slowest 5: ${slowest("ttft")}.`);
	lines.push(`Settle slowest 5: ${slowest("settle")}.`);
	lines.push("", "## Failures", "");
	if (!report.failures.length) lines.push("None.");
	else for (const item of report.failures) lines.push(`- **${item.check}** [${item.scenario ?? "scenario"}]${item.turn ? ` (turn ${item.turn})` : ""}: ${item.message}${item.evidence === undefined ? "" : ` — \`${evidenceText(item.evidence)}\``}`);
	if (report.notApplicable?.length) {
		lines.push("", "## Not applicable (explicit)", "");
		for (const item of report.notApplicable) lines.push(`- **${item.check}** [${item.scenario ?? "scenario"}]${item.turn ? ` (turn ${item.turn})` : ""}${item.challengeId ? ` ${item.challengeId}` : ""}: ${item.reason}`);
	}
	lines.push("", "## Run health", "", `Timeouts: ${report.health.timeouts}; errors: ${report.health.errors}; missing settled: ${report.health.missingSettled}.`);
	for (const item of [...report.health.timeoutEvidence, ...report.health.errorEvidence, ...report.health.missingSettledEvidence]) {
		lines.push(`- ${item.check} [${item.scenario ?? "scenario"}]${item.turn ? ` (turn ${item.turn})` : ""}: ${item.message}`);
	}
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
		console.error("Usage: node evals/score.ts <dir-or-jsonl> [--json] [--stdout]");
		process.exitCode = 2;
		return;
	}
	try {
		const report = scoreDirectory(directory);
		const outputDir = statSync(resolve(directory)).isFile() ? dirname(resolve(directory)) : resolve(directory);
		const markdown = renderReport(report);
		if (!args.includes("--stdout")) writeFileSync(join(outputDir, "report.md"), markdown);
		if (args.includes("--json")) writeFileSync(join(outputDir, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
		process.stdout.write(markdown);
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();

