import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProfileStore } from "../../../core/src/profile.ts";
import { SourceStore } from "../../../core/src/sources.ts";
import { StateStore } from "../../../core/src/state.ts";
import type { Challenge } from "../../../core/src/types.ts";
import type { PracticeDeps } from "./index.ts";
import { readAttempts } from "./tools.ts";

/** Placeholder that replaces an open challenge's answer in tutor text and buttons. */
export const HIDDEN = "[answer hidden until you try]";
/** Appended once to a message whose out-of-range citation markers were removed. */
export const CITATION_NOTE = "(A citation was removed because it didn't match a source.)";
/** Block reason for a challenge offered on a continue/show turn before any teaching. */
export const TEACH_FIRST = "Teach the next chunk first (explanation or worked example), then offer a challenge.";

export interface NextStep { label: string; message: string }
type Span = { start: number; end: number; kind: "fence" | "code" | "math" | "link"; inner: string };
type AnswerSource = Pick<Challenge, "id" | "prompt" | "expected" | "acceptable" | "format" | "unit">;
type Block = { type?: string; text?: string; name?: string; arguments?: Record<string, unknown> };

const CONTINUE_LABEL = /^[^\p{L}\p{N}]*continue\b/iu;

/** Guarantee a Continue option: append one, dropping the last option when four are already offered. */
export function withContinue(options: NextStep[]): { options: NextStep[]; changed: boolean } {
	if (!Array.isArray(options) || options.some((o) => typeof o?.label === "string" && CONTINUE_LABEL.test(o.label))) {
		return { options, changed: false };
	}
	return { options: [...options.slice(0, 3), { label: "Continue", message: "Continue" }], changed: true };
}

/** True for "continue", "next", "go on", "keep going", "show me", "just show me" (not a request for practice). */
export function isContinueIntent(text: string): boolean {
	const t = text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ")
		.replace(/\s+/g, " ").trim();
	if (!t || t.length > 400) return false;
	if (/\b(?:challenge|quiz|test me|exercise|drill|problem|practice|try one|try it|my turn)\b/.test(t)) return false;
	return /^(?:(?:ok|okay|sure|yes|yeah|yep|please|alright|cool|great|thanks)\s)*(?:continue|next|go on|keep going|just show me|show me)\b/
		.test(t);
}

/** Code fences, inline code, math and links: regions that are never prose. */
export function protectedSpans(text: string): Span[] {
	const spans: Span[] = [];
	let pos = 0;
	let open: { mark: string; start: number; innerStart: number } | undefined;
	for (const line of text.split("\n")) {
		const end = pos + line.length;
		if (open) {
			if (new RegExp(`^\\s*${open.mark}\\s*$`).test(line)) {
				spans.push({ start: open.start, end, kind: "fence", inner: text.slice(open.innerStart, Math.max(open.innerStart, pos - 1)) });
				open = undefined;
			}
		} else {
			const fence = /^\s*(`{3,}|~{3,})/.exec(line);
			if (fence) open = { mark: `${fence[1]![0]}{${fence[1]!.length},}`, start: pos, innerStart: Math.min(text.length, end + 1) };
		}
		pos = end + 1;
	}
	if (open) spans.push({ start: open.start, end: text.length, kind: "fence", inner: text.slice(open.innerStart) });
	const fences = [...spans];
	const inline = /(`+)([\s\S]*?)\1|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$|\[[^\]]*\]\([^\s]*?\)/g;
	let gap = 0;
	for (const fence of [...fences, { start: text.length, end: text.length }]) {
		const segment = text.slice(gap, fence.start);
		for (const match of segment.matchAll(inline)) {
			const start = gap + match.index;
			const kind = match[1] ? "code" : match[0].startsWith("[") ? "link" : "math";
			spans.push({ start, end: start + match[0].length, kind, inner: match[1] ? match[2]! : match[0] });
		}
		gap = fence.end;
	}
	return spans.sort((a, b) => a.start - b.start);
}

const inside = (spans: { start: number; end: number }[], start: number, end = start + 1) =>
	spans.some((s) => start < s.end && end > s.start);

// Same marker grammar as studio/public/js/markdown.js: [1], [1, 2], [1][3], [2–4]; not xs[1], not [1](url).
const CITE = /(?<![\p{L}\p{N}_\])`])((?:\[\d{1,2}(?:\s*[,–-]\s*\d{1,2})*\])+)(?!\()/gu;

function rewriteMarker(marker: string, count: number): { text: string; removed: number[] } {
	const removed: number[] = [];
	const groups: string[] = [];
	for (const group of marker.match(/\[[^\]]*\]/g) ?? []) {
		const parts: string[] = [];
		for (const part of group.slice(1, -1).split(",")) {
			const [a = NaN, b] = part.split(/[–-]/).map((x) => Number(x.trim()));
			const end = b !== undefined && Number.isInteger(b) && b >= a && b - a < 10 ? b : a;
			if (end <= count) { parts.push(part.trim()); continue; }
			for (let n = Math.max(a, count + 1); n <= end; n++) removed.push(n);
			if (a <= count) parts.push(a === count ? String(a) : `${a}${part.includes("–") ? "–" : "-"}${count}`);
		}
		if (parts.length) groups.push(`[${parts.join(", ")}]`);
	}
	return removed.length ? { text: groups.join(""), removed } : { text: marker, removed };
}

/** Remove citation numbers above `count` from prose markers; valid markers stay byte-for-byte. */
export function fixCitations(text: string, count: number): { text: string; removed: number[] } {
	const spans = protectedSpans(text);
	const removed: number[] = [];
	let out = "";
	let last = 0;
	for (const match of text.matchAll(CITE)) {
		if (inside(spans, match.index, match.index + match[0].length)) continue;
		const fixed = rewriteMarker(match[0], count);
		if (!fixed.removed.length) continue;
		removed.push(...fixed.removed);
		out += text.slice(last, match.index);
		if (!fixed.text) out = out.replace(/[ \t]+$/, "");
		out += fixed.text;
		last = match.index + match[0].length;
	}
	return removed.length ? { text: out + text.slice(last), removed } : { text, removed };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUMBER = /^[+-]?(?:\d+(?:[.,]\d+)*|[.,]\d+)%?$/;

/** A case-insensitive whole-word (or exact numeric-literal) pattern for one accepted answer. */
export function answerPattern(answer: string, unit?: string): RegExp | undefined {
	let core = answer.normalize("NFC").trim()
		.replace(/^[\s"'`“”‘’([{!?¡¿,:;]+|[\s"'`“”‘’)\]}!?.,:;]+$/gu, "").replace(/\s+/g, " ");
	const bare = unit && core.toLowerCase().endsWith(unit.trim().toLowerCase())
		? core.slice(0, core.length - unit.trim().length).trim() : core;
	if (NUMBER.test(bare)) return new RegExp(`(?<![\\p{L}\\p{N}_.,])${escape(bare)}(?![\\p{N}_]|[.,]\\p{N})`, "gu");
	if (core.length < 2) return undefined;
	core = core.toLowerCase();
	const letters = [...core].map((ch) => {
		if (/\s/.test(ch)) return "\\s+";
		if (/[-‐‑‒–—]/.test(ch)) return "[-‐‑‒–—]";
		const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
		return base && base !== ch ? `(?:${escape(ch)}|${escape(base)})` : escape(ch);
	}).join("");
	return new RegExp(`(?<![\\p{L}\\p{N}_])${letters}(?![\\p{L}\\p{N}_])`, "giu");
}

/** Every accepted answer of a challenge as a pattern; code challenges (graded by tests) have none. */
export function answerPatterns(c: AnswerSource): RegExp[] {
	if (c.format === "code") return [];
	return [c.expected, ...(c.acceptable ?? [])].filter((v): v is string => typeof v === "string" && !!v.trim())
		.map((v) => answerPattern(v, c.unit)).filter((p): p is RegExp => !!p);
}

/** Replace accepted answers in tutor text, keeping citation markers, the challenge prompt and learner code. */
export function redactAnswers(text: string, challenges: AnswerSource[], learnerTexts: string[] = []):
	{ text: string; count: number } {
	if (!text || !challenges.length) return { text, count: 0 };
	const keep: { start: number; end: number }[] = [];
	for (const match of text.matchAll(CITE)) keep.push({ start: match.index, end: match.index + match[0].length });
	for (const span of protectedSpans(text)) {
		const code = span.inner.trim();
		if ((span.kind === "fence" || span.kind === "code") && code && learnerTexts.some((t) => t.includes(code))) keep.push(span);
	}
	for (const c of challenges) {
		const prompt = c.prompt?.trim();
		if (prompt) for (const m of text.matchAll(new RegExp(escape(prompt), "gi"))) keep.push({ start: m.index, end: m.index + m[0].length });
	}
	const hits: { start: number; end: number }[] = [];
	for (const pattern of challenges.flatMap(answerPatterns)) {
		for (const m of text.matchAll(pattern)) {
			const hit = { start: m.index, end: m.index + m[0].length };
			if (!m[0] || inside(keep, hit.start, hit.end) || inside(hits, hit.start, hit.end)) continue;
			hits.push(hit);
		}
	}
	if (!hits.length) return { text, count: 0 };
	let out = text;
	for (const hit of hits.sort((a, b) => b.start - a.start)) out = out.slice(0, hit.start) + HIDDEN + out.slice(hit.end);
	return { text: out, count: hits.length };
}

const textOf = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content)
	? content.map((b: Block) => b?.type === "text" && typeof b.text === "string" ? b.text : "").join("\n") : "";
const clip = (s: string, max: number) => s.length > max ? s.slice(0, max) : s;
const attempt = <T>(read: () => T): T | undefined => { try { return read(); } catch { return undefined; } };

/** Code-level teaching guarantees: Continue in next steps, no answer spoilers, teach before testing, valid citations. */
export function registerGuards(pi: ExtensionAPI, deps: PracticeDeps): void {
	const home = deps.practice.root;
	const sources = new SourceStore(home), saved = new StateStore(home), profile = new ProfileStore(home);
	let learner = "";
	let learnerTexts: string[] = [];
	let teachChars = 0, teachTools = 0;
	let presented: { skill: string; id: string; at: number } | undefined;
	const closed = new Set<string>(), pending = new Set<string>();
	const fire = (kind: string, detail: Record<string, unknown>) => {
		try { pi.appendEntry("psi-guard", { kind, detail }); } catch { /* counters never break a turn */ }
	};
	const newTurn = (text: string) => {
		learner = text;
		learnerTexts = [...learnerTexts, text].slice(-50);
		teachChars = 0;
		teachTools = 0;
	};
	const mustTeach = (chars = teachChars, tools = teachTools) => isContinueIntent(learner) && tools <= 0 && chars < 200
		&& attempt(() => profile.read().tutorMode) !== "test";
	const attempted = (skill: string, id: string, since: number) => attempt(() => readAttempts(home, skill)
		.some((a) => a.challengeId === id && Date.parse(a.at) >= since - 1000)) ?? false;

	/** Challenges whose answers are still private: persisted openChallenge or this session's last unattempted one. */
	const openChallenges = (exclude: Set<string> = new Set()): Challenge[] => {
		const found = new Map<string, Challenge>();
		const consider = (skill: string, id: string, since?: number) => {
			if (closed.has(id) || pending.has(id) || exclude.has(id) || found.has(id)) return;
			if (since !== undefined && attempted(skill, id, since)) { closed.add(id); return; }
			const c = attempt(() => deps.practice.getChallenge(skill, id));
			if (c) found.set(id, c);
		};
		if (presented) consider(presented.skill, presented.id, presented.at);
		const open = attempt(() => saved.read().openChallenge);
		if (open) consider(open.skill, open.id, presented?.id === open.id ? presented.at : undefined);
		return [...found.values()];
	};
	const unspoken = (cs: AnswerSource[]) => cs.filter((c) => !answerPatterns(c).some((p) => new RegExp(p).test(learner)));

	/** Redact next-step buttons and add Continue; returns whether anything changed. */
	const guardNextSteps = (input: Record<string, unknown>, open: AnswerSource[], where: string): boolean => {
		if (!Array.isArray(input.options)) return false;
		let hidden = 0;
		const options = input.options.map((o: unknown) => {
			if (!o || typeof o !== "object") return o;
			const option = { ...(o as NextStep) };
			for (const [key, max] of [["label", 60], ["message", 400]] as const) {
				if (typeof option[key] !== "string") continue;
				const r = redactAnswers(option[key], open);
				hidden += r.count;
				option[key] = clip(r.text, max);
			}
			return option;
		}) as NextStep[];
		const normalized = withContinue(options);
		if (hidden) fire("spoiler", { where, tool: "psi_next_steps", count: hidden, challengeIds: open.map((c) => c.id) });
		if (normalized.changed) fire("next-steps-continue", { where, labels: options.map((o) => o?.label) });
		if (!hidden && !normalized.changed) return false;
		input.options = normalized.options;
		return true;
	};
	const guardAsk = (input: Record<string, unknown>, open: AnswerSource[], where: string): boolean => {
		if (typeof input.hint !== "string") return false;
		const r = redactAnswers(input.hint, open);
		if (!r.count) return false;
		input.hint = clip(r.text, 400);
		fire("spoiler", { where, tool: "psi_ask", count: r.count, challengeIds: open.map((c) => c.id) });
		return true;
	};

	pi.on("session_start", async () => {
		learner = ""; learnerTexts = []; teachChars = 0; teachTools = 0; presented = undefined;
		closed.clear(); pending.clear();
	});
	pi.on("before_agent_start", async (event) => {
		if (event.messageType === "user") newTurn(event.prompt);
	});
	pi.on("message_end", async (event) => {
		const message = event.message as { role?: string; content?: unknown };
		if (message.role === "user") {
			const text = textOf(message.content);
			if (text !== learner || teachChars || teachTools) newTurn(text);
			return;
		}
		if (message.role !== "assistant" || !Array.isArray(message.content)) return;
		deps.resume();
		const blocks = (message.content as Block[]).map((b) => b?.type === "toolCall"
			? { ...b, arguments: { ...(b.arguments ?? {}) } } : { ...b });
		const prose = blocks.reduce((n, b) => n + (b.type === "text" ? (b.text ?? "").trim().length : 0), 0);
		teachChars += prose;
		// Simulate this message's tool calls in order: a challenge shown with this text makes its answer private now,
		// while an attempt in this message means the learner already answered.
		const answered = new Set<string>();
		const upcoming: AnswerSource[] = [];
		let tools = teachTools;
		for (const b of blocks) {
			if (b.type !== "toolCall") continue;
			const args = b.arguments!;
			if (b.name === "psi_attempt" && typeof args.challengeId === "string") answered.add(args.challengeId);
			if (b.name === "psi_run" || (b.name === "psi_lesson" && (args.action === "show" || args.action === "write"))) tools++;
			if (b.name !== "psi_challenge" || mustTeach(teachChars, tools)) continue;
			if (args.action === "next") {
				const skill = typeof args.skill === "string" ? args.skill : deps.state.skill;
				const next = skill ? attempt(() => deps.practice.nextChallenge(skill,
					{ subskillId: typeof args.subskillId === "string" ? args.subskillId : undefined })) : undefined;
				if (next) upcoming.push(next.challenge);
			} else if (typeof args.expected === "string") {
				upcoming.push({ id: "pending", prompt: String(args.prompt ?? ""), expected: args.expected,
					acceptable: Array.isArray(args.acceptable) ? args.acceptable.filter((v) => typeof v === "string") : undefined,
					format: args.format as Challenge["format"], unit: typeof args.unit === "string" ? args.unit : undefined });
			}
		}
		const open = unspoken([...openChallenges(answered), ...upcoming.filter((c) => !answered.has(c.id))]);
		const skill = deps.state.skill ?? attempt(() => deps.practice.activeSession()?.skill);
		const count = skill ? attempt(() => sources.list(skill).length) : undefined;
		let changed = false, hidden = 0;
		const removed: number[] = [];
		for (const b of blocks) {
			if (b.type === "text" && typeof b.text === "string") {
				const r = redactAnswers(b.text, open, learnerTexts);
				const c = count === undefined ? { text: r.text, removed: [] } : fixCitations(r.text, count);
				hidden += r.count;
				removed.push(...c.removed);
				if (c.text !== b.text) { b.text = c.text; changed = true; }
			} else if (b.type === "toolCall" && b.name === "psi_next_steps") {
				changed = guardNextSteps(b.arguments!, open, "message") || changed;
			} else if (b.type === "toolCall" && b.name === "psi_ask") {
				changed = guardAsk(b.arguments!, open, "message") || changed;
			}
		}
		if (hidden) fire("spoiler", { where: "text", count: hidden, challengeIds: open.map((c) => c.id) });
		if (removed.length) {
			const lastText = blocks.findLast((b) => b.type === "text");
			if (lastText) lastText.text = `${(lastText.text ?? "").replace(/\s+$/, "")}\n\n${CITATION_NOTE}`;
			fire("citation-removed", { numbers: [...new Set(removed)], sourceCount: count, skill });
		}
		if (!changed) return;
		return { message: { ...event.message, content: blocks } as unknown as typeof event.message };
	});
	pi.on("tool_call", async (event) => {
		const input = event.input as Record<string, unknown>;
		switch (event.toolName) {
			case "psi_run": teachTools++; return;
			case "psi_lesson": if (input.action === "show" || input.action === "write") teachTools++; return;
			case "psi_attempt": if (typeof input.challengeId === "string") pending.add(input.challengeId); return;
			case "psi_challenge":
				if (!mustTeach()) return;
				fire("teach-first", { learner: learner.slice(0, 120), teachChars, action: input.action ?? "create" });
				return { block: true, reason: TEACH_FIRST };
			case "psi_next_steps": guardNextSteps(input, unspoken(openChallenges()), "tool_call"); return;
			case "psi_ask": guardAsk(input, unspoken(openChallenges()), "tool_call"); return;
		}
	});
	pi.on("tool_result", async (event) => {
		const details = event.details as { challengeId?: unknown; skill?: unknown; outcome?: unknown; missing?: unknown };
		const input = event.input;
		if (event.toolName === "psi_challenge" && !event.isError && typeof details?.challengeId === "string"
			&& typeof details.skill === "string") {
			presented = { skill: details.skill, id: details.challengeId, at: Date.now() };
			closed.delete(details.challengeId);
		}
		if (event.toolName === "psi_attempt" && typeof input.challengeId === "string") {
			pending.delete(input.challengeId);
			if (!event.isError && typeof details?.outcome === "string") closed.add(input.challengeId);
		}
		// A missing or failed lesson taught nothing; a failing psi_run demo still showed something.
		if (event.toolName === "psi_lesson" && (input.action === "show" || input.action === "write")
			&& (event.isError || details?.missing)) teachTools = Math.max(0, teachTools - 1);
	});
}
