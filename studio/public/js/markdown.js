/** Only absolute HTTP(S) destinations become links. */
export function safeLink(value) {
	if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
	try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; }
	catch { return undefined; }
}

/** Parse inline tokens without interpreting HTML or executing content. */
export function parseInline(text) {
	const tokens = [];
	const pattern = /(`+)([\s\S]*?)\1|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$|\[([^\]]*)\]\(([^\s]*?)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
	let start = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > start) tokens.push({ type: "text", text: text.slice(start, match.index) });
		if (match[1]) tokens.push({ type: "code", text: match[2] });
		else if (match[3] !== undefined || match[4] !== undefined || match[5] !== undefined || match[6] !== undefined) {
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
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
const special = (line) => /^(\s*$|\s*```|\s*~~~|#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|\$\$|\\\[)/.test(line);

/** Pure block AST. Raw HTML remains ordinary text, including during partial streams. */
export function parseMarkdown(value) {
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
		} else if (/^#{1,6}\s/.test(lines[i])) {
			const match = lines[i++].match(/^(#{1,6})\s+(.*)$/);
			block = { type: "heading", level: match[1].length, inline: parseInline(match[2]) };
		} else if (i + 1 < lines.length && lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
			const rows = [cells(lines[i])]; i += 2;
			while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
			block = { type: "table", rows: rows.map((row) => row.map(parseInline)) };
		} else if (/^>\s?/.test(lines[i])) {
			const quote = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
			block = { type: "quote", blocks: parseMarkdown(quote.join("\n")) };
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
function inline(parent, tokens) {
	for (const token of tokens) {
		if (token.type === "math") { parent.append(math(token)); continue; }
		const el = node(({ code: "code", strong: "strong", em: "em", link: "a" })[token.type] || "span", token.text);
		if (token.type === "link") { el.href = token.href; el.target = "_blank"; el.rel = "noopener noreferrer"; }
		parent.append(el);
	}
}
function highlight(parent, text, language) {
	if (!["python", "py", "js", "javascript", "sql"].includes(language.toLowerCase())) { parent.textContent = text; return; }
	const re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b(?:def|class|return|if|else|for|while|import|from|as|True|False|None|const|let|var|function|async|await|new|throw|SELECT|FROM|WHERE|JOIN|ON|AS|INSERT|INTO|VALUES|UPDATE|SET|AND|OR|NULL)\b|#[^\n]*|\/\/[^\n]*|--[^\n]*)/g;
	let start = 0;
	for (const match of text.matchAll(re)) {
		parent.append(document.createTextNode(text.slice(start, match.index)), node("span", match[0], "psi-syntax"));
		start = match.index + match[0].length;
	}
	parent.append(document.createTextNode(text.slice(start)));
}
function build(block) {
	if (block.type === "math") return math(block);
	const el = node(({ heading: `h${block.level}`, paragraph: "p", quote: "blockquote", code: "figure",
		list: block.ordered ? "ol" : "ul", table: "table" })[block.type] || "div");
	if (block.inline) inline(el, block.inline);
	if (block.type === "code") {
		el.className = "psi-code";
		const caption = node("figcaption", block.language || "text");
		const copy = node("button", "Copy"); copy.type = "button"; copy.setAttribute("aria-label", "Copy code");
		copy.addEventListener("click", async () => {
			try { await navigator.clipboard.writeText(block.text); copy.textContent = "Copied"; }
			catch { copy.textContent = "Copy unavailable"; }
		});
		caption.append(copy);
		const pre = node("pre"), code = node("code"); highlight(code, block.text, block.language);
		pre.append(code); el.append(caption, pre);
	}
	if (block.items) for (const item of block.items) { const li = node("li"); inline(li, item); el.append(li); }
	if (block.blocks) el.append(...block.blocks.map(build));
	if (block.rows) {
		block.rows.forEach((row, index) => {
			const tr = node("tr");
			for (const cell of row) { const td = node(index === 0 ? "th" : "td"); inline(td, cell); tr.append(td); }
			el.append(tr);
		});
	}
	return el;
}
/** Build independent fragments; callers can retain unchanged leading blocks during streaming. */
export function renderMarkdownBlocks(text) {
	return parseMarkdown(text).map((block) => {
		const fragment = document.createDocumentFragment(); fragment.append(build(block));
		return { raw: block.raw, fragment };
	});
}
/** Safe DOM rendering. No source HTML is interpreted. */
export function renderMarkdown(text) {
	const fragment = document.createDocumentFragment();
	for (const block of renderMarkdownBlocks(text)) fragment.append(block.fragment);
	return fragment;
}
