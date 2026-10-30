import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PracticeStore } from "../../../core/src/practice.ts";
import * as gamify from "../../../core/src/gamify.ts";
import type { PracticeDeps } from "./index.ts";

/** A small clamped progress bar. */
export function bar(value: number, total: number): string {
	const filled = Math.round(Math.max(0, Math.min(1, total > 0 ? value / total : 0)) * 10);
	return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

/** Summarize stored practice evidence for one skill. */
export function progressReport(practice: PracticeStore, skill: string) {
	const progress = practice.progress(skill);
	const level = gamify.levelFor(progress.xp);
	const hours = practice.hours(skill);
	const plan = practice.readPlan(skill);
	return {
		skill, xp: progress.xp, level: level.level, intoLevel: level.intoLevel, toNext: level.toNext,
		levelBar: bar(level.intoLevel, level.intoLevel + level.toNext), streak: progress.streakDays,
		hours, hoursBar: bar(hours.logged, hours.goal), successes: progress.successes,
		failures: progress.failures, attempts: progress.attempts, badges: progress.badges,
		nextSubskill: plan ? practice.nextSubskill(plan) : undefined,
	};
}

/** Refresh the plain-text footer and active session widget without exposing answers. */
export function refreshHud(ctx: ExtensionContext, deps: PracticeDeps): void {
	const { skill, challengeId, plannedMinutes } = deps.state;
	if (!skill) {
		ctx.ui.setStatus("psi-practice", undefined);
		ctx.ui.setWidget("psi-practice", undefined);
		return;
	}
	const p = progressReport(deps.practice, skill);
	ctx.ui.setStatus("psi-practice", `ψ ${skill} · Lv ${p.level} ${p.levelBar} · 🔥${p.streak}`
		+ ` · ${p.hours.logged.toFixed(1)}/${p.hours.goal}h`);
	const session = deps.practice.activeSession(skill);
	if (!session) {
		ctx.ui.setWidget("psi-practice", undefined);
		return;
	}
	const elapsed = Math.max(0, (Date.now() - Date.parse(session.startedAt)) / 60000);
	const challenge = challengeId ? deps.practice.getChallenge(skill, challengeId) : undefined;
	ctx.ui.setWidget("psi-practice", [
		`ψ Practice · ${elapsed.toFixed(1)}/${plannedMinutes ?? 20} min`,
		challenge?.prompt ?? "Ready for your next attempt.",
	]);
}
