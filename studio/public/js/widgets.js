import { createCodeLab, warmUp } from "./codelab.js";
import { markSvg, renderTrail } from "./trail.js";
import { badgeLabel, levelInfo } from "./format.js";
import * as ui from "./ui.js";

/** Stable, compact display of a learner answer. */
export function formatAnswer(value) {
	if (value == null) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value === "number") {
		return Number.isFinite(value) && !Number.isInteger(value) ? String(Number(value.toPrecision(15))) : String(value);
	}
	if (Array.isArray(value)) return value.map(formatAnswer).join(", ");
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

const KIND_PHRASES = {
	quickfire: "Quick question", predict: "Predict the output", debug: "Find the bug", apply: "Apply it",
	explain: "Explain it back", build: "Build", boss: "Boss challenge",
};
/** Challenge kind as a plain phrase. Predictions without code read "Predict what happens". */
export function kindPhrase(kind, { format, prompt } = {}) {
	if (kind === "predict" && format !== "code" && !/`/.test(String(prompt ?? ""))) return "Predict what happens";
	return KIND_PHRASES[kind] ?? "Challenge";
}

/** Keyboard help shown beside the sheet's buttons. */
export function keyHelp(format, { hints = false, mac = false, short = false } = {}) {
	const mod = mac ? "Cmd" : "Ctrl";
	const parts = [format === "code" ? `${mod}+Enter runs your code` : format === "text" && !short
		? "Enter checks, Shift+Enter adds a line" : "Enter checks your answer"];
	if (hints) parts.push("H shows a hint");
	return parts.join(", ");
}

/**
 * "line" for a short text answer (one input, Enter checks) or "area" for a written one. Only explanations,
 * builds, boss fights and prompts that ask why or to explain get the multi-line box.
 */
export function answerShape(d = {}) {
	if (["explain", "build", "boss"].includes(d.kind)) return "area";
	return /\b(explain|describe|why|justify|in your own words)\b/i.test(String(d.prompt ?? "")) ? "area" : "line";
}

function dataFor(result) { return result?.details?.widget ?? result?.details ?? {}; }
function textFor(result) {
	return [typeof result === "string" ? result : result?.text ?? "", ...(result?.content ?? [])
		.filter((part) => part.type === "text").map((part) => part.text)].join("\n");
}
function artifactPath(result) {
	const source = `${JSON.stringify(result?.details ?? {})}\n${textFor(result)}`;
	const path = source.match(/\/artifacts\/[^\s<>"'`\\)\]]+/)?.[0];
	if (!path) return null;
	try {
		const decoded = decodeURIComponent(path);
		if (decoded.includes("\\") || decoded.split("/").some((part) => part === "." || part === "..")) return null;
		const url = new URL(path, "https://psi.invalid");
		return url.pathname.startsWith("/artifacts/") ? url.pathname + url.search : null;
	} catch { return null; }
}

/** Resolve only recognized tool/payload pairs, without accessing the DOM. */
export function widgetKindFor(toolName, result) {
	if (!result || result.isError) return null;
	const d = dataFor(result);
	switch (toolName) {
		case "psi_challenge": return d.type === "challenge" && d.skill && d.id ? "challenge" : null;
		case "psi_attempt": return typeof d.outcome === "string" && typeof d.xp === "number" ? "attempt" : null;
		case "psi_explorable": case "psi_storyboard": return artifactPath(result) ? "artifact" : null;
		case "psi_progress_report": return d.hours || Array.isArray(d.skills) ? "progress" : null;
		case "psi_skill_plan": return Array.isArray((d.plan ?? d).subskills) ? "plan" : null;
		// psi_memory_remember has no widget: the turn's activity line already says "Saved a note about you".
		case "psi_concept_graph": return typeof d.mermaid === "string" ? "graph" : null;
		default: return null;
	}
}

function node(tag, className = "", text) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = String(text);
	return el;
}
function button(text, action, className = "") {
	const el = node("button", className, text);
	el.type = "button";
	el.addEventListener("click", action);
	return el;
}
function reducedMotion() { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; }
function countUp(el, xp) {
	const target = Number(xp) || 0;
	el.textContent = `+${target} XP`;
	if (typeof requestAnimationFrame !== "function" || reducedMotion() || target <= 0) return;
	const start = performance.now();
	const tick = (now) => {
		const fraction = Math.min(1, (now - start) / 600);
		el.textContent = `+${Math.round(target * (1 - (1 - fraction) ** 3))} XP`;
		if (fraction < 1) requestAnimationFrame(tick);
	};
	el.textContent = "+0 XP";
	requestAnimationFrame(tick);
}
async function markdown(el, text, { inline = false } = {}) {
	el.textContent = text;
	try {
		const mod = await import("./markdown.js");
		if (typeof mod.renderMarkdown !== "function") return;
		const rendered = await mod.renderMarkdown(text);
		if (!(rendered instanceof Node)) return;
		// Inline uses (choices, hints) unwrap a single paragraph so text sits on the row.
		const only = rendered.childNodes.length === 1 ? rendered.firstChild : null;
		if (inline && only?.nodeName === "P") el.replaceChildren(...only.childNodes);
		else el.replaceChildren(rendered);
	} catch { el.textContent = text; }
}
function notify(ctx, message, kind = "info") {
	try {
		if (typeof ctx.toast === "function") ctx.toast(message, { kind });
		else ui.toast?.(message, { kind });
	} catch { /* A host notification must not interrupt card state. */ }
}
async function send(ctx, message) {
	try { await ctx.send?.(message); }
	catch { notify(ctx, "Your result was saved, but chat could not continue. Send your tutor a message to carry on.", "error"); }
}
async function apiFor(ctx) {
	if (ctx.api) return ctx.api;
	return (await import("./api.js")).api;
}
function isTextField(target) {
	if (!(target instanceof Element)) return false;
	if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
	return target.tagName === "INPUT" && !["radio", "checkbox", "button", "submit", "reset"].includes(target.type);
}
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

function levelMeter(level) {
	const n = Math.max(1, Math.min(5, Number(level) || 1));
	const wrap = node("span", "psi-level");
	wrap.append(node("span", "", `Level ${n}`));
	const meter = node("span", "psi-level-meter");
	meter.setAttribute("aria-hidden", "true");
	for (let i = 1; i <= 5; i++) meter.append(node("span", i <= n ? "is-on" : ""));
	wrap.append(meter);
	wrap.title = `Difficulty ${n} of 5`;
	return wrap;
}

const RESULT_WORDS = { success: "Solved it.", partial: "Partly right.", fail: "Missed it.", skipped: "Skipped." };

function badgesLine(badges) {
	const names = (badges ?? []).map(badgeLabel).filter(Boolean);
	if (!names.length) return null;
	return node("p", "psi-badge-line", `${names.length === 1 ? "New badge" : "New badges"}: ${names.join(", ")}`);
}
function levelUpLine(level) {
	const p = node("p", "psi-level-up", "You reached ");
	p.append(node("strong", "", `Level ${level}`));
	return p;
}

let choiceId = 0;

function challengeSheet(d, ctx) {
	const format = d.format ?? "text";
	const phrase = kindPhrase(d.kind, d);
	const level = Math.max(1, Math.min(5, Number(d.level) || 1));
	const hintsTotal = Math.max(0, Number(d.hintsCount) || 0);
	const sheet = node("section", "psi-widget psi-sheet psi-challenge");
	sheet.dataset.format = format;
	sheet.setAttribute("aria-label", `${phrase}, level ${level} of 5`);

	const head = node("header", "psi-sheet-head");
	head.append(node("h3", "psi-sheet-kind", phrase), levelMeter(level));
	const prompt = node("div", "psi-prompt");
	void markdown(prompt, d.prompt ?? "");
	sheet.append(head, prompt);

	const fields = node("fieldset", "psi-answer-fields");
	const legend = node("legend", format === "code" ? "psi-sr" : "", format === "choice" ? "Choose one" : format === "code"
		? "Your code" : "Your answer");
	fields.append(legend);
	sheet.append(fields);

	let input, lab;
	const radios = [];
	if (format === "code") {
		lab = createCodeLab(fields, { language: d.language ?? "python", starterCode: d.starterCode ?? "", setup: d.setup,
			tests: d.tests, expected: d.expected, onRun: () => run(), onSubmit: () => check() });
		// Start the one-time runtime download as soon as a learner starts typing.
		lab.input.addEventListener("focus", () => { void warmUp(d.language); }, { once: true });
	} else if (format === "choice") {
		const group = `psi-choice-${++choiceId}`;
		const list = node("div", "psi-choices");
		(d.choices ?? []).forEach((choice, i) => {
			const label = node("label", "psi-choice");
			const radio = node("input");
			radio.type = "radio";
			radio.name = group;
			// The answer is the option text, as Challenge.expected requires.
			radio.value = choice;
			const letter = String.fromCharCode(65 + i);
			radio.setAttribute("aria-keyshortcuts", letter);
			const text = node("span", "psi-choice-text");
			void markdown(text, choice, { inline: true });
			label.append(radio, node("span", "psi-choice-letter", letter), text);
			radio.setAttribute("aria-label", `${letter}: ${choice}`);
			radios.push(radio);
			list.append(label);
		});
		fields.append(list);
	} else if (format === "number") {
		const field = node("div", "psi-field");
		input = node("input", "psi-answer-input");
		input.type = "text";
		input.inputMode = "decimal";
		input.autocomplete = "off";
		input.spellcheck = false;
		input.placeholder = "Your number";
		field.append(input);
		if (d.unit) field.append(node("span", "psi-unit", d.unit));
		fields.append(field);
	} else if (format === "math") {
		input = node("input", "psi-answer-input psi-math-input");
		input.type = "text";
		input.autocomplete = "off";
		input.spellcheck = false;
		input.placeholder = "For example 3x^2 + 2x";
		const label = node("p", "psi-math-preview-label", "Preview");
		label.id = `psi-preview-${++choiceId}`;
		const preview = node("div", "psi-math-preview is-empty", "Your answer appears here as math.");
		preview.setAttribute("aria-labelledby", label.id);
		preview.setAttribute("aria-live", "polite");
		let timer;
		input.addEventListener("input", () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				const value = input.value.replace(/\$/g, "").trim();
				preview.classList.toggle("is-empty", !value);
				if (!value) { preview.textContent = "Your answer appears here as math."; return; }
				void markdown(preview, `$${value}$`, { inline: true });
			}, 120);
		});
		fields.append(input, label, preview);
	} else if (answerShape(d) === "line") {
		// Short answers get one line, and Enter checks.
		input = node("input", "psi-answer-input psi-short-input");
		input.type = "text";
		input.autocomplete = "off";
		input.placeholder = "Your answer";
		fields.append(input);
	} else {
		input = node("textarea", "psi-answer-input");
		input.rows = 4;
		input.placeholder = "Type your answer. A guess is welcome.";
		fields.append(input);
	}
	if (input) input.setAttribute("aria-label", "Your answer");

	const hints = node("div", "psi-hints");
	hints.setAttribute("aria-live", "polite");
	const actions = node("div", "psi-sheet-actions");
	const result = node("div", "psi-sheet-result");
	result.setAttribute("aria-live", "polite");
	result.hidden = true;
	result.tabIndex = -1;

	let hintsUsed = 0, busy = false, graded = false, hintBusy = false;
	const endpoint = `/api/skills/${encodeURIComponent(d.skill)}/challenges/${encodeURIComponent(d.id)}`;
	const answer = () => lab ? lab.getValue() : format === "choice"
		? radios.find((r) => r.checked)?.value ?? "" : input.value;

	const submit = button("Check answer", () => check(), "is-primary");
	submit.setAttribute("aria-keyshortcuts", format === "code" ? "Control+Shift+Enter" : "Enter");
	const runButton = button("Run code", () => run());
	runButton.setAttribute("aria-keyshortcuts", MAC ? "Meta+Enter" : "Control+Enter");
	const hint = button("Show a hint", () => showHint());
	hint.setAttribute("aria-keyshortcuts", "H");
	actions.append(submit);
	if (format === "code") actions.append(runButton);
	if (hintsTotal > 0) actions.append(hint);
	actions.append(node("span", "psi-keys", keyHelp(format, { hints: hintsTotal > 0, mac: MAC, short: input?.tagName === "INPUT" })));
	sheet.append(hints, actions, result);

	const sync = () => {
		fields.disabled = graded;
		submit.disabled = busy || graded || hintBusy;
		runButton.disabled = busy || graded;
		hint.disabled = busy || graded || hintBusy || hintsUsed >= hintsTotal;
		if (hintsUsed >= hintsTotal && hintsTotal > 0) hint.textContent = "No more hints";
		actions.hidden = graded;
	};

	async function showHint() {
		if (hint.disabled || graded) return;
		hintBusy = true; sync();
		try {
			const api = await apiFor(ctx);
			// The REST hint API uses zero-based n (the extension tool itself uses one-based n).
			const response = await api.get(`${endpoint}/hint?n=${hintsUsed}`);
			if (response.hint != null) {
				hintsUsed++;
				const item = node("p", "psi-hint");
				item.append(node("span", "psi-hint-label", `Hint ${hintsUsed} of ${response.total ?? hintsTotal}`));
				const text = node("span");
				void markdown(text, String(response.hint), { inline: true });
				item.append(text);
				hints.append(item);
			} else hintsUsed = hintsTotal;
		} catch { notify(ctx, "Couldn't load that hint. Check that psi web is running, then try again.", "error"); }
		finally { hintBusy = false; sync(); }
	}

	async function run() {
		if (!lab || busy || graded) return undefined;
		busy = true; sync();
		runButton.textContent = "Running…";
		try { return await lab.run(); }
		catch { notify(ctx, "Couldn't run your code. Your work is still here; run it again.", "error"); return undefined; }
		finally { busy = false; runButton.textContent = "Run code"; sync(); }
	}

	async function check() {
		if (busy || graded || hintBusy) return;
		const value = answer();
		if (!value.trim()) {
			notify(ctx, format === "choice" ? "Pick an option first. A guess is welcome." : "Add an answer first. A guess is welcome.");
			(input ?? radios[0] ?? lab?.input)?.focus();
			return;
		}
		busy = true; sync();
		submit.textContent = format === "code" ? "Running checks…" : "Checking…";
		try {
			const body = { answer: value, hintsUsed };
			if (lab) {
				const ran = await lab.run();
				// A runtime that never loaded is not the learner's miss: nothing is recorded.
				if (ran.system) return;
				body.outcome = ran.ok ? "success" : "fail";
			}
			const api = await apiFor(ctx);
			const response = await api.post(`${endpoint}/attempt`, body);
			graded = true;
			const a = response.attempt ?? {};
			showResult(response, value);
			if (a.outcome !== "pending") {
				try { ui.emit?.("psi:attempt", response); } catch { /* Listeners must not break the sheet. */ }
			}
			// One short continuation for every saved attempt, so the tutor carries on.
			// The card already graded and saved this attempt; say so, so the tutor reacts instead of recording it again.
			void send(ctx, `Answered challenge ${d.id}: ${value} (${a.outcome}, +${a.xp ?? 0} XP). ${a.outcome === "pending"
				? "Please grade it with psi_attempt." : "Already graded and saved; don't record it again."}`);
		} catch { notify(ctx, "Couldn't save your attempt. Your answer is still here; check it again.", "error"); }
		finally {
			busy = false;
			submit.textContent = "Check answer";
			sync();
		}
	}

	function showResult(response, value) {
		const a = response.attempt ?? {};
		const outcome = a.outcome;
		result.hidden = false;
		result.replaceChildren();
		if (outcome === "pending" || response.needsGrading) {
			result.append(node("p", "psi-result-note", "Sent to your tutor to grade. Your answer stays here."));
			return;
		}
		if (!reducedMotion()) result.classList.add("is-new");
		sheet.classList.add(`is-${outcome}`);
		const line = node("p", "psi-result-line");
		const xp = node("span", "psi-xp");
		line.append(markSvg(outcome), node("span", "", RESULT_WORDS[outcome] ?? "Saved."), xp);
		result.append(line);
		countUp(xp, a.xp);
		if (a.feedback) result.append(node("p", "psi-feedback", a.feedback));
		if (response.leveledUp) result.append(levelUpLine(response.progress?.level ?? levelInfo(response.progress?.xp).level));
		const badges = badgesLine(response.badges);
		if (badges) result.append(badges);
		const next = button("Next challenge", () => {
			next.disabled = true;
			void send(ctx, "Next challenge");
		}, outcome === "fail" ? "" : "is-primary");
		const row = node("div", "psi-result-actions");
		if (outcome === "fail") {
			const box = node("div", "psi-lesson");
			const id = `psi-lesson-${++choiceId}`;
			const label = node("label", "", "What will you try differently?");
			label.htmlFor = id;
			const lesson = node("textarea", "psi-answer-input");
			lesson.id = id;
			lesson.rows = 2;
			lesson.placeholder = "One sentence is plenty.";
			const save = button("Save lesson", async () => {
				const text = lesson.value.trim();
				if (!text) { notify(ctx, "Write a lesson first, even a short one."); lesson.focus(); return; }
				save.disabled = true; lesson.disabled = true;
				// Store the lesson with the attempt first (it shows on the trail and earns the lesson bonus).
				let saved;
				try {
					const api = await apiFor(ctx);
					saved = a.id ? await api.post(`/api/skills/${encodeURIComponent(d.skill)}/attempts/${encodeURIComponent(a.id)}/lesson`,
						{ lesson: text }) : undefined;
				} catch {
					save.disabled = false; lesson.disabled = false;
					notify(ctx, "Couldn't save your lesson. It's still in the box; save it again.", "error");
					return;
				}
				const bonus = Number(saved?.bonus) || 0;
				const done = node("p", "psi-saved-lesson", `Lesson saved: ${text}`);
				if (bonus > 0) done.append(" ", node("span", "psi-xp", `+${bonus} XP`));
				box.replaceChildren(done, row);
				next.classList.add("is-primary");
				next.focus();
				if (saved?.attempt) {
					try { ui.emit?.("psi:lesson", saved); } catch { /* Listeners must not break the sheet. */ }
				}
				save.remove();
				void send(ctx, `Lesson for challenge ${d.id} (I missed it with "${value}"): ${text}`);
			}, "is-primary");
			lesson.addEventListener("keydown", (event) => {
				if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); save.click(); }
			});
			box.append(label, lesson);
			row.append(save, next);
			box.append(row);
			result.append(box);
			lesson.focus();
		} else {
			row.append(next);
			result.append(row);
			next.focus();
		}
	}

	sheet.addEventListener("keydown", (event) => {
		if (event.isComposing || graded) return;
		const target = event.target;
		const inLab = !!lab && lab.el.contains(target);
		const mod = event.ctrlKey || event.metaKey;
		if (event.key === "Enter" && mod && format === "code") {
			if (inLab) return; // The editor handles its own shortcuts.
			event.preventDefault();
			void run();
			return;
		}
		if (result.contains(target) || inLab) return;
		if (event.key === "Enter" && !event.shiftKey && !mod && !event.altKey) {
			if (target === input || radios.includes(target)) { event.preventDefault(); void check(); }
			return;
		}
		if (mod || event.altKey || isTextField(target)) return;
		const key = event.key.toLowerCase();
		if (key === "h" && hintsTotal > 0) { event.preventDefault(); void showHint(); return; }
		if (radios.length && /^[a-z]$/.test(key)) {
			const radio = radios[key.charCodeAt(0) - 97];
			if (radio) { event.preventDefault(); radio.checked = true; radio.focus(); }
		}
	});
	sync();
	return sheet;
}

function outcomeLine(outcome, xp) {
	const line = node("p", "psi-result-line");
	const chip = node("span", "psi-xp", `+${Number(xp) || 0} XP`);
	line.append(markSvg(outcome), node("span", "", RESULT_WORDS[outcome] ?? "Saved."), chip);
	return line;
}

function attemptNote(d) {
	const card = node("section", "psi-widget psi-tool-block psi-attempt");
	card.setAttribute("role", "status");
	card.append(outcomeLine(d.outcome, d.xp));
	if (d.leveledUp) card.append(levelUpLine(d.level ?? 1));
	const badges = badgesLine(d.badges);
	if (badges) card.append(badges);
	const streak = ui.streakLabel?.(d.streak ?? d.streakDays) ?? "";
	if (streak) card.append(node("p", "psi-tool-meta", streak));
	return card;
}

function fill(fraction, label) {
	const bar = node("div", "psi-fill");
	bar.setAttribute("role", "img");
	bar.setAttribute("aria-label", label);
	const inner = node("span");
	inner.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
	bar.append(inner);
	return bar;
}
function humanize(slug) {
	const words = String(slug ?? "").replace(/[-_]+/g, " ").trim();
	return words ? words[0].toUpperCase() + words.slice(1) : "Practice progress";
}

function progressReport(d, ctx) {
	const card = node("section", "psi-widget psi-tool-block psi-progress");
	for (const report of d.skills ?? [d]) {
		const section = node("div", "psi-progress-report");
		section.append(node("h3", "", humanize(report.skill)));
		const info = levelInfo(report.xp ?? report.totalXp ?? 0);
		const level = Number(report.level) || info.level;
		const into = report.intoLevel ?? info.into, toNext = report.toNext ?? info.toNext;
		const stats = node("p", "psi-stat-row");
		stats.append(node("span", "", `Level ${level}`), node("span", "", `${toNext} XP to level ${level + 1}`));
		const hours = report.hours ?? { logged: (report.minutesLogged ?? 0) / 60, goal: 20 };
		const streak = ui.streakLabel?.(report.streak ?? report.streakDays) ?? "";
		section.append(stats, fill(into / Math.max(1, into + toNext), `Level ${level}: ${into} of ${into + toNext} XP`));
		const hoursText = `${formatAnswer(Math.round((Number(hours.logged) || 0) * 10) / 10)} of ${hours.goal ?? 20} hours`;
		const more = node("p", "psi-stat-row");
		more.append(node("span", "", hoursText));
		if (streak) more.append(node("span", "", streak));
		section.append(more, fill((Number(hours.logged) || 0) / Math.max(1, Number(hours.goal) || 20), hoursText));
		if (Array.isArray(report.recentAttempts ?? report.trail)) {
			section.append(renderTrail(report.recentAttempts ?? report.trail, { label: `Attempt trail for ${humanize(report.skill)}` }));
		} else if (Number(report.attempts) > 0) {
			const counts = node("p", "psi-tool-meta",
				`${report.attempts} attempts: ${report.successes ?? 0} solved, ${report.failures ?? 0} missed`);
			section.append(counts);
			// Swap the counts for the real trail when the practice API is reachable.
			if (report.skill && /^[a-z0-9-]+$/i.test(report.skill)) {
				apiFor(ctx).then((api) => api.get(`/api/skills/${encodeURIComponent(report.skill)}/attempts?limit=60`))
					.then((list) => {
						if (!Array.isArray(list) || !list.length) return;
						counts.replaceWith(renderTrail([...list].reverse(), { label: `Attempt trail for ${humanize(report.skill)}` }));
					}).catch(() => {});
			}
		}
		if (report.nextSubskill?.title) section.append(node("p", "psi-tool-meta", `Next up: ${report.nextSubskill.title}`));
		const names = (report.badges ?? []).map(badgeLabel).filter(Boolean);
		if (names.length) section.append(node("p", "psi-tool-meta", `Badges: ${names.join(", ")}`));
		card.append(section);
	}
	return card;
}

const STATUS_WORDS = { solid: "Solid", practicing: "Practicing", active: "Ready to start", locked: "Later" };

function skillPlan(d) {
	const plan = d.plan ?? d;
	const card = node("section", "psi-widget psi-tool-block psi-plan");
	card.append(node("h3", "", plan.title ?? "Skill plan"));
	if (plan.targetPerformance) card.append(node("p", "psi-tool-meta", plan.targetPerformance));
	const list = node("ol", "psi-skill-checklist");
	for (const skill of [...plan.subskills].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))) {
		const item = node("li", `is-${skill.status ?? "locked"}`);
		item.append(node("span", "psi-step-title", skill.title ?? skill.id), node("span", "psi-status",
			STATUS_WORDS[skill.status] ?? ""));
		list.append(item);
	}
	card.append(list);
	return card;
}

function artifactFrame(toolName, result) {
	const card = node("section", "psi-widget psi-artifact");
	const frame = node("iframe");
	frame.setAttribute("sandbox", "allow-scripts");
	frame.setAttribute("allowfullscreen", "");
	frame.title = toolName === "psi_storyboard" ? "Lesson storyboard" : "Interactive explorable";
	frame.loading = "lazy";
	frame.src = artifactPath(result);
	const bar = node("div", "psi-artifact-bar");
	const close = () => {
		card.classList.remove("is-expanded");
		toggle.textContent = "Open full screen";
		toggle.setAttribute("aria-expanded", "false");
		document.removeEventListener("keydown", onKey);
	};
	const onKey = (event) => { if (event.key === "Escape") close(); };
	const toggle = button("Open full screen", async () => {
		if (card.classList.contains("is-expanded")) { close(); return; }
		try {
			if (typeof frame.requestFullscreen === "function") { await frame.requestFullscreen(); return; }
		} catch { /* Fall back to an in-page overlay. */ }
		card.classList.add("is-expanded");
		toggle.textContent = "Close full screen";
		toggle.setAttribute("aria-expanded", "true");
		document.addEventListener("keydown", onKey);
	});
	toggle.setAttribute("aria-expanded", "false");
	bar.append(toggle);
	card.append(bar, frame);
	return card;
}

/** Render a supported tool result, or return null so chat can show its normal fallback. */
export function renderToolWidget(toolName, args, result, ctx = {}) {
	const kind = widgetKindFor(toolName, result);
	if (!kind) return null;
	const d = dataFor(result);
	if (kind === "challenge") return challengeSheet(d, ctx);
	if (kind === "attempt") return attemptNote(d);
	if (kind === "graph") {
		const details = node("details", "psi-widget psi-graph");
		details.append(node("summary", "", "Concept graph source"), node("pre", "", d.mermaid));
		return details;
	}
	if (kind === "artifact") return artifactFrame(toolName, result);
	if (kind === "plan") return skillPlan(d);
	return progressReport(d, ctx);
}
