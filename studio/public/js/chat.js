// Server AgentHub sends pi records with seq added at top level. Also accept {seq, payload}
// and {seq, event} envelopes. Replay begins at since=0; endpoints follow AGENTS.md.
import { api, openEvents } from "./api.js";
import { parseMarkdown, renderMarkdown } from "./markdown.js";

const commands = ["skill", "practice", "challenge", "boss", "quest", "hint", "remember", "memory", "recap",
	"hours", "streak", "learn", "map", "lesson", "review", "explore"];
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
			thinking: textOf(blocks, "thinking"), done: true, error: event.message.errorMessage };
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
	return next;
}
function make(tag, className, text) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}
function button(text, action) {
	const el = make("button", "", text); el.type = "button"; el.addEventListener("click", action); return el;
}

/** Mount an isolated conversation, with its own SSE subscription and composer. */
export function mountChat(el, options = {}) {
	let state = {}, chatId = options.chatId, destroyed = false, closeEvents, following = true;
	let connected = false, submitting = false, activeDialog, requestTimer;
	const views = new Map(), toolViews = new Map(), dialogs = [], seenDialogs = new Set(), timers = new Set();
	const root = make("section", "psi-chat"); root.setAttribute("aria-label", "Learning conversation");
	const hud = make("div", "psi-chat-hud"), log = make("div", "psi-chat-log");
	log.setAttribute("aria-label", "Messages"); log.tabIndex = 0;
	const live = make("div", "psi-sr-only"); live.setAttribute("aria-live", "polite");
	const notifications = make("div", "psi-toasts"); notifications.setAttribute("role", "status");
	const status = make("div", "psi-chat-status", "Opening chat…"); status.setAttribute("role", "status");
	const form = make("form", "psi-composer");
	const input = make("textarea"); input.rows = 2; input.placeholder = "Ask a question or try /practice";
	const suggestions = make("div", "psi-suggestions"); suggestions.setAttribute("aria-label", "Slash commands");
	const submit = make("button", "primary", "Send"); submit.type = "submit"; submit.disabled = true;
	const stop = button("Stop", () => api.post(path("abort")).catch((error) => toast(error.message)));
	stop.hidden = true;
	form.append(input, suggestions, submit, stop);
	input.setAttribute("aria-label", "Message psi");
	root.append(hud, log, status, live, form, notifications); el.replaceChildren(root);
	const path = (suffix) => `/api/chat/${encodeURIComponent(chatId)}/${suffix}`;
	const schedule = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
	function toast(message) {
		if (destroyed) return;
		const item = make("div", "psi-toast", String(message)); notifications.append(item);
		schedule(() => item.remove(), 6000);
	}
	async function send(text) {
		if (!chatId || !connected || destroyed || submitting || !text.trim()) return;
		submitting = true; state = { ...state, busy: true }; render();
		try {
			const response = await api.post(path("prompt"), { message: text });
			if (response?.data?.disposition === "handled" || response?.disposition === "handled") {
				state = { ...state, busy: false }; render();
			}
		} catch (error) { state = { ...state, busy: false }; render(); toast(error.message); throw error; }
		finally { submitting = false; }
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
	function render() {
		if (destroyed) return;
		hud.textContent = Object.values(state.hud ?? {}).filter(Boolean).join("\n");
		for (const [index, message] of (state.messages ?? []).entries()) {
			let view = views.get(index);
			if (!view) {
				const article = make("article", `psi-message psi-${message.role}`);
				article.setAttribute("aria-label", message.role === "user" ? "You" : "Psi");
				const body = make("div", "psi-markdown"), thinking = make("details", "psi-thinking");
				thinking.append(make("summary", "", "Thinking"), make("pre"));
				const tools = make("div", "psi-tools"); article.append(thinking, body, tools); log.append(article);
				view = { article, body, thinking, tools, raw: [], text: null }; views.set(index, view);
			}
			updateMarkdown(view, message.text + (message.error ? `\n\n${message.error}` : ""));
			view.thinking.hidden = !message.thinking; view.thinking.lastElementChild.textContent = message.thinking;
		}
		for (const tool of state.tools ?? []) {
			let view = toolViews.get(tool.id);
			if (!view) {
				const box = make("div", "psi-tool"), details = make("details"), summary = make("summary");
				const pre = make("pre"); details.append(summary, pre); box.append(details);
				(views.get(tool.turn)?.tools ?? log).append(box);
				view = { box, summary, pre, widgetStarted: false }; toolViews.set(tool.id, view);
			}
			view.summary.textContent = `ψ ${tool.name} ${tool.done ? (tool.isError ? "✗" : "✓") : "…"}`;
			view.pre.textContent = JSON.stringify({ args: tool.args, result: tool.result }, null, 2);
			if (tool.done && !view.widgetStarted) {
				view.widgetStarted = true;
				import("./widgets.js").then(async (module) => {
					if (destroyed || typeof module.renderToolWidget !== "function") return;
					const widget = await module.renderToolWidget(tool.name, tool.args, tool.result, ctx);
					if (!destroyed && widget) { view.box.append(widget); scroll(); }
				}).catch(() => {});
			}
		}
		const statusText = state.busy ? "ψ is working…" : connected ? "Ready" : "Connecting…";
		if (status.textContent !== statusText) status.textContent = statusText;
		stop.hidden = !state.busy; submit.disabled = !chatId || !connected || !!state.busy;
		scroll();
	}
	function scroll() { if (following && !destroyed) log.scrollTop = log.scrollHeight; }
	log.addEventListener("scroll", () => { following = log.scrollHeight - log.scrollTop - log.clientHeight < 70; });
	function nextDialog() {
		if (activeDialog || destroyed || !dialogs.length) return;
		const request = dialogs.shift(), previous = document.activeElement;
		const overlay = make("div", "psi-modal-backdrop"), dialog = make("div", "psi-modal");
		dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
		dialog.setAttribute("aria-label", request.title || "Psi needs your input"); dialog.tabIndex = -1;
		dialog.append(make("h2", "", request.title || "Psi needs your input"));
		if (request.message) dialog.append(make("p", "", request.message));
		let field, finished = false;
		function dismiss() {
			finished = true; clearTimeout(requestTimer); overlay.remove(); activeDialog = undefined;
			if (previous?.isConnected) previous.focus();
			nextDialog();
		}
		async function answer(value) {
			if (finished || dialog.dataset.sending) return;
			dialog.dataset.sending = "1";
			const buttons = dialog.querySelectorAll("button"); buttons.forEach((item) => { item.disabled = true; });
			try { await api.post(path("ui"), { id: request.id, ...value }); if (!destroyed) dismiss(); }
			catch (error) { delete dialog.dataset.sending; buttons.forEach((item) => { item.disabled = false; }); toast(error.message); }
		}
		if (request.method === "select") {
			for (const option of request.options ?? []) dialog.append(button(option, () => answer({ value: option })));
		} else if (request.method === "confirm") {
			dialog.append(button("Yes", () => answer({ confirmed: true })), button("No", () => answer({ confirmed: false })));
		} else {
			field = make(request.method === "editor" ? "textarea" : "input");
			field.value = request.prefill ?? ""; field.placeholder = request.placeholder ?? "";
			field.setAttribute("aria-label", request.title || "Your response");
			dialog.append(field, button("Submit", () => answer({ value: field.value })));
		}
		dialog.append(button("Cancel", () => answer({ cancelled: true })));
		dialog.addEventListener("keydown", (event) => {
			if (event.key === "Escape") { event.preventDefault(); answer({ cancelled: true }); }
			if (event.key === "Tab") {
				const focusable = [...dialog.querySelectorAll("button:not(:disabled), input, textarea")];
				const index = focusable.indexOf(document.activeElement);
				if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
				else if (!event.shiftKey && (index === focusable.length - 1 || index < 0)) { event.preventDefault(); focusable[0]?.focus(); }
			}
		});
		overlay.append(dialog); root.append(overlay); activeDialog = { overlay, dismiss };
		(field ?? dialog.querySelector("button") ?? dialog).focus();
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
		if (event.type === "extension_ui_request") {
			if (event.method === "notify") toast(event.message);
			if (event.method === "set_editor_text") input.value = event.text ?? "";
			if (["select", "confirm", "input", "editor"].includes(event.method) && !seenDialogs.has(event.id)) {
				seenDialogs.add(event.id); dialogs.push(event); nextDialog();
			}
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			live.textContent = textOf(contentOf(event.message), "text");
		}
		if ((event.type === "response" && event.success === false) || ["agent_error", "rpc_error"].includes(event.type)) toast(event.error);
		if (event.type === "response" && event.command === "prompt" && event.data?.disposition === "handled") state = { ...state, busy: false };
		render();
	}
	input.addEventListener("input", () => {
		suggestions.replaceChildren();
		if (!/^\/\w*$/.test(input.value)) return;
		for (const command of commands.filter((name) => name.startsWith(input.value.slice(1)))) {
			suggestions.append(button(`/${command}`, () => { input.value = `/${command} `; suggestions.replaceChildren(); input.focus(); }));
		}
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (state.busy || !input.value.trim()) return;
		const text = input.value; input.value = ""; suggestions.replaceChildren(); following = true;
		try { await send(text); } catch { input.value = text; }
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
			closeEvents = openEvents(chatId, { since: 0, onRecord, onOpen: () => { connected = true; render(); },
				onError: () => { connected = false; render(); status.textContent = "Connection lost. Reconnecting…"; } });
		} catch (error) { status.textContent = error.message; toast(error.message); }
	})();
	return { destroy() {
		destroyed = true; closeEvents?.(); clearTimeout(requestTimer);
		for (const timer of timers) clearTimeout(timer);
		const focus = document.activeElement;
		activeDialog?.overlay.remove(); root.remove();
		if (focus && !focus.isConnected) el.focus?.();
	} };
}
