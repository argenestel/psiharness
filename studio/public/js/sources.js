// Ranked, checkable references for psi web: citation markers, source lists, the source popover and verdict words.
// Pure helpers (citedNumbers, kindWords, rankSteps, verdictWords, resolveCitation) never touch the DOM.
import { parseInline, parseMarkdown } from "./markdown.js";

const KIND_WORDS = {
	"official-docs": "Official documentation", textbook: "Textbook", course: "Course material",
	paper: "Research paper", reference: "Reference work", video: "Video lecture", article: "Article",
	forum: "Forum answer",
};
/** A source kind in words, e.g. "official-docs" → "Official documentation". */
export function kindWords(kind) { return KIND_WORDS[kind] ?? "Reference"; }

/** Rank 0…100 as 1…5 steps for the small meter (0 or unknown → 0 steps). */
export function rankSteps(rank) {
	const value = Number(rank);
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.max(1, Math.min(5, Math.ceil(value / 20)));
}

function inlineCites(tokens, into) {
	for (const token of tokens ?? []) {
		if (token.type === "cite") for (const n of token.numbers) into.add(n);
		// Bold and emphasis keep their raw text; parse it again for markers.
		else if (["strong", "em"].includes(token.type)) inlineCites(parseInline(token.text, { cites: true }), into);
	}
}
function blockCites(block, into) {
	if (block.inline) inlineCites(block.inline, into);
	for (const item of block.items ?? []) inlineCites(item, into);
	for (const row of block.rows ?? []) for (const cell of row) inlineCites(cell, into);
	for (const child of block.blocks ?? []) blockCites(child, into);
}
/** Citation numbers used in markdown prose ([1], [2, 3], [1][4]), ascending; code spans and fences are ignored. */
export function citedNumbers(text) {
	const found = new Set();
	for (const block of parseMarkdown(String(text ?? ""), { cites: true })) blockCites(block, found);
	return [...found].sort((a, b) => a - b);
}

/** Always shown under a verdict: the check compares wording, so the learner reads the passages themselves. */
export const VERDICT_NOTE = "Matched by wording, not meaning — read the passages.";

/** Legacy verdicts read as the new, conservative ones. */
export function normalizeVerdict(verdict) {
	if (verdict === "supported" || verdict === "likely-supported") return "likely-supported";
	if (verdict === "contradicted" || verdict === "possibly-contradicted") return "possibly-contradicted";
	return "unclear";
}

/**
 * Conservative verdict words for a Verification: { words, mark: "check"|"cross"|"query", count, note, verdict }.
 * Support needs at least one passage or citation to point at; without one it is "Couldn't confirm".
 * Ink and pencil marks only, never red or green.
 */
export function verdictWords(verdict, citations = []) {
	const count = new Set((citations ?? []).map((c) => c?.sourceId ?? c?.url ?? c?.title).filter(Boolean)).size;
	const v = normalizeVerdict(verdict);
	const base = { count, note: VERDICT_NOTE };
	if (v === "likely-supported" && count > 0) {
		return { ...base, verdict: v, words: "The sources likely support this", mark: "check" };
	}
	if (v === "possibly-contradicted") return { ...base, verdict: v, words: "A source may contradict this", mark: "cross" };
	return { ...base, verdict: "unclear", words: "Couldn't confirm from the sources", mark: "query" };
}

/**
 * Split a passage's context around its matched sentence: [{ text, match }]. Whitespace and case differences are
 * tolerated; when the sentence isn't inside the context, only the sentence is shown (as the match).
 */
export function evidenceSegments(context, sentence) {
	const ctx = String(context ?? ""), text = String(sentence ?? "").trim();
	if (!text) return ctx ? [{ text: ctx, match: false }] : [];
	if (!ctx.trim()) return [{ text, match: true }];
	let at = ctx.indexOf(text), length = text.length;
	if (at < 0) {
		// Find the sentence ignoring runs of whitespace and case, mapping back to the original offsets.
		const pattern = text.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
		const found = new RegExp(pattern, "i").exec(ctx);
		if (found) { at = found.index; length = found[0].length; }
	}
	// Not inside the context (a stale cache or a re-split page): show the matched sentence on its own.
	if (at < 0) return [{ text, match: true }];
	return [{ text: ctx.slice(0, at), match: false }, { text: ctx.slice(at, at + length), match: true },
		{ text: ctx.slice(at + length), match: false }].filter((part) => part.text);
}

/**
 * Passages to show for a Verification, best first, at most `limit` (6): each { n, sourceId, title, url, rank,
 * locator, segments }. n follows the numbered citations (so the tutor's [n] matches); legacy results without
 * evidence fall back to their citation quotes.
 */
export function evidenceRows(d, limit = 6) {
	const citations = numbered(d?.citations);
	const order = new Map();
	for (const c of citations) if (c.sourceId && !order.has(c.sourceId)) order.set(c.sourceId, c.n);
	const numberFor = (id) => {
		if (!order.has(id)) order.set(id, Math.max(0, ...order.values()) + 1);
		return order.get(id);
	};
	const evidence = (Array.isArray(d?.evidence) ? d.evidence : []).filter((p) => p && (p.text || p.context));
	if (evidence.length) {
		return evidence.slice(0, limit).map((p) => ({ n: numberFor(p.sourceId ?? p.url ?? p.title), sourceId: p.sourceId,
			title: p.title, url: p.url, rank: p.rank,
			locator: Number.isInteger(p.sentenceIndex) ? `Sentence ${p.sentenceIndex + 1}` : "",
			segments: evidenceSegments(p.context || p.text, p.text) }));
	}
	return citations.filter((c) => c.quote).slice(0, limit).map((c) => ({ n: c.n, sourceId: c.sourceId, title: c.title,
		url: c.url, rank: c.rank, locator: c.locator ?? "", segments: evidenceSegments(c.quote, c.quote) }));
}

/** Find citation n in a numbered list (items with n, else 1-based position). */
export function resolveCitation(items, n) {
	const list = Array.isArray(items) ? items : [];
	return list.find((item) => Number(item?.n) === Number(n)) ?? (list.some((item) => item?.n != null)
		? undefined : list[Number(n) - 1]);
}

/** Numbered items for display: keeps n when present, else numbers by position. */
export function numbered(items) {
	return (Array.isArray(items) ? items : []).map((item, index) => ({ ...item, n: Number(item?.n) || index + 1 }));
}

// ─────────────────────────────────────────────────────────────── loading ──
const cache = new Map();
/** Ranked sources for one skill (GET /api/skills/:s/sources), cached per skill for this page. */
export function loadSources(skill, api) {
	if (!skill || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) return Promise.resolve([]);
	if (!cache.has(skill)) {
		const client = api ? Promise.resolve(api) : import("./api.js").then((mod) => mod.api);
		const request = client.then((c) => c.get(`/api/skills/${encodeURIComponent(skill)}/sources`))
			.then((list) => numbered(Array.isArray(list) ? list : []))
			.catch(() => { cache.delete(skill); return []; });
		cache.set(skill, request);
	}
	return cache.get(skill);
}
/** Forget cached sources (after psi_sources add/remove). */
export function forgetSources(skill) { if (skill) cache.delete(skill); else cache.clear(); }

// ──────────────────────────────────────────────────────────────── DOM ──
function node(tag, className = "", text) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = String(text);
	return el;
}
let tipId = 0;

/** The small 5-step rank meter; the plain rank reasons show on hover and keyboard focus. */
export function rankMeter(item, { tip = true } = {}) {
	const steps = rankSteps(item?.rank);
	const wrap = node("span", "psi-rank");
	wrap.tabIndex = 0;
	const reasons = (item?.rankReasons ?? []).filter(Boolean);
	const label = steps ? `Trust ${steps} of 5` : "Trust not rated";
	wrap.setAttribute("aria-label", reasons.length ? `${label}: ${reasons.join(". ")}` : label);
	const meter = node("span", "psi-rank-meter");
	meter.setAttribute("aria-hidden", "true");
	for (let i = 1; i <= 5; i++) meter.append(node("span", i <= steps ? "is-on" : ""));
	wrap.append(meter, node("span", "psi-rank-label", label));
	if (reasons.length && tip) {
		const tipEl = node("span", "psi-rank-tip");
		tipEl.id = `psi-rank-tip-${++tipId}`;
		tipEl.setAttribute("role", "tooltip");
		tipEl.setAttribute("aria-hidden", "true");
		const list = node("ul");
		for (const reason of reasons) list.append(node("li", "", reason));
		tipEl.append(list);
		wrap.append(tipEl);
	}
	return wrap;
}

function safeHref(url) {
	try { const parsed = new URL(String(url)); return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : undefined; }
	catch { return undefined; }
}

/** One source as a block: [n] title — publisher, kind in words, rank meter, link, quote. */
export function sourceEntry(item, { number = true, reasonsInline = false } = {}) {
	const entry = node("div", "psi-source");
	const head = node("p", "psi-source-head");
	if (number && item?.n != null) head.append(node("span", "psi-source-n", `[${item.n}]`));
	const title = item?.title ?? item?.sourceId ?? "Source";
	const href = safeHref(item?.url);
	const name = href ? node("a", "psi-source-title", title) : node("span", "psi-source-title", title);
	if (href) {
		name.href = href; name.target = "_blank"; name.rel = "noreferrer noopener";
		name.setAttribute("aria-label", `${title} (opens in a new tab)`);
	}
	head.append(name);
	if (item?.publisher) head.append(node("span", "psi-source-publisher", ` — ${item.publisher}`));
	entry.append(head);
	const meta = node("p", "psi-source-meta");
	if (item?.sourceMissing) meta.append(node("span", "", "This source is no longer in the skill's list."));
	else {
		if (item?.kind !== undefined || item?.rank !== undefined) {
			const meter = rankMeter(item, { tip: !reasonsInline });
			if (reasonsInline) { meter.removeAttribute("tabindex"); meter.classList.add("is-plain"); }
			meta.append(node("span", "psi-source-kind", kindWords(item?.kind)), meter);
		}
		if (item?.locator) meta.append(node("span", "psi-source-locator", item.locator));
	}
	if (meta.childElementCount) entry.append(meta);
	const reasons = (item?.rankReasons ?? []).filter(Boolean);
	if (reasonsInline && reasons.length && !item?.sourceMissing) {
		const list = node("ul", "psi-source-reasons");
		list.setAttribute("aria-label", "Why it is trusted");
		for (const reason of reasons) list.append(node("li", "", reason));
		entry.append(list);
	}
	const quote = item?.quote ?? item?.excerpt;
	if (quote) {
		const block = node("blockquote", "psi-source-quote");
		block.append(node("p", "", quote));
		entry.append(block);
	}
	return entry;
}

/** An ordered list of sources, numbered [n] (keeps each item's n). */
export function renderSourceList(items, opts = {}) {
	const list = node("ol", "psi-source-list");
	for (const item of numbered(items)) {
		const row = node("li");
		row.value = item.n;
		row.append(sourceEntry(item, opts));
		list.append(row);
	}
	return list;
}

let openPopover;
/** Close the open source popover, if any. */
export function closeSourcePopover({ restoreFocus = true } = {}) {
	const current = openPopover;
	if (!current) return;
	openPopover = undefined;
	current.cleanup();
	current.el.remove();
	current.anchor?.setAttribute?.("aria-expanded", "false");
	if (restoreFocus && current.anchor?.isConnected) current.anchor.focus();
}

/**
 * Open a popover beside a citation marker showing one source (or a "loading"/"not found" line while
 * `item` is a promise or missing). Escape, the close button and clicks outside close it. Returns { close }.
 * @param {HTMLElement} anchor
 * @param {(import("../../../core/src/types.ts").Source & {n?: number, then?: never})
 * | Promise<(import("../../../core/src/types.ts").Source & {n?: number}) | undefined> | undefined} item
 * @param {{n?: number}} [options]
 */
export function sourcePopover(anchor, item, { n } = {}) {
	if (openPopover?.anchor === anchor) { closeSourcePopover(); return { close() {} }; }
	closeSourcePopover({ restoreFocus: false });
	const pop = node("div", "psi-source-popover");
	pop.setAttribute("role", "dialog");
	pop.setAttribute("aria-label", n != null ? `Source ${n}` : "Source");
	pop.tabIndex = -1;
	const body = node("div", "psi-source-popover-body");
	const close = node("button", "psi-source-close", "Close");
	close.type = "button";
	close.addEventListener("click", () => closeSourcePopover());
	pop.append(body, close);
	const fill = (value) => {
		if (!pop.isConnected && openPopover?.el !== pop) return;
		body.replaceChildren(value ? sourceEntry({ ...value, n: value.n ?? n }, { reasonsInline: true })
			: node("p", "psi-source-missing", `Source ${n ?? ""} isn't in this skill's list, so it can't be checked here.`.replace("  ", " ")));
		place();
	};
	if (item && typeof item.then === "function") {
		body.append(node("p", "psi-source-missing", "Looking up the source…"));
		item.then(fill, () => fill(undefined));
	} else fill(item);
	document.body.append(pop);
	function place() {
		const box = anchor.getBoundingClientRect();
		const width = Math.min(360, globalThis.innerWidth - 32);
		pop.style.width = `${width}px`;
		const left = Math.max(16, Math.min(box.left - 12, globalThis.innerWidth - width - 16));
		const height = pop.offsetHeight;
		const below = box.bottom + 8;
		const top = below + height > globalThis.innerHeight - 8 && box.top - height - 8 > 8 ? box.top - height - 8 : below;
		pop.style.left = `${Math.round(left)}px`;
		pop.style.top = `${Math.round(Math.max(8, top))}px`;
	}
	place();
	const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSourcePopover(); } };
	const onDown = (event) => { if (!pop.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) closeSourcePopover({ restoreFocus: false }); };
	const onMove = () => closeSourcePopover({ restoreFocus: false });
	document.addEventListener("keydown", onKey, true);
	document.addEventListener("pointerdown", onDown, true);
	globalThis.addEventListener("resize", onMove);
	const scroller = anchor.closest?.(".psi-chat-scroll");
	scroller?.addEventListener("scroll", onMove, { passive: true });
	openPopover = { el: pop, anchor, cleanup() {
		document.removeEventListener("keydown", onKey, true);
		document.removeEventListener("pointerdown", onDown, true);
		globalThis.removeEventListener("resize", onMove);
		scroller?.removeEventListener("scroll", onMove);
	} };
	anchor.setAttribute("aria-expanded", "true");
	pop.focus({ preventScroll: true });
	return { close: () => { if (openPopover?.el === pop) closeSourcePopover(); } };
}

/**
 * Make the [n] markers inside `root` open source popovers. `lookup(n)` returns a source, a promise of one,
 * or undefined. Safe to call repeatedly: markers are wired once.
 */
export function wireCitations(root, lookup) {
	for (const marker of root.querySelectorAll?.("button.psi-cite:not([data-wired])") ?? []) {
		marker.dataset.wired = "1";
		marker.addEventListener("click", (event) => {
			event.preventDefault();
			const n = Number(marker.dataset.cite);
			sourcePopover(marker, lookup(n), { n });
		});
	}
}
