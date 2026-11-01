/** Only absolute HTTP(S) destinations become links. */
export function safeLink(value) {
	if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
	try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; }
	catch { return undefined; }
}

// Citation markers: "[1]", "[1, 2]", "[1][3]", "[2–4]", not after a word ("xs[1]") and not a link ("[1](…)").
const CITE = String.raw`(?<![\p{L}\p{N}_\]\)\x60])((?:\[\d{1,2}(?:\s*[,–-]\s*\d{1,2})*\])+)(?!\()`;
/** Numbers in a citation marker group, ranges expanded: "[1][3–4]" → [1, 3, 4]. */
export function citeNumbers(marker) {
	const numbers = [];
	for (const group of String(marker).match(/\[[^\]]*\]/g) ?? []) {
		for (const part of group.slice(1, -1).split(",")) {
			const [a, b] = part.split(/[–-]/).map((x) => Number(x.trim()));
			if (!Number.isInteger(a) || a < 1) continue;
			const end = Number.isInteger(b) && b >= a && b - a < 10 ? b : a;
			for (let n = a; n <= end; n++) if (!numbers.includes(n)) numbers.push(n);
		}
	}
	return numbers;
}
const INLINE = String.raw`(\x60+)([\s\S]*?)\1|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$|\[([^\]]*)\]\(([^\s]*?)\)|\*\*([^*]+)\*\*|(?<![\p{L}\p{N}_])__([^_\n]+)__(?![\p{L}\p{N}_])|\*([^*\n]+)\*|(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])`;
const PLAIN = new RegExp(INLINE, "gu"), CITED = new RegExp(`${INLINE}|${CITE}`, "gu");

/** Parse inline tokens without interpreting HTML or executing content. `{ cites: true }` adds citation tokens. */
export function parseInline(text, opts = {}) {
	const tokens = [];
	const pattern = opts.cites ? CITED : PLAIN;
	pattern.lastIndex = 0;
	let start = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > start) tokens.push({ type: "text", text: text.slice(start, match.index) });
		if (match[1]) tokens.push({ type: "code", text: match[2] });
		else if (match[13]) {
			const numbers = citeNumbers(match[13]);
			// A marker hugs the word it cites: "float [1]" renders as "float¹".
			const before = tokens.at(-1);
			if (numbers.length && before?.type === "text") before.text = before.text.replace(/[ \t]+$/, "");
			tokens.push(numbers.length ? { type: "cite", numbers, raw: match[13] } : { type: "text", text: match[0] });
		} else if (match[3] !== undefined || match[4] !== undefined || match[5] !== undefined || match[6] !== undefined) {
			tokens.push({ type: "math", text: match[3] ?? match[4] ?? match[5] ?? match[6],
				display: match[3] !== undefined || match[4] !== undefined, raw: match[0] });
		} else if (match[7] !== undefined) {
			const href = safeLink(match[8]);
			tokens.push(href ? { type: "link", text: match[7], href } : { type: "text", text: match[0] });
		} else tokens.push({ type: match[9] || match[10] ? "strong" : "em", text: match[9] || match[10] || match[11] || match[12] });
		start = match.index + match[0].length;
	}
	if (start < text.length) tokens.push({ type: "text", text: text.slice(start) });
	return tokens;
}
const parseInlineWith = (text, opts) => parseInline(text, opts);
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const special = (line) => RULE.test(line) || /^(\s*$|\s*```|\s*~~~|#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|\$\$|\\\[)/.test(line);

/** Pure block AST. Raw HTML remains ordinary text, including during partial streams. */
export function parseMarkdown(value, opts = {}) {
	const parseInline = (text) => parseInlineWith(text, opts);
	const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
	const blocks = [];
	let i = 0;
	while (i < lines.length) {
		if (!lines[i].trim()) { i++; continue; }
		const start = i;
		let block;
		const fence = lines[i].match(/^\s*(`{3,}|~{3,})([^\s]*)[^\n]*$/);
		if (fence) {
			const code = []; i++;
			while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) code.push(lines[i++]);
			const closed = i < lines.length;
			if (closed) i++;
			block = { type: "code", language: fence[2], text: code.join("\n"), closed };
		} else if (/^(\$\$|\\\[)/.test(lines[i])) {
			const open = lines[i].startsWith("$$") ? "$$" : "\\[";
			const close = open === "$$" ? "$$" : "\\]";
			let text = lines[i++].slice(open.length);
			while (!text.includes(close) && i < lines.length) text += "\n" + lines[i++];
			const end = text.indexOf(close);
			block = end >= 0 && text.slice(end + close.length).trim()
				? { type: "paragraph", inline: parseInline(open + text) }
				: { type: "math", text: end < 0 ? text : text.slice(0, end), display: true };
		} else if (RULE.test(lines[i])) {
			i++;
			block = { type: "rule" };
		} else if (/^#{1,6}\s/.test(lines[i])) {
			const match = /** @type {RegExpMatchArray} */ (lines[i++].match(/^(#{1,6})\s+(.*)$/));
			block = { type: "heading", level: match[1].length, inline: parseInline(match[2]) };
		} else if (i + 1 < lines.length && lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
			const rows = [cells(lines[i])]; i += 2;
			while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
			block = { type: "table", rows: rows.map((row) => row.map(parseInline)) };
		} else if (/^>\s?/.test(lines[i])) {
			const quote = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
			block = { type: "quote", blocks: parseMarkdown(quote.join("\n"), opts) };
		} else if (/^\s*(?:[-*+]|\d+\.)\s/.test(lines[i])) {
			const ordered = /^\s*\d+\./.test(lines[i]), items = [];
			while (i < lines.length && (ordered ? /^\s*\d+\.\s/ : /^\s*[-*+]\s/).test(lines[i])) {
				items.push(parseInline(lines[i++].replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")));
			}
			block = { type: "list", ordered, items };
		} else {
			const paragraph = [lines[i++]];
			while (i < lines.length && !special(lines[i])) {
				if (i + 1 < lines.length && lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) break;
				paragraph.push(lines[i++]);
			}
			block = { type: "paragraph", inline: parseInline(paragraph.join("\n")) };
		}
		blocks.push({ ...block, raw: lines.slice(start, i).join("\n") });
	}
	return blocks;
}
function node(tag, text, className) {
	const el = document.createElement(tag);
	if (text !== undefined) el.textContent = text;
	if (className) el.className = className;
	return el;
}
let katexLoading;
function loadKatex() {
	if (!katexLoading) katexLoading = new Promise((resolve) => {
		const base = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
		const css = node("link"); css.rel = "stylesheet"; css.href = base + "katex.min.css";
		const script = node("script"); script.src = base + "katex.min.js"; script.async = true;
		script.onload = () => resolve(globalThis.window?.katex);
		script.onerror = () => resolve(undefined);
		document.head.append(css, script);
	});
	return katexLoading;
}
function math(token) {
	const el = node(token.display ? "div" : "code", token.text, "psi-math");
	function render(katex) {
		if (!katex) return;
		try { katex.render(token.text, el, { displayMode: !!token.display, throwOnError: false,
			trust: false, strict: "warn", maxExpand: 1000 }); }
		catch { el.textContent = token.text; }
	}
	if (globalThis.window?.katex) render(window.katex);
	else if (globalThis.window) loadKatex().then(render);
	return el;
}
function citeMarks(token) {
	const sup = node("sup", undefined, "psi-cite-group");
	for (const n of token.numbers) {
		const mark = node("button", `[${n}]`, "psi-cite");
		mark.type = "button"; mark.dataset.cite = String(n);
		mark.setAttribute("aria-label", `Source ${n}`); mark.setAttribute("aria-haspopup", "dialog");
		mark.setAttribute("aria-expanded", "false");
		sup.append(mark);
	}
	return sup;
}
function inline(parent, tokens, opts = {}) {
	for (const token of tokens) {
		if (token.type === "math") { parent.append(math(token)); continue; }
		if (token.type === "cite") { parent.append(citeMarks(token)); continue; }
		const nested = ["strong", "em", "link"].includes(token.type);
		const el = node(({ code: "code", strong: "strong", em: "em", link: "a" })[token.type] || "span", nested ? undefined : token.text);
		// Bold, emphasis and link text may hold `code` or math ("**if `n == 0`, stop**").
		if (nested) inline(el, parseInline(token.text, token.type === "link" ? {} : opts), opts);
		if (token.type === "link") { el.href = token.href; el.target = "_blank"; el.rel = "noopener noreferrer"; }
		parent.append(el);
	}
}
const KEYWORDS = {
	python: "def class return if elif else for while in not is and or import from as with try except finally raise "
		+ "lambda pass break continue yield global nonlocal assert del True False None async await",
	javascript: "const let var function return if else for while do of in new class extends throw try catch finally "
		+ "async await yield typeof instanceof switch case break continue default import export from true false null "
		+ "undefined this",
	sql: "select from where join left right inner outer full cross on as insert into values update set delete create "
		+ "table and or not null is in like between group by order having limit offset distinct union all case when then "
		+ "else end primary key references integer text real count sum avg min max with",
};
const ALIASES = { py: "python", js: "javascript", ts: "javascript", typescript: "javascript", sqlite: "sql" };
/** Classify code into string/number/keyword/comment tokens; unknown languages stay plain text. */
export function highlightTokens(text, language = "") {
	const lang = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
	if (!KEYWORDS[lang]) return [{ type: "plain", text }];
	const comment = lang === "python" ? "#[^\\n]*" : lang === "sql" ? "--[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
	const words = KEYWORDS[lang].split(" ").join("|");
	const re = new RegExp(`(${comment})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)`
		+ `|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:${words})\\b)`, lang === "sql" ? "gi" : "g");
	const tokens = [];
	let start = 0;
	for (const match of text.matchAll(re)) {
		if (match.index > start) tokens.push({ type: "plain", text: text.slice(start, match.index) });
		tokens.push({ type: match[1] ? "comment" : match[2] ? "string" : match[3] ? "number" : "keyword", text: match[0] });
		start = match.index + match[0].length;
	}
	if (start < text.length) tokens.push({ type: "plain", text: text.slice(start) });
	return tokens;
}
const LANGUAGE_NAMES = { python: "Python", py: "Python", javascript: "JavaScript", js: "JavaScript", ts: "TypeScript",
	typescript: "TypeScript", sql: "SQL", sqlite: "SQL", bash: "Shell", sh: "Shell", shell: "Shell", json: "JSON",
	html: "HTML", css: "CSS", text: "Text", txt: "Text" };
/** Human label for a fence language ("py" → "Python"); unknown names pass through, empty → "Code". */
export function languageLabel(language = "") {
	const key = String(language).toLowerCase();
	return LANGUAGE_NAMES[key] ?? (key ? String(language) : "Code");
}
function highlight(parent, text, language) {
	for (const token of highlightTokens(text, language)) {
		parent.append(token.type === "plain" ? document.createTextNode(token.text)
			: node("span", token.text, `psi-tok-${token.type}`));
	}
}
function build(block, opts = {}) {
	if (block.type === "math") return math(block);
	if (block.type === "rule") return node("hr");
	const el = node(({ heading: `h${block.level}`, paragraph: "p", quote: "blockquote", code: "figure",
		list: block.ordered ? "ol" : "ul", table: "table" })[block.type] || "div");
	if (block.inline) inline(el, block.inline, opts);
	if (block.type === "code") {
		el.className = "psi-code";
		const caption = node("figcaption");
		caption.append(node("span", languageLabel(block.language), "psi-code-lang"));
		const copy = node("button", "Copy", "psi-code-copy"); copy.type = "button";
		copy.setAttribute("aria-label", "Copy code");
		copy.addEventListener("click", async () => {
			try { await navigator.clipboard.writeText(block.text); copy.textContent = "Copied"; }
			catch { copy.textContent = "Couldn't copy"; }
			setTimeout(() => { copy.textContent = "Copy"; }, 1600);
		});
		caption.append(copy);
		const pre = node("pre"), code = node("code"); highlight(code, block.text, block.language);
		pre.append(code); el.append(caption, pre);
	}
	if (block.items) for (const item of block.items) { const li = node("li"); inline(li, item, opts); el.append(li); }
	if (block.blocks) el.append(...block.blocks.map((child) => build(child, opts)));
	if (block.rows) {
		const head = node("thead"), body = node("tbody");
		block.rows.forEach((row, index) => {
			const tr = node("tr");
			for (const cell of row) {
				const td = node(index === 0 ? "th" : "td"); if (index === 0) td.scope = "col";
				inline(td, cell); tr.append(td);
			}
			(index === 0 ? head : body).append(tr);
		});
		el.append(head, body);
		const scroll = node("div", undefined, "psi-table"); scroll.append(el);
		return scroll;
	}
	return el;
}
/** Build independent fragments; callers can retain unchanged leading blocks during streaming. */
export function renderMarkdownBlocks(text, opts = {}) {
	return parseMarkdown(text, opts).map((block) => {
		const fragment = document.createDocumentFragment(); fragment.append(build(block, opts));
		return { raw: block.raw, fragment };
	});
}
/** Safe DOM rendering. No source HTML is interpreted. `{ cites: true }` turns [n] into source markers. */
export function renderMarkdown(text, opts = {}) {
	const fragment = document.createDocumentFragment();
	for (const block of renderMarkdownBlocks(text, opts)) fragment.append(block.fragment);
	return fragment;
}
