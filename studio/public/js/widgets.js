import { createCodeEditor, runCode } from "./codelab.js";

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
		case "psi_memory_remember": return typeof d.text === "string" ? "memory" : null;
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
function button(text, action) {
	const el = node("button", "", text);
	el.type = "button";
	el.addEventListener("click", action);
	return el;
}
function chips(parent, values) {
	for (const value of values ?? []) parent.append(node("span", "psi-chip", value));
}
function progress(parent, label, value, total) {
	parent.append(node("span", "psi-progress-label", label));
	const bar = node("progress", "psi-progress-bar");
	bar.max = Number(total) > 0 ? Number(total) : 1;
	bar.value = Math.max(0, Math.min(bar.max, Number(value) || 0));
	bar.setAttribute("aria-label", label);
	parent.append(bar);
}
function levelProgress(parent, d) {
	if (typeof d.levelBar === "string") {
		const blocks = [...d.levelBar].filter((char) => char === "▰" || char === "▱");
		progress(parent, `Level ${d.level ?? 1}`, blocks.filter((char) => char === "▰").length, blocks.length);
	} else {
		const level = Math.max(1, Number(d.level) || 1);
		// Match core gamify.levelFor: the threshold for level L is 25 * (L - 1) * L.
		const into = d.intoLevel ?? Math.max(0, (d.totalXp ?? d.xp ?? 0) - 25 * (level - 1) * level);
		progress(parent, `Level ${level}`, into, d.toNext === undefined ? 50 * level : into + d.toNext);
	}
}
function countUp(el, xp) {
	const target = Number(xp) || 0;
	el.textContent = `+${target} XP`;
	if (typeof requestAnimationFrame !== "function" || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
		return;
	}
	const start = performance.now();
	const tick = (now) => {
		const fraction = Math.min(1, (now - start) / 450);
		el.textContent = `+${Math.round(target * fraction)} XP`;
		if (fraction < 1) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}
function attemptCard(d) {
	const card = node("section", "psi-widget psi-attempt psi-result");
	card.setAttribute("role", "status");
	card.append(node("strong", "", `${d.outcome === "success" ? "✓" : "✗"} ${d.outcome}`));
	const xp = node("span", "psi-xp");
	card.append(xp);
	countUp(xp, d.xp);
	levelProgress(card, d);
	if (d.leveledUp) card.append(node("strong", "psi-level-up", "✦ Level up!"));
	chips(card, d.badges);
	card.append(node("small", "psi-streak", `${d.streak ?? d.streakDays ?? 0} day streak`));
	return card;
}
async function markdown(el, text) {
	el.textContent = text;
	try {
		const mod = await import("./markdown.js");
		if (typeof mod.renderMarkdown !== "function") return;
		const rendered = await mod.renderMarkdown(text);
		if (typeof rendered === "string") el.innerHTML = rendered;
		else if (rendered instanceof Node) el.replaceChildren(rendered);
	} catch { el.textContent = text; }
}
function notify(ctx, message) {
	try { ctx.toast?.(message); } catch { /* A host notification must not interrupt card state. */ }
}
async function send(ctx, message) {
	try { await ctx.send?.(message); }
	catch { notify(ctx, "Your result was saved, but chat could not continue. Please send a message to your tutor."); }
}
function challengeCard(d, ctx) {
	const card = node("section", "psi-widget psi-challenge");
	chips(card, [d.kind, `Level ${d.level}`]);
	const prompt = node("div", "psi-prompt");
	card.append(prompt);
	void markdown(prompt, d.prompt ?? "");
	const fields = node("fieldset", "psi-answer-fields");
	fields.append(node("legend", "", "Your answer"));
	card.append(fields);
	const format = d.format ?? "text";
	let input, editor;
	if (format === "code") {
		const mount = node("div");
		fields.append(mount);
		editor = createCodeEditor(mount, { language: d.language, value: d.starterCode ?? "", onRun: () => run.click() });
	} else if (format === "choice") {
		(d.choices ?? []).forEach((choice, i) => {
			const label = node("label", "psi-choice");
			const radio = node("input");
			radio.type = "radio";
			// One group per card; the answer is the option text, as Challenge.expected requires.
			radio.name = card.dataset.choiceGroup ??= `psi-group-${++choiceId}`;
			radio.value = choice;
			label.append(radio, node("span", "", `${String.fromCharCode(65 + i)}. ${choice}`));
			fields.append(label);
		});
	} else {
		input = node(format === "text" ? "textarea" : "input", "psi-answer-input");
		if (input.tagName === "INPUT") input.type = format === "number" ? "number" : "text";
		if (format === "number") input.step = "any";
		input.setAttribute("aria-label", "Your answer");
		fields.append(input);
		if (d.unit) fields.append(node("span", "psi-unit", d.unit));
		if (format === "math") {
			const preview = node("div", "psi-math-preview");
			preview.setAttribute("aria-live", "polite");
			input.addEventListener("input", () => {
				preview.textContent = input.value;
				try { globalThis.katex?.render(input.value, preview, { throwOnError: false, trust: false }); }
				catch { preview.textContent = input.value; }
			});
			fields.append(preview);
		}
	}
	const actions = node("div", "psi-widget-actions");
	const hints = node("div", "psi-hints");
	hints.setAttribute("aria-live", "polite");
	const output = node("pre", "psi-run-output");
	output.hidden = true;
	output.setAttribute("role", "status");
	let hintsUsed = 0, busy = false, graded = false, hintBusy = false;
	const endpoint = `/api/skills/${encodeURIComponent(d.skill)}/challenges/${encodeURIComponent(d.id)}`;
	const answer = () => editor ? editor.getValue() : format === "choice"
		? fields.querySelector("input:checked")?.value ?? "" : input.value;
	const sync = () => {
		fields.disabled = busy || graded;
		submit.disabled = busy || graded || hintBusy;
		run.disabled = busy || graded;
		hint.disabled = busy || graded || hintBusy || hintsUsed >= (d.hintsCount ?? 0);
	};
	const hint = button("Hint", async () => {
		if (hint.disabled) return;
		hintBusy = true; sync();
		try {
			// The REST hint API uses zero-based n (the extension tool itself uses one-based n).
			const response = await ctx.api.get(`${endpoint}/hint?n=${hintsUsed}`);
			if (response.hint != null) { hintsUsed++; hints.append(node("p", "", response.hint)); }
			else hintsUsed = d.hintsCount ?? 0;
		} catch { notify(ctx, "Couldn't load that hint. Try again when you're ready."); }
		finally { hintBusy = false; sync(); }
	});
	const execute = async (code) => {
		const result = await runCode({ language: d.language, setup: d.setup, code, tests: d.tests, expected: d.expected });
		output.hidden = false;
		output.className = `psi-run-output ${result.ok ? "is-ok" : "is-error"}`;
		output.textContent = [result.output, result.error, result.ok ? "✓ Tests passed" : "✗ Run failed",
			`${Math.round(result.ms)} ms`].filter(Boolean).join("\n");
		return result;
	};
	const run = button("Run", async () => {
		if (busy || graded) return;
		busy = true; sync();
		try { await execute(answer()); }
		catch { notify(ctx, "Couldn't run your code. Your work is still here; please retry."); }
		finally { busy = false; sync(); }
	});
	const submit = button("Submit", async () => {
		if (busy || graded || hintBusy) return;
		const value = answer();
		if (!value.trim()) { notify(ctx, "Add an answer first — a guess is welcome."); return; }
		busy = true; sync();
		try {
			const body = { answer: value, hintsUsed };
			if (format === "code") body.outcome = (await execute(value)).ok ? "success" : "fail";
			const response = await ctx.api.post(`${endpoint}/attempt`, body);
			graded = true;
			const a = response.attempt;
			const p = response.progress ?? {};
			card.append(attemptCard({ ...p, ...a, totalXp: p.xp, leveledUp: response.leveledUp, badges: response.badges }));
			// Send one short continuation for every saved attempt. Send a lesson follow-up only for a filled fail lesson.
			void send(ctx, `Answered challenge ${d.id}: ${value} (${a.outcome}, +${a.xp} XP)`);
			if (a.outcome === "fail") {
				const label = node("label", "psi-lesson", "What will you try differently?");
				const lesson = node("textarea", "psi-answer-input");
				label.append(lesson);
				const share = button("Share lesson", async () => {
					if (!lesson.value.trim()) { notify(ctx, "Write a lesson before sharing it."); return; }
					share.disabled = true; lesson.disabled = true;
					await send(ctx, `My answer to challenge ${d.id}: ${value} — result: ${a.outcome}. Lesson: ${lesson.value.trim()}`);
				});
				card.append(label, share);
			}
		} catch { notify(ctx, "Couldn't save your attempt. Your answer is still here; please retry."); }
		finally { busy = false; sync(); }
	});
	actions.append(hint);
	if (format === "code") actions.append(run);
	actions.append(submit);
	card.append(hints, actions, output);
	sync();
	return card;
}
let choiceId = 0;

/** Render a supported tool result, or return null so chat can show its normal fallback. */
export function renderToolWidget(toolName, args, result, ctx = {}) {
	const kind = widgetKindFor(toolName, result);
	if (!kind) return null;
	const d = dataFor(result);
	if (kind === "challenge") return challengeCard(d, ctx);
	if (kind === "attempt") return attemptCard(d);
	if (kind === "memory") return node("span", "psi-memory-chip", `ψ remembered: ${d.text}`);
	if (kind === "graph") {
		const details = node("details", "psi-widget psi-graph");
		details.append(node("summary", "", "Concept graph source"), node("pre", "", d.mermaid));
		return details;
	}
	if (kind === "artifact") {
		const card = node("section", "psi-widget psi-artifact");
		const frame = node("iframe");
		frame.setAttribute("sandbox", "allow-scripts");
		frame.title = toolName === "psi_storyboard" ? "Lesson storyboard" : "Interactive explorable";
		frame.loading = "lazy";
		frame.src = artifactPath(result);
		const expand = button("Expand", () => {
			const expanded = card.classList.toggle("is-expanded");
			expand.textContent = expanded ? "Collapse" : "Expand";
			expand.setAttribute("aria-expanded", String(expanded));
		});
		expand.setAttribute("aria-expanded", "false");
		card.append(expand, frame);
		return card;
	}
	const card = node("section", "psi-widget");
	if (kind === "plan") {
		const plan = d.plan ?? d;
		card.append(node("h3", "", plan.title ?? "Skill plan"));
		const list = node("ul", "psi-skill-checklist");
		for (const skill of [...plan.subskills].sort((a, b) => a.priority - b.priority)) {
			const item = node("li");
			const check = node("input");
			check.type = "checkbox"; check.checked = skill.status === "solid"; check.disabled = true;
			check.setAttribute("aria-label", skill.title);
			item.append(check, node("span", "", skill.title),
				node("small", "psi-chip", `Priority ${skill.priority} · ${skill.status}`));
			list.append(item);
		}
		card.append(list);
	} else {
		for (const report of d.skills ?? [d]) {
			const section = node("div", "psi-progress-report");
			section.append(node("h3", "", report.skill ?? "Practice progress"));
			levelProgress(section, report);
			const hours = report.hours ?? { logged: (report.minutesLogged ?? 0) / 60, goal: 20 };
			progress(section, `${formatAnswer(hours.logged)} / ${hours.goal} hours`, hours.logged, hours.goal);
			section.append(node("p", "", `${report.streak ?? report.streakDays ?? 0} day streak`));
			chips(section, report.badges);
			card.append(section);
		}
	}
	return card;
}
