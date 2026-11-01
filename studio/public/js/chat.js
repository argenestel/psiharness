// Server AgentHub sends pi records with seq added at top level. Also accept {seq, payload}
// and {seq, event} envelopes. Replay begins at since=0; endpoints follow AGENTS.md.
import { api, openEvents } from "./api.js";
import { parseMarkdown, renderMarkdown } from "./markdown.js";

/** Slash commands offered in the composer, with what each one does in plain words. */
export const COMMANDS = [
	["skill", "Start a skill and break it into subskills"],
	["practice", "Start a timed practice block"],
	["challenge", "Get one fresh challenge"],
	["boss", "Try a harder mixed challenge"],
	["quest", "Plan a small project to learn by building"],
	["hint", "Show a hint for the open challenge"],
	["recap", "End the block and save a recap"],
	["hours", "See your practice hours"],
	["streak", "See your practice streak"],
	["remember", "Tell psi something about how you learn"],
	["memory", "See what psi knows about you"],
	["forget", "Remove one note psi keeps"],
	["learn", "Explain a concept from the ground up"],
	["lesson", "Get the next short lesson"],
	["quiz", "Quiz yourself on the current topic"],
	["review", "Review cards that are due"],
	["map", "Show the concept map"],
	["visualize", "Draw a visual explanation"],
	["explore", "Open an interactive explorable"],
	["progress", "See your progress"],
	["tutor", "Change how the tutor teaches"],
];

/** Commands whose name starts with what follows "/" (only while the first word is still being typed). */
export function matchCommands(text) {
	const match = /^\/([\w-]*)$/.exec(String(text ?? ""));
	if (!match) return [];
	const query = match[1].toLowerCase();
	return COMMANDS.filter(([name]) => name.startsWith(query)).map(([name, description]) => ({ name, description }));
}

// [past, doing, plural?] per tool; past = null means the tool shows itself (challenge sheet, attempt result).
const TOOL_WORDS = {
	psi_memory_remember: ["Saved a note about you", "Saving a note about you", (n) => `Saved ${n} notes about you`],
	psi_memory_recall: ["Recalled what psi knows about you", "Recalling what psi knows about you"],
	psi_memory_forget: ["Removed a note about you", "Removing a note about you", (n) => `Removed ${n} notes about you`],
	psi_recap: ["Saved a recap of this session", "Saving a recap of this session"],
	psi_challenge: [null, "Writing a challenge"],
	psi_attempt: [null, "Checking your answer"],
	psi_hint: ["Showed a hint", "Finding a hint", (n) => `Showed ${n} hints`],
	psi_progress_report: ["Checked your progress", "Checking your progress"],
	read: ["Read the teaching notes", "Reading the teaching notes"],
	psi_concept_graph: ["Mapped the concepts", "Mapping the concepts"],
	psi_lesson_plan: ["Planned the lesson", "Planning the lesson"],
	psi_cards_add: ["Added review cards", "Adding review cards"],
	psi_review_next: ["Picked the next review card", "Picking the next review card"],
	psi_review_grade: ["Graded a review card", "Grading a review card", (n) => `Graded ${n} review cards`],
	psi_mastery: ["Checked your mastery", "Checking your mastery"],
	psi_storyboard: ["Drew a storyboard", "Drawing a storyboard"],
	psi_explorable: ["Built an interactive explorable", "Building an interactive explorable"],
	psi_manim: ["Rendered an animation", "Rendering an animation"],
	psi_crew: ["Asked the lesson crew", "Asking the lesson crew"],
	psi_note: ["Saved a lesson note", "Saving a lesson note", (n) => `Saved ${n} lesson notes`],
	psi_lesson: [null, "Opening the lesson"],
	psi_verify: [null, "Checking the sources"],
	psi_run: [null, "Running the code"],
	psi_next_steps: [null, "Choosing what comes next"],
	psi_ask: [null, "Thinking of a question"],
	psi_fetch: ["Read a reference page", "Reading a reference page", (n) => `Read ${n} reference pages`],
	psi_search: ["Searched for sources", "Searching for sources"],
	psi_path: ["Checked your learning path", "Checking your learning path"],
};
const ACTION_WORDS = {
	psi_skill_plan: {
		create: ["Planned your skill", "Planning your skill"],
		update: ["Updated your skill plan", "Updating your skill plan"],
		get: ["Looked at your skill plan", "Looking at your skill plan"],
		next: ["Picked your next subskill", "Picking your next subskill"],
	},
	psi_practice_session: {
		start: ["Started a practice session", "Starting a practice session"],
		stop: ["Ended the practice session", "Ending the practice session"],
		status: ["Checked the practice timer", "Checking the practice timer"],
	},
	psi_sources: {
		list: [null, "Looking up the sources"],
		add: ["Added a source", "Adding a source"],
		remove: ["Removed a source", "Removing a source"],
	},
};

/** Plain words for one tool call: { key, past (null = shown by its own widget), doing, plural? }. */
export function toolPhrase(name, args = {}) {
	const byAction = ACTION_WORDS[name];
	if (byAction) {
		const action = byAction[args?.action] ? args.action : Object.keys(byAction)[0];
		const [past, doing] = byAction[action];
		return { key: `${name}:${action}`, past, doing };
	}
	const words = TOOL_WORDS[name];
	if (words) return { key: name, past: words[0], doing: words[1], plural: words[2] };
	const label = String(name ?? "a tool");
	return { key: label, past: `Used ${label}`, doing: `Using ${label}` };
}

/** True when a finished tool reported a failure (pi error flag or a psi `{ errors: [...] }` result). */
export function toolFailed(tool) {
	const errors = tool?.result?.details?.errors;
	return !!tool?.isError || (Array.isArray(errors) && errors.length > 0);
}

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);
/** Join phrases as "A", "A and B", "A, B and C" in one sentence. */
export function joinPhrases(phrases) {
	const items = phrases.filter(Boolean).map((phrase, index) => index ? lower(phrase) : phrase);
	if (items.length < 2) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** One quiet line for every tool call in a reply, e.g. "Planned your skill and saved 2 notes about you". */
export function summarizeTools(tools = []) {
	const running = tools.filter((tool) => !tool.done);
	if (running.length) return `${toolPhrase(running.at(-1).name, running.at(-1).args).doing}…`;
	const counts = new Map();
	let failed = 0;
	for (const tool of tools) {
		if (toolFailed(tool)) { failed++; continue; }
		const phrase = toolPhrase(tool.name, tool.args);
		if (!phrase.past) continue;
		const entry = counts.get(phrase.key) ?? { phrase, n: 0 };
		entry.n++; counts.set(phrase.key, entry);
	}
	let phrases = [...counts.values()].map(({ phrase, n }) => n > 1 && phrase.plural ? phrase.plural(n) : phrase.past);
	if (phrases.length > 3) phrases = [...phrases.slice(0, 2), `${phrases.length - 2} more steps`];
	const failure = failed === 0 ? "" : failed === 1 ? "One step didn't work" : `${failed} steps didn't work`;
	const summary = joinPhrases(phrases);
	return summary && failure ? `${summary}. ${failure}` : summary || failure;
}

const COMMAND_ECHOES = [
	// The challenge card's own notes to the tutor: show the learner's words, not the challenge id.
	[/^Answered challenge \S+: ([\s\S]*?) \((?:success|partial|fail|skipped|pending), \+\d+ XP\)(?:\. [^\n]*)?$/,
		(m) => `My answer: ${m[1]}`],
	[/^Lesson for challenge \S+ \(I missed it with "[\s\S]*"\): ([\s\S]+)$/, (m) => `What I'll try differently: ${m[1]}`],
	[/^Help me learn ("(?:\\.|[^"\\])*")\. Active skill slug:/, (m) => `/skill ${unquote(m[1])}`],
	[/^Help me learn ("(?:\\.|[^"\\])*") \(topic:/, (m) => `/learn ${unquote(m[1])}`],
	[/^Practice session started for [^;]+; focus: ("(?:\\.|[^"\\])*")/, (m) => {
		const focus = unquote(m[1]);
		return focus === "next subskill" ? "/practice" : `/practice ${focus}`;
	}],
	[/^Active skill: [^\n]*?Create one new psi_challenge/, () => "/challenge"],
	[/^Active skill: [^\n]*?Create one harder boss challenge/, () => "/boss"],
	[/^Active skill: [^\n]*?Design a small build-to-learn project/, () => "/quest"],
	[/^Active skill: [^\n]*?Stop the active practice session/, () => "/recap"],
	[/^Teach (\S+) in topic /, (m) => `/lesson ${m[1]}`],
	[/^Topic: [^\n]*?\. Focus: [^\n]*?\. Quiz me/, () => "/quiz"],
	[/^Topic: [^\n]*?\. Focus: [^\n]*?\. Drill my due cards/, () => "/review"],
	[/^Topic: [^\n]*?\. Focus: [^\n]*?\. Build an intuition-first/, () => "/visualize"],
	[/^Topic: [^\n]*?\. Focus: [^\n]*?\. Build a slider-driven/, () => "/explore"],
	[/^Topic: [^\n]*?\. Focus: [^\n]*?\. Build a full multi-agent/, () => "/crew"],
	[/^Run psi_verify for this claim \(data\): ("(?:\\.|[^"\\])*")/, (m) => `/verify ${unquote(m[1])}`],
];
function unquote(json) { try { return JSON.parse(json); } catch { return json.slice(1, -1); } }
/**
 * Slash commands reach pi as long generated instructions. Show the learner what they typed instead:
 * returns e.g. "/skill python" for a recognised template, undefined for ordinary messages.
 */
export function commandEcho(text) {
	const value = String(text ?? "");
	for (const [pattern, label] of COMMAND_ECHOES) {
		const match = pattern.exec(value);
		if (match) return label(match);
	}
	return value.length > 160 && /\bpsi_[a-z_]+\b/.test(value) ? "Ran a psi command" : undefined;
}

/** Three concrete first messages for an empty chat, tailored to a skill plan when there is one. */
export function starterPrompts(plan) {
	const title = typeof plan?.title === "string" && plan.title.trim() ? plan.title.trim() : undefined;
	if (!title) {
		return ["I want to get good at Python. Plan the first 20 hours with me.",
			"Give me a quick challenge so we can see where I am.",
			"Explain recursion with one small example, then quiz me."];
	}
	const subskills = Array.isArray(plan.subskills) ? [...plan.subskills] : [];
	subskills.sort((a, b) => (a?.priority ?? 9) - (b?.priority ?? 9));
	const next = subskills.find((item) => item?.status !== "solid" && typeof item?.title === "string")?.title;
	if (!next) {
		return [`Give me a warm-up challenge in ${title}.`, `Start a 20-minute practice session on ${title}.`,
			`What should I practice next in ${title}?`];
	}
	return [`Give me a warm-up challenge for “${next}”.`,
		`Start a 20-minute practice session on ${title}.`,
		`Explain the key idea behind “${next}” with one small example, then quiz me.`];
}

/** Group messages into turns: each user message alone, consecutive assistant messages (and their tools) together. */
export function groupTurns(messages = [], tools = []) {
	const groups = [], groupOf = [];
	messages.forEach((message, index) => {
		if (message.role === "user" || !groups.length || groups.at(-1).role === "user") {
			groups.push({ key: `m${index}`, role: message.role, messages: [], tools: [] });
		}
		groups.at(-1).messages.push(index);
		groupOf[index] = groups.length - 1;
	});
	for (const tool of tools) {
		let group = groups[groupOf[tool.turn]];
		if (!group || group.role !== "assistant") {
			group = groups.findLast((item) => item.role === "assistant");
			if (!group || groups.at(-1).role === "user") {
				group = groups.at(-1)?.role === "assistant" ? groups.at(-1)
					: { key: `t${tool.id}`, role: "assistant", messages: [], tools: [] };
				if (group !== groups.at(-1)) groups.push(group);
			}
		}
		group.tools.push(tool);
	}
	return groups;
}

const eventOf = (record) => record.payload ?? record.event ?? record;
const contentOf = (message) => typeof message?.content === "string"
	? [{ type: "text", text: message.content }] : message?.content ?? [];
const textOf = (blocks, type) => blocks.filter((block) => block?.type === type)
	.map((block) => block[type === "thinking" ? "thinking" : "text"] ?? "").join("\n");

/** Pure immutable projection of pi's documented JSON/RPC events. */
export function reduceRecord(state = {}, record) {
	if (record.seq !== undefined && record.seq <= (state.seq ?? 0)) return state;
	const next = { messages: [], tools: [], busy: false, hud: {}, ...state,
		seq: record.seq ?? state.seq ?? 0 };
	const event = eventOf(record);
	if (event.type === "agent_start") next.busy = true;
	if (["agent_settled", "agent_error", "agent_exit"].includes(event.type)) next.busy = false;
	if (event.type === "response" && event.command === "prompt"
		&& (event.success === false || event.data?.disposition === "handled")) next.busy = false;
	if (event.type === "message_start" && ["user", "assistant"].includes(event.message?.role)) {
		const blocks = contentOf(event.message);
		next.messages = [...next.messages, { role: event.message.role, blocks, text: textOf(blocks, "text"),
			thinking: textOf(blocks, "thinking"), done: false }];
		if (event.message.role === "assistant") next.busy = true;
	}
	if (event.type === "message_update") {
		const index = next.messages.findLastIndex((message) => message.role === "assistant" && !message.done);
		if (index >= 0) {
			const update = event.assistantMessageEvent ?? {}, message = next.messages[index];
			const blocks = message.blocks.map((block) => ({ ...block }));
			const at = update.contentIndex ?? 0;
			if (/^(text|thinking)_(start|delta|end)$/.test(update.type)) {
				const type = update.type.split("_")[0], key = type === "text" ? "text" : "thinking";
				blocks[at] = { type, [key]: update.type.endsWith("_end") ? update.content
					: (blocks[at]?.[key] ?? "") + (update.delta ?? "") };
			}
			if (update.type === "toolcall_end") blocks[at] = { ...update.toolCall };
			next.messages = next.messages.map((item, i) => i === index ? { ...message, blocks,
				text: textOf(blocks, "text"), thinking: textOf(blocks, "thinking") } : item);
		}
	}
	if (event.type === "message_end" && ["user", "assistant"].includes(event.message?.role)) {
		const index = next.messages.findLastIndex((message) => message.role === event.message.role && !message.done);
		const blocks = contentOf(event.message);
		const message = { role: event.message.role, blocks, text: textOf(blocks, "text"),
			thinking: textOf(blocks, "thinking"), done: true, error: event.message.errorMessage,
			...(event.message.stopReason ? { stopReason: event.message.stopReason } : {}) };
		next.messages = index < 0 ? [...next.messages, message] : next.messages.map((item, i) => i === index ? message : item);
	}
	if (event.type.startsWith("tool_execution_")) {
		const index = next.tools.findIndex((tool) => tool.id === event.toolCallId);
		const previous = next.tools[index] ?? { id: event.toolCallId,
			turn: next.messages.findLastIndex((message) => message.role === "assistant") };
		const call = next.messages.flatMap((message) => message.blocks).find((block) => block?.id === event.toolCallId);
		const tool = { ...previous, name: event.toolName ?? previous.name,
			args: event.args ?? previous.args ?? call?.arguments ?? {},
			result: event.result ?? event.partialResult ?? previous.result,
			done: event.type === "tool_execution_end", isError: !!event.isError };
		next.tools = index < 0 ? [...next.tools, tool] : next.tools.map((item, i) => i === index ? tool : item);
	}
	if (event.type === "extension_ui_request" && ["setStatus", "setWidget"].includes(event.method)) {
		const key = `${event.method}:${event.statusKey ?? event.widgetKey}`;
		next.hud = { ...next.hud, [key]: event.statusText ?? event.widgetLines?.join("\n") ?? "" };
	}
	// The chat's model: pi's get_state answer at start, then any psi_model_switched record.
	if (event.type === "psi_model_switched" && event.model) next.model = String(event.model);
	if (event.type === "response" && event.command === "get_state" && event.data?.model?.provider && event.data.model.id) {
		next.model = `${event.data.model.provider}/${event.data.model.id}`;
	}
	return next;
}

/**
 * Consecutive assistant turns that failed with the same error (a model timing out on every retry) show as one
 * notice with a count. Returns index → count for the message that shows it, and 0 for the ones folded into it.
 */
export function errorRuns(messages = []) {
	const counts = new Map();
	let run, lastUser;
	messages.forEach((message, index) => {
		// Retrying resends the same message; that keeps the run going instead of starting a new notice.
		if (message?.role === "user") {
			const same = run && String(message.text ?? "") === lastUser;
			lastUser = String(message.text ?? "");
			if (same) return;
		}
		const text = String(message?.text ?? "").trim();
		const key = message?.role === "assistant" && message.error && message.stopReason !== "aborted" && !text
			? String(message.error) : undefined;
		if (key && run?.key === key) {
			counts.set(run.last, 0);
			run.last = index; run.n++;
			counts.set(index, run.n);
		} else if (key) {
			run = { key, last: index, n: 1 };
			counts.set(index, 1);
		} else if (message?.role === "user" || text) run = undefined;
	});
	// An error the tutor recovered from (pi retried and then answered in the same turn) is no longer news.
	for (const [index, count] of counts) {
		if (!count) continue;
		for (let next = index + 1; next < messages.length && messages[next]?.role !== "user"; next++) {
			if (messages[next]?.role === "assistant" && String(messages[next].text ?? "").trim()) { counts.set(index, 0); break; }
		}
	}
	return counts;
}

/** The text to resend on Retry: the learner's last message as pi received it. */
export function lastUserMessage(messages = [], fallback = "") {
	const text = [...messages].reverse().find((message) => message?.role === "user")?.text;
	return typeof text === "string" && text.trim() ? text : fallback;
}

/** Copy for a failed request: network failures get the fixed "couldn't reach" sentence. */
export function sendErrorText(error) {
	const message = String(error?.message ?? "");
	if (!message || error?.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(message)) {
		return "Couldn't reach the tutor. Check that psi web is running, then retry.";
	}
	return `The tutor couldn't take that message: ${message.replace(/\.$/, "")}. Retry, or reload the page.`;
}

// ───────────────────────────────────────── continuous lessons: replies, checks, tutor mode ──

/** The reply offered after a teaching turn that brought no options of its own. */
export const DEFAULT_REPLIES = [{ label: "Continue", message: "Continue" }];

const sameReply = (a, b) => String(a ?? "").trim().replace(/[.!]+$/, "").toLowerCase()
	=== String(b ?? "").trim().replace(/[.!]+$/, "").toLowerCase();
/**
 * What a row of reply buttons shows. `nextUserText` is the learner's next message after this turn
 * (undefined while the turn is the latest). Returns { mode: "active"|"waiting"|"sent"|"chosen"|"hidden", chosen? }.
 */
export function replyRowState({ options = [], nextUserText, busy = false, chosen } = {}) {
	if (nextUserText === undefined) {
		if (chosen) return { mode: "sent", chosen };
		return { mode: busy ? "waiting" : "active" };
	}
	const match = options.find((option) => sameReply(option.message, nextUserText) || sameReply(option.label, nextUserText));
	return match ? { mode: "chosen", chosen: match.label } : { mode: "hidden" };
}

const SHOWS_ITS_OWN_REPLIES = new Set(["psi_challenge", "psi_ask", "psi_next_steps"]);
/** A finished turn that taught something (a lesson, a demo run, or a real explanation) and so earns a Continue. */
export function isTeachingTurn({ text = "", tools = [], error = false } = {}) {
	if (error) return false;
	const names = tools.map((tool) => tool?.name);
	if (names.some((name) => SHOWS_ITS_OWN_REPLIES.has(name))) return false;
	if (names.some((name) => name === "psi_lesson" || name === "psi_run")) return true;
	return String(text).trim().length >= 160;
}

const FILLER = /^(let'?s|let us|great|nice|good|ok|okay|sure|alright|all right|here|now|next|so|welcome|hi|hello|thanks|yes|no|well)\b/i;
function plainSentence(text) {
	return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|\*|_|`)/g, "")
		.replace(/\s*(?:\[\d{1,2}(?:\s*[,–-]\s*\d{1,2})*\])+/g, "").replace(/\s+/g, " ").trim();
}
/**
 * The sentence "Check this" verifies when nothing is selected: the first cited sentence, else the first
 * statement of six words or more that isn't a question or a pleasantry. Code, headings and lists are skipped.
 */
export function mainClaim(markdown) {
	const prose = String(markdown ?? "").replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, "\n\n").split(/\n{2,}/)
		.map((block) => block.trim()).filter((block) => block && !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|\||\$\$)/.test(block));
	const sentences = prose.flatMap((block) => block.replace(/\n/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9`*_"“(])/));
	const statement = (s) => !/\?\s*$/.test(s) && plainSentence(s).split(" ").length >= 6 && !FILLER.test(plainSentence(s));
	const cited = sentences.find((s) => /(?<![\p{L}\p{N}_\]])\[\d{1,2}\]/u.test(s) && !/\?\s*$/.test(s));
	const pick = cited ?? sentences.find(statement) ?? sentences.find((s) => plainSentence(s).length >= 12) ?? "";
	const claim = plainSentence(pick);
	return claim.length > 300 ? `${claim.slice(0, 297).trimEnd()}…` : claim;
}
/** The message "Check this" sends: "/verify <claim>" on one line, or "" when there is nothing to check. */
export function verifyMessage(claim) {
	const text = String(claim ?? "").replace(/\s+/g, " ").trim();
	if (!text) return "";
	return `/verify ${text.length > 400 ? `${text.slice(0, 399).trimEnd()}…` : text}`;
}

/** Tutor modes in the composer switch: [value, label, what changes]. */
export const TUTOR_MODES = [
	["teach", "Teach", "more explanation, fewer questions."],
	["practice", "Practice", "a short lesson, then challenges."],
	["test", "Test", "challenges only, for review."],
];
/** The pencil line shown when the mode changes, e.g. "Mode: Teach — more explanation, fewer questions." */
export function modeLine(mode) {
	const entry = TUTOR_MODES.find(([value]) => value === mode);
	return entry ? `Mode: ${entry[1]} — ${entry[2]}` : "";
}

/** Set a reply row's display from replyRowState(). */
export function setReplyState(row, { mode, chosen }) {
	row.dataset.state = mode;
	row.hidden = mode === "hidden" || mode === "waiting";
	const buttons = row.querySelectorAll(".psi-reply");
	for (const item of buttons) {
		item.disabled = mode !== "active";
		item.classList.toggle("is-chosen", !!chosen && item.textContent === chosen);
	}
	const words = row.querySelector(".psi-replies-chosen");
	const collapsed = mode === "chosen";
	row.querySelector(".psi-replies-buttons").hidden = collapsed;
	row.querySelector(".psi-replies-keys").hidden = mode !== "active";
	if (words) { words.hidden = !collapsed; words.textContent = collapsed ? `You picked: ${chosen}` : ""; }
}

/**
 * A row of one-click replies (Alt+1…4). Clicking sends the option's message through `ctx.send`; the chat then
 * keeps only the latest turn's row active and collapses older ones to what was picked.
 */
export function replyRow(options, ctx = {}, { source = "default" } = {}) {
	const row = make("div", "psi-replies");
	row.dataset.source = source;
	row.setAttribute("role", "group");
	row.setAttribute("aria-label", "Ways to carry on");
	row.psiOptions = options;
	const buttons = make("div", "psi-replies-buttons");
	options.slice(0, 4).forEach((option, index) => {
		const item = make("button", index === 0 ? "psi-reply is-first" : "psi-reply", option.label);
		item.type = "button";
		item.setAttribute("aria-keyshortcuts", `Alt+${index + 1}`);
		item.addEventListener("click", () => { void pick(option); });
		buttons.append(item);
	});
	const count = Math.min(4, options.length);
	const keys = make("p", "psi-replies-keys", count > 1 ? `Alt+1 to ${count} picks one` : "Alt+1 picks it");
	keys.setAttribute("aria-hidden", "true");
	const chosen = make("p", "psi-replies-chosen"); chosen.hidden = true;
	row.append(buttons, keys, chosen);
	setReplyState(row, { mode: "active" });
	async function pick(option) {
		if (row.dataset.state !== "active") return;
		row.dataset.chosen = option.label;
		setReplyState(row, { mode: "sent", chosen: option.label });
		try { await ctx.send?.(option.message); }
		catch { delete row.dataset.chosen; setReplyState(row, { mode: "active" }); }
	}
	return row;
}

function make(tag, className, text) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}
function button(text, action, className = "") {
	const el = make("button", className, text); el.type = "button"; el.addEventListener("click", action); return el;
}
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// The shell's ui.js provides toast/emit; the chat still works if it is missing.
const uiModule = import("./ui.js").catch(() => ({}));
let ui = {};
uiModule.then((module) => { ui = module; });
function emit(name, detail) { uiModule.then((module) => { try { module.emit?.(name, detail); } catch { /* optional */ } }); }

/** Mount an isolated conversation, with its own SSE subscription and composer. */
export function mountChat(el, options = {}) {
	let state = {}, chatId = options.chatId, destroyed = false, closeEvents, following = true;
	let connected = false, everConnected = false, submitting = false, activeDialog, requestTimer, lastSent = "";
	let emptyReady = false, suggestionIndex = 0, notice;
	const groupViews = new Map(), messageViews = new Map(), toolViews = new Map();
	const dialogs = [], seenDialogs = new Set(), timers = new Set(), liveTools = new Set(), cleanups = [];

	const root = make("section", "psi-chat"); root.setAttribute("aria-label", "Conversation with psi");
	const scroller = make("div", "psi-chat-scroll"), column = make("div", "psi-chat-column");
	scroller.setAttribute("aria-label", "Messages"); scroller.tabIndex = 0;
	const empty = make("div", "psi-chat-empty"); empty.hidden = true;
	const pending = make("div", "psi-turn psi-turn-assistant psi-pending");
	pending.append(make("div", "psi-part psi-streaming"));
	pending.firstChild.append(make("div", "psi-markdown")); pending.hidden = true;
	pending.setAttribute("aria-label", "psi is replying");
	column.append(empty); scroller.append(column);
	const live = make("div", "psi-sr-only"); live.setAttribute("aria-live", "polite");
	const jump = button("Jump to latest", () => { following = true; toBottom(true); }, "psi-jump");
	jump.hidden = true;

	const dock = make("div", "psi-dock");
	const form = make("form", "psi-composer");
	const suggestions = make("div", "psi-slash"); suggestions.hidden = true;
	const pills = make("ul", "psi-slash-list"); pills.id = `psi-slash-${Math.random().toString(36).slice(2, 8)}`;
	pills.setAttribute("role", "listbox"); pills.setAttribute("aria-label", "Commands");
	const pillHint = make("p", "psi-slash-hint");
	suggestions.append(pills, pillHint);
	const box = make("div", "psi-composer-box");
	const input = make("textarea"); input.rows = 1; input.placeholder = "Answer, ask, or type / for commands";
	input.setAttribute("aria-label", "Message psi"); input.setAttribute("aria-autocomplete", "list");
	input.setAttribute("aria-controls", pills.id); input.setAttribute("aria-expanded", "false");
	const submit = make("button", "psi-send", "Send"); submit.type = "submit"; submit.disabled = true;
	const stop = button("Stop", () => {
		api.post(path("abort")).catch((error) => showNotice(sendErrorText(error)));
	}, "psi-stop");
	stop.hidden = true;
	box.append(input, submit, stop);
	const status = make("p", "psi-chat-status", "Connecting…"); status.setAttribute("role", "status");
	// Composer footer: the quiet model control (added once the chat id is known) and the connection status.
	const foot = make("div", "psi-composer-foot");
	let picker;
	foot.append(status);
	form.append(suggestions, box, foot);
	dock.append(jump, form);
	root.append(scroller, dock, live); el.replaceChildren(root);

	const path = (suffix) => `/api/chat/${encodeURIComponent(chatId)}/${suffix}`;
	const schedule = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
	function toast(message, opts = {}) {
		if (destroyed || !message) return;
		if (typeof ui.toast === "function") { ui.toast(String(message), opts); return; }
		live.textContent = String(message);
	}

	// Fill from the chat's top edge to the bottom of the window, so the composer stays pinned whatever the shell does.
	function fit() {
		if (destroyed || !root.isConnected) return;
		const top = root.getBoundingClientRect().top + (globalThis.scrollY ?? 0);
		const height = (globalThis.visualViewport?.height ?? globalThis.innerHeight) - Math.max(0, top);
		root.style.setProperty("--psi-chat-fit", `${Math.max(320, Math.floor(height))}px`);
	}
	const onResize = () => { fit(); if (following) toBottom(); };
	globalThis.addEventListener?.("resize", onResize);
	globalThis.visualViewport?.addEventListener("resize", onResize);
	cleanups.push(() => {
		globalThis.removeEventListener?.("resize", onResize);
		globalThis.visualViewport?.removeEventListener("resize", onResize);
	});
	requestAnimationFrame(fit); schedule(fit, 400);
	if (typeof ResizeObserver === "function") {
		const observer = new ResizeObserver(() => { if (following) toBottom(); else updateJump(); });
		observer.observe(column); cleanups.push(() => observer.disconnect());
	}

	function showNotice(text, retry) {
		notice?.remove();
		notice = make("div", "psi-notice"); notice.setAttribute("role", "alert");
		notice.append(make("p", "", text));
		if (retry) notice.append(button("Retry", () => { notice?.remove(); notice = undefined; retry(); }, "psi-secondary"));
		column.append(notice); toBottom();
	}
	function clearNotice() { notice?.remove(); notice = undefined; }

	async function send(text) {
		if (!chatId || destroyed || submitting || !String(text).trim()) return;
		submitting = true; lastSent = text; clearNotice(); state = { ...state, busy: true }; render();
		try {
			const response = await api.post(path("prompt"), { message: text });
			if (response?.data?.disposition === "handled" || response?.disposition === "handled") {
				state = { ...state, busy: false }; render();
			}
		} catch (error) {
			state = { ...state, busy: false }; render();
			showNotice(sendErrorText(error), () => { send(text).catch(() => {}); });
			throw error;
		} finally { submitting = false; }
	}
	const ctx = { get chatId() { return chatId; }, send, api, toast };

	function updateMarkdown(view, text) {
		if (view.text === text) return;
		const blocks = parseMarkdown(text);
		let keep = 0;
		while (keep < blocks.length && keep < view.raw.length && blocks[keep].raw === view.raw[keep]) keep++;
		while (view.body.children.length > keep) view.body.lastElementChild.remove();
		for (const block of blocks.slice(keep)) {
			const wrapper = make("div", "psi-markdown-block"); wrapper.append(renderMarkdown(block.raw)); view.body.append(wrapper);
		}
		view.raw = blocks.map((block) => block.raw); view.text = text;
	}
	function groupView(group) {
		let view = groupViews.get(group.key);
		if (view) return view;
		const article = make("article", `psi-turn psi-turn-${group.role}`);
		article.setAttribute("aria-label", group.role === "user" ? "You said" : "psi replied");
		view = { article, role: group.role };
		if (group.role === "assistant") {
			const reasoning = make("details", "psi-reasoning"); reasoning.hidden = true;
			const reasoningText = make("div", "psi-reasoning-text");
			reasoning.append(make("summary", "", "Show reasoning"), reasoningText);
			reasoning.addEventListener("toggle", () => {
				reasoning.firstChild.textContent = reasoning.open ? "Hide reasoning" : "Show reasoning";
			});
			const activity = make("details", "psi-activity"); activity.hidden = true;
			const activityLine = make("summary"), activityList = make("ul", "psi-activity-list");
			activity.append(activityLine, activityList);
			const parts = make("div", "psi-parts");
			article.append(activity, reasoning, parts);
			Object.assign(view, { reasoning, reasoningText, activity, activityLine, activityList, parts });
		}
		column.insertBefore(article, pending.isConnected ? pending : null);
		groupViews.set(group.key, view);
		return view;
	}
	function messageView(index, message, group) {
		let view = messageViews.get(index);
		if (view) return view;
		const gv = groupView(group);
		if (message.role === "user") {
			const bubble = make("div", "psi-user-bubble");
			gv.article.append(bubble);
			view = { bubble, text: null };
		} else {
			const part = make("div", "psi-part"), body = make("div", "psi-markdown"), widgets = make("div", "psi-widgets");
			const error = make("div", "psi-part-error"); error.hidden = true;
			part.append(body, error, widgets); gv.parts.append(part);
			view = { part, body, widgets, error, raw: [], text: null, errorKey: null };
		}
		messageViews.set(index, view);
		return view;
	}
	function renderUser(view, message) {
		const label = commandEcho(message.text);
		const shown = label ?? message.text;
		if (view.text === shown) return;
		view.text = shown;
		view.bubble.textContent = shown;
		view.bubble.classList.toggle("is-command", !!label && label.startsWith("/"));
	}
	function renderAssistant(view, message, streaming, repeats = 1) {
		updateMarkdown(view, message.text);
		view.part.classList.toggle("psi-streaming", streaming);
		const error = message.error && message.stopReason !== "aborted" && repeats > 0 ? message.error : null;
		view.part.hidden = !message.text && !streaming && !error && message.stopReason !== "aborted"
			&& !view.widgets.childElementCount;
		const errorKey = error ? `${repeats}:${error}` : message.stopReason === "aborted" ? "aborted" : null;
		if (view.errorKey === errorKey) return;
		view.errorKey = errorKey; view.error.replaceChildren(); view.error.hidden = !errorKey;
		if (errorKey === "aborted") { view.error.className = "psi-part-stopped"; view.error.textContent = "Stopped."; }
		else if (errorKey) {
			view.error.className = "psi-part-error psi-notice";
			const times = repeats > 1 ? ` (${repeats} times in a row)` : "";
			view.error.append(make("p", "", `The tutor ran into a problem: ${String(error).replace(/\.$/, "")}${times}. `
				+ "Retry to send your last message again."));
			view.error.append(button("Retry", () => retry(), "psi-secondary"));
		}
	}
	function lastUserText() { return lastUserMessage(state.messages ?? [], lastSent); }
	function retry() {
		const text = lastUserText();
		if (!text || state.busy || submitting) return;
		send(text).catch(() => {});
	}
	function renderActivity(view, tools) {
		const line = summarizeTools(tools);
		view.activity.hidden = !line;
		view.activity.classList.toggle("is-running", tools.some((tool) => !tool.done));
		if (view.activityLine.textContent !== line) view.activityLine.textContent = line;
		const signature = tools.map((tool) => `${tool.id}:${tool.done}:${toolFailed(tool)}`).join("|");
		if (view.activitySignature === signature) return;
		view.activitySignature = signature;
		// Challenge and attempt calls show themselves (and their arguments would spoil the answer).
		const listed = tools.filter((tool) => toolPhrase(tool.name, tool.args).past || toolFailed(tool));
		view.activityList.replaceChildren(...listed.map((tool) => {
			const phrase = toolPhrase(tool.name, tool.args);
			const item = make("li");
			const title = tool.done ? toolFailed(tool) ? `${phrase.past ?? phrase.doing} (didn't work)` : phrase.past ?? `${phrase.doing}: done`
				: `${phrase.doing}…`;
			item.append(make("p", "psi-activity-title", title));
			const details = make("pre", "psi-activity-detail");
			details.textContent = toolDetail(tool);
			if (details.textContent) item.append(details);
			return item;
		}));
	}
	function render() {
		if (destroyed) return;
		const messages = state.messages ?? [];
		const groups = groupTurns(messages, state.tools ?? []);
		const streamingIndex = state.busy ? messages.findLastIndex((message) => message.role === "assistant" && !message.done) : -1;
		const repeats = errorRuns(messages);
		for (const group of groups) {
			const gv = groupView(group);
			for (const index of group.messages) {
				const message = messages[index], view = messageView(index, message, group);
				if (message.role === "user") renderUser(view, message);
				else renderAssistant(view, message, index === streamingIndex, repeats.get(index) ?? 1);
			}
			if (group.role !== "assistant") continue;
			// Reasoning behind a new challenge usually contains its answer, so those turns offer none.
			const spoils = group.tools.some((tool) => tool.name === "psi_challenge");
			const thinking = spoils ? "" : group.messages.map((index) => messages[index].thinking).filter(Boolean).join("\n\n");
			gv.reasoning.hidden = !thinking;
			if (gv.reasoningText.textContent !== thinking) gv.reasoningText.textContent = thinking;
			renderActivity(gv, group.tools);
			for (const tool of group.tools) renderTool(tool, gv, group);
		}
		// While waiting for the first token of a reply, show the caret alone.
		const last = groups.at(-1);
		const waiting = !!state.busy && streamingIndex < 0
			&& !(last?.role === "assistant" && last.tools.some((tool) => !tool.done));
		if (waiting && !pending.isConnected) column.append(pending);
		pending.hidden = !waiting;
		if (notice && notice.nextSibling) column.append(notice);
		const showEmpty = emptyReady && connected && !messages.length && !state.busy && !notice;
		if (showEmpty && !empty.childElementCount) buildEmpty();
		empty.hidden = !showEmpty;
		const statusText = !chatId ? "Starting a conversation…" : connected ? ""
			: everConnected ? "Connection lost. Reconnecting…" : "Connecting…";
		if (status.textContent !== statusText) status.textContent = statusText;
		status.hidden = !statusText;
		stop.hidden = !state.busy; submit.hidden = !!state.busy;
		submit.disabled = !chatId || !connected;
		root.classList.toggle("is-busy", !!state.busy);
		if (following) toBottom(); else updateJump();
	}
	function renderTool(tool, gv, group) {
		let view = toolViews.get(tool.id);
		const host = messageViews.get(tool.turn)?.widgets
			?? messageViews.get(group.messages.at(-1))?.widgets ?? gv.parts;
		if (!view) { view = { started: false }; toolViews.set(tool.id, view); }
		if (!tool.done || view.started) return;
		view.started = true;
		import("./widgets.js").then(async (module) => {
			if (destroyed || typeof module.renderToolWidget !== "function") return;
			const widget = await module.renderToolWidget(tool.name, tool.args, tool.result, ctx);
			if (destroyed || !widget) return;
			host.append(widget);
			const part = host.closest?.(".psi-part"); if (part) part.hidden = false;
			if (following) toBottom(); else updateJump();
		}).catch(() => {});
	}
	function buildEmpty() {
		const heading = make("h2", "", "What should we work on?");
		const lead = make("p", "", "Ask a question, answer a challenge, or start from one of these.");
		const list = make("ul", "psi-starters");
		const fill = (prompts) => list.replaceChildren(...prompts.map((prompt) => {
			const item = make("li");
			item.append(button(prompt, () => { send(prompt).catch(() => {}); }, "psi-starter"));
			return item;
		}));
		fill(starterPrompts());
		empty.replaceChildren(heading, lead, list);
		if (options.skill) {
			api.get(`/api/skills/${encodeURIComponent(options.skill)}`).then((data) => {
				if (destroyed || !data?.plan?.title) return;
				heading.textContent = `Let's work on ${data.plan.title}`;
				fill(starterPrompts(data.plan));
			}).catch(() => {});
		}
	}
	function distance() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight; }
	function updateJump() { jump.hidden = following || distance() < 48; }
	function toBottom(smooth = false) {
		if (destroyed) return;
		scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
		jump.hidden = true;
	}
	// Stop following only when the learner scrolls up; growth below or focus moving into view keeps following.
	let lastTop = 0;
	scroller.addEventListener("scroll", () => {
		const top = scroller.scrollTop;
		if (distance() < 48) following = true;
		else if (top < lastTop - 2) following = false;
		lastTop = top; updateJump();
	});

	function nextDialog() {
		if (activeDialog || destroyed || !dialogs.length) return;
		const request = dialogs.shift(), previous = document.activeElement;
		const overlay = make("div", "psi-modal-backdrop"), dialog = make("div", "psi-modal");
		const titleId = `psi-modal-${Math.random().toString(36).slice(2, 8)}`;
		dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
		dialog.setAttribute("aria-labelledby", titleId); dialog.tabIndex = -1;
		const title = make("h2", "", request.title || "psi needs your answer"); title.id = titleId;
		dialog.append(title);
		if (request.message) dialog.append(make("p", "psi-modal-message", request.message));
		let field, finished = false;
		function dismiss() {
			finished = true; clearTimeout(requestTimer); overlay.remove(); activeDialog = undefined;
			if (previous?.isConnected) previous.focus(); else input.focus();
			nextDialog();
		}
		async function answer(value) {
			if (finished || dialog.dataset.sending) return;
			dialog.dataset.sending = "1";
			const controls = dialog.querySelectorAll("button, input, textarea");
			controls.forEach((item) => { item.disabled = true; });
			try { await api.post(path("ui"), { id: request.id, ...value }); if (!destroyed) dismiss(); }
			catch (error) {
				delete dialog.dataset.sending; controls.forEach((item) => { item.disabled = false; });
				toast(sendErrorText(error), { kind: "error" });
			}
		}
		const actions = make("div", "psi-modal-actions");
		if (request.method === "select") {
			const list = make("ul", "psi-modal-options");
			for (const option of request.options ?? []) {
				const item = make("li"); item.append(button(option, () => answer({ value: option }), "psi-option"));
				list.append(item);
			}
			dialog.append(list);
			actions.append(button("Cancel", () => answer({ cancelled: true }), "psi-secondary"));
		} else if (request.method === "confirm") {
			actions.append(button("No", () => answer({ confirmed: false }), "psi-secondary"),
				button("Yes", () => answer({ confirmed: true }), "psi-primary"));
		} else {
			field = make(request.method === "editor" ? "textarea" : "input", "psi-modal-field");
			field.value = request.prefill ?? ""; field.placeholder = request.placeholder ?? "";
			field.setAttribute("aria-labelledby", titleId);
			if (request.method === "input") {
				field.addEventListener("keydown", (event) => {
					if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); answer({ value: field.value }); }
				});
			}
			dialog.append(field);
			actions.append(button("Cancel", () => answer({ cancelled: true }), "psi-secondary"),
				button("Send", () => answer({ value: field.value }), "psi-primary"));
		}
		dialog.append(actions);
		dialog.addEventListener("keydown", (event) => {
			if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); answer({ cancelled: true }); }
			if (event.key === "Tab") {
				const focusable = [...dialog.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)")];
				const index = focusable.indexOf(document.activeElement);
				if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
				else if (!event.shiftKey && (index === focusable.length - 1 || index < 0)) { event.preventDefault(); focusable[0]?.focus(); }
			}
		});
		overlay.append(dialog); root.append(overlay); activeDialog = { overlay, dismiss };
		(field ?? dialog.querySelector(".psi-option, .psi-primary") ?? dialog).focus();
		if (request.timeout > 0) requestTimer = setTimeout(dismiss, request.timeout);
	}

	function onRecord(record) {
		if (destroyed) return;
		const previous = state;
		state = reduceRecord(state, record);
		if (previous === state) return;
		const event = eventOf(record);
		if (["agent_settled", "agent_error", "agent_exit"].includes(event.type)) {
			dialogs.length = 0; activeDialog?.dismiss();
		}
		if (event.type === "agent_settled") emit("psi:chats-changed", { chatId });
		if (event.type === "psi_model_switched" && event.model) {
			// One pencil line in the conversation, in order with the turns around it.
			const line = make("p", "psi-model-line", `Switched to ${String(event.model).split("/").pop()}`);
			column.insertBefore(line, pending.isConnected ? pending : null);
		}
		if (state.model && state.model !== previous.model) picker?.setModel?.(state.model);
		if (event.type === "tool_execution_start") liveTools.add(event.toolCallId);
		// Only attempts recorded while this chat is open update the bench; replayed history does not re-animate.
		if (event.type === "tool_execution_end" && event.toolName === "psi_attempt" && !record.history
			&& liveTools.has(event.toolCallId) && !event.isError && event.result?.details && !toolFailed(event)) {
			emit("psi:attempt", { ...event.result.details, skill: event.args?.skill ?? options.skill,
				challengeId: event.args?.challengeId, source: "chat" });
		}
		if (event.type === "extension_ui_request") {
			if (["setStatus", "setWidget"].includes(event.method)) emit("psi:status", event);
			// The first replay burst can repeat old notifications; only a fresh chat shows them.
			const settledBefore = (previous.messages ?? []).some((message) => message.role === "assistant" && message.done);
			if (event.method === "notify" && !record.history && (emptyReady || !settledBefore)) {
				toast(event.message, { kind: event.notifyType === "error" ? "error" : "info" });
			}
			if (event.method === "set_editor_text") { input.value = event.text ?? ""; autosize(); }
			if (["select", "confirm", "input", "editor"].includes(event.method) && !seenDialogs.has(event.id)) {
				seenDialogs.add(event.id); dialogs.push(event); nextDialog();
			}
		}
		if (event.type === "message_end" && event.message?.role === "assistant" && !record.history) {
			live.textContent = textOf(contentOf(event.message), "text");
		}
		if (["agent_error", "rpc_error"].includes(event.type) || (event.type === "agent_exit" && event.code)) {
			showNotice("The tutor stopped unexpectedly. Retry to start it again and resend your last message.", () => retry());
		} else if (event.type === "response" && event.success === false && event.error) {
			showNotice(`The tutor couldn't run that: ${String(event.error).replace(/\.$/, "")}.`);
		}
		render();
	}

	// Composer: autosize, Enter sends, Shift+Enter newline, slash suggestions with keyboard navigation.
	function autosize() {
		input.style.height = "auto";
		input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
	}
	function showSuggestions() {
		const matches = matchCommands(input.value);
		const open = matches.length > 0;
		suggestions.hidden = !open; input.setAttribute("aria-expanded", String(open));
		if (!open) { input.removeAttribute("aria-activedescendant"); return; }
		suggestionIndex = Math.min(suggestionIndex, matches.length - 1);
		pills.replaceChildren(...matches.map((command, index) => {
			const item = make("li", index === suggestionIndex ? "is-active" : "", `/${command.name}`);
			item.id = `${pills.id}-${index}`; item.setAttribute("role", "option");
			item.setAttribute("aria-selected", String(index === suggestionIndex));
			item.addEventListener("mousedown", (event) => { event.preventDefault(); accept(command.name); });
			return item;
		}));
		pillHint.textContent = matches[suggestionIndex].description;
		input.setAttribute("aria-activedescendant", `${pills.id}-${suggestionIndex}`);
	}
	function accept(name) {
		input.value = `/${name} `; suggestionIndex = 0; showSuggestions(); autosize(); input.focus();
	}
	input.addEventListener("input", () => { suggestionIndex = 0; autosize(); showSuggestions(); });
	input.addEventListener("keydown", (event) => {
		const matches = suggestions.hidden ? [] : matchCommands(input.value);
		if (matches.length) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				suggestionIndex = (suggestionIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
				showSuggestions(); return;
			}
			if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
				event.preventDefault(); accept(matches[suggestionIndex].name); return;
			}
			if (event.key === "Escape") { event.preventDefault(); suggestions.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
		}
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (state.busy || !input.value.trim()) return;
		const text = input.value; input.value = ""; autosize(); showSuggestions(); following = true;
		try { await send(text); } catch { if (!input.value) { input.value = text; autosize(); } }
	});

	(async () => {
		try {
			if (!chatId) {
				const body = {};
				for (const key of ["skill", "topic", "model"]) if (options[key] !== undefined) body[key] = options[key];
				const chat = await api.post("/api/chat", body); chatId = chat.id;
				if (destroyed) return;
				options.onChatCreated?.(chatId);
			}
			if (destroyed) return;
			import("./models.js").then(({ modelPicker }) => {
				if (destroyed || picker) return;
				picker = modelPicker({ value: state.model ?? options.model, chatId });
				foot.prepend(picker); cleanups.push(() => picker.close?.());
			}).catch(() => { /* The chat works without the model control. */ });
			render();
			closeEvents = openEvents(chatId, { since: 0, onRecord,
				onOpen: () => {
					connected = true; everConnected = true;
					// Replayed history arrives right after the stream opens; only then is an empty chat really empty.
					schedule(() => { emptyReady = true; render(); }, 300);
					render();
				},
				onError: () => { connected = false; render(); } });
		} catch (error) {
			status.hidden = false; status.textContent = "";
			showNotice(sendErrorText(error), () => { location.reload(); });
		}
	})();
	render();
	return { destroy() {
		destroyed = true; closeEvents?.(); clearTimeout(requestTimer);
		for (const timer of timers) clearTimeout(timer);
		for (const cleanup of cleanups) cleanup();
		const focus = document.activeElement;
		activeDialog?.overlay.remove(); root.remove();
		if (focus && !focus.isConnected) el.focus?.();
	} };
}

/** Readable details for one tool call in the expanded activity list (answer keys are stripped server-side). */
export function toolDetail(tool) {
	const hidden = new Set(["expected", "acceptable", "rubric", "tests", "setup", "hints", "answer"]);
	const clip = (text, max) => text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
	const lines = [];
	for (const [key, value] of Object.entries(tool?.args ?? {})) {
		if (hidden.has(key) || value === undefined || value === null || value === "") continue;
		let shown = typeof value === "string" ? value : JSON.stringify(value);
		if (key === "path" && typeof value === "string") shown = value.split("/").slice(-2).join("/");
		lines.push(`${key}: ${clip(shown.replace(/\s+/g, " "), 140)}`);
	}
	const result = tool?.result;
	const errors = result?.details?.errors;
	const text = [typeof result === "string" ? result : "", ...(Array.isArray(result?.content) ? result.content : [])
		.filter((part) => part?.type === "text").map((part) => part.text)].filter(Boolean).join("\n").trim();
	if (Array.isArray(errors) && errors.length) lines.push(`Problem: ${errors.join("; ")}`);
	else if (text && tool?.name !== "read") lines.push(clip(text, 280));
	return lines.join("\n");
}
