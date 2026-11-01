/**
 * Shared UI helpers for psi web (imported by the shell, chat, practice, memory and widgets).
 *
 * API
 * - `el(tag, attrs?, ...children)` → HTMLElement. `attrs` keys: `class`, `text`, `html` (trusted markup only),
 *   `dataset` (object), `style` (object, CSSOM), `on<event>` functions (e.g. `onclick`), boolean attributes
 *   (`true` sets "", `false`/null/undefined skips), anything else via setAttribute. Children may be strings,
 *   nodes, arrays, or null/false (skipped).
 * - `toast(message, { kind?: "info"|"error", action?: { label, run }, timeout? })` → `{ close() }`.
 *   One quiet line at the bottom; errors stay until dismissed, info closes after ~5 s. Announced via aria-live.
 * - `emit(name, detail)` / `on(name, fn) → off()` — a tiny event bus on `window`. Names are prefixed with
 *   "psi:" automatically when missing, so `emit("attempt", r)` and `emit("psi:attempt", r)` are the same.
 *   Known events: "psi:attempt" (detail = attempt result {attempt, progress, leveledUp, badges}),
 *   "psi:status" (detail = extension status/widget record or {skill}), "psi:skills-changed",
 *   "psi:chats-changed" (sidebar refreshes), "psi:bench" (detail = {open?: boolean} toggles the bench panel).
 * - `formatLevel(xp)` → { level, into, span, toNext, percent, label: "Level 3", skillLabel: "Skill level 3",
 *   toNextLabel: "40 XP to level 4" }. "Level 3" is for the sidebar skill rows only; elsewhere say "Skill level 3"
 *   (one skill) or "Your level 3" (overall, see format.overallLevelLabel).
 * - `applyGameLayer(layer)` sets <html data-game> and emits "psi:game"; `cachedGameLayer()`, `currentGameLayer()`,
 *   `gameRules(layer)` → { numbers, motion, announce, fills, goal }.
 * - `streakLabel(days)` → "3-day streak" | "" ; `hoursLabel(minutes, goal = 20)` → "1.5 of 20 hours".
 * - Re-exports from ./format.js: levelInfo, relativeTime, chatTitle, badgeLabel.
 *
 * No framework, no globals other than the "psi:*" CustomEvents dispatched on window.
 */
import { levelInfo, relativeTime, chatTitle, badgeLabel, normalizeGameLayer, currentGameLayer, gameRules,
	skillLevelLabel } from "./format.js";

export { levelInfo, relativeTime, chatTitle, badgeLabel, currentGameLayer, gameRules };

const GAME_KEY = "psi-game";
/** The game layer remembered by this browser (applied before /api/me answers, so nothing flashes). */
export function cachedGameLayer() {
	try { return normalizeGameLayer(localStorage.getItem(GAME_KEY)); } catch { return "on"; }
}
/**
 * Apply the game layer to the page: sets <html data-game="on|quiet|off"> (CSS hides or calms the game parts),
 * remembers it in this browser, and emits "psi:game" ({ layer }) when it changed so views can redraw.
 */
export function applyGameLayer(layer) {
	const next = normalizeGameLayer(layer);
	if (typeof document === "undefined") return next;
	const changed = document.documentElement.dataset.game !== next;
	document.documentElement.dataset.game = next;
	try { localStorage.setItem(GAME_KEY, next); } catch { /* blocked storage: the server profile still has it */ }
	if (changed) emit("psi:game", { layer: next });
	return next;
}

/** Small DOM builder: el("button", { class: "primary", onclick }, "Check answer"). */
export function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs || {})) {
		if (value === undefined || value === null || value === false) continue;
		if (key === "class" || key === "className") node.className = value;
		else if (key === "text") node.textContent = value;
		else if (key === "html") node.innerHTML = value;
		else if (key === "dataset") Object.assign(node.dataset, value);
		else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
		else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
		else node.setAttribute(key, value === true ? "" : String(value));
	}
	const add = (child) => {
		if (child === undefined || child === null || child === false) return;
		if (Array.isArray(child)) { child.forEach(add); return; }
		node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	};
	children.forEach(add);
	return node;
}

/** Normalize an event name to the "psi:" namespace. */
export function eventName(name) {
	const value = String(name ?? "");
	return value.startsWith("psi:") ? value : `psi:${value}`;
}

/** Dispatch a "psi:*" CustomEvent on window. */
export function emit(name, detail) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(eventName(name), { detail }));
}

/** Listen for a "psi:*" event; the callback receives `detail`. Returns an unsubscribe function. */
export function on(name, fn) {
	if (typeof window === "undefined") return () => {};
	const handler = (event) => fn(event.detail, event);
	const type = eventName(name);
	window.addEventListener(type, handler);
	return () => window.removeEventListener(type, handler);
}

/** Level details plus ready-made labels. */
export function formatLevel(xp) {
	const info = levelInfo(xp);
	return { ...info, label: `Level ${info.level}`, skillLabel: skillLevelLabel(info.level),
		toNextLabel: `${info.toNext} XP to level ${info.level + 1}` };
}

/** "3-day streak" in plain words; empty for no streak. */
export function streakLabel(days) {
	const n = Math.floor(Number(days));
	if (!Number.isFinite(n) || n <= 0) return "";
	return `${n}-day streak`;
}

/** Hours practised out of the goal, e.g. "1.5 of 20 hours". */
export function hoursLabel(minutes, goal = 20) {
	const m = Number(minutes);
	const hours = Number.isFinite(m) && m > 0 ? Math.round(m / 6) / 10 : 0;
	return `${hours} of ${goal} hours`;
}

let toastHost;
function host() {
	if (toastHost?.isConnected) return toastHost;
	toastHost = el("div", { class: "psi-toasts", role: "status", "aria-live": "polite" });
	document.body.append(toastHost);
	return toastHost;
}

/** Show a one-line toast. Errors persist until closed; info closes itself.
 * @param {string} message
 * @param {{kind?: string, action?: {label: string, run?: () => void}, timeout?: number}} [options]
 */
export function toast(message, { kind = "info", action, timeout } = {}) {
	if (typeof document === "undefined") return { close() {} };
	const item = el("div", { class: `psi-toast${kind === "error" ? " is-error" : ""}`, role: kind === "error" ? "alert" : undefined });
	let timer;
	const close = () => { clearTimeout(timer); item.remove(); };
	item.append(el("span", { class: "psi-toast-text" }, String(message ?? "")));
	if (action?.label) {
		item.append(el("button", { type: "button", class: "psi-toast-action", onclick: () => { close(); action.run?.(); } },
			action.label));
	}
	item.append(el("button", { type: "button", class: "psi-toast-close", "aria-label": "Dismiss", onclick: close }, "×"));
	const list = host();
	list.append(item);
	while (list.children.length > 3) list.firstElementChild.remove();
	const ms = timeout ?? (kind === "error" ? 0 : 5000);
	if (ms > 0) timer = setTimeout(close, ms);
	return { close };
}
