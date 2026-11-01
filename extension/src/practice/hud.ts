import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PracticeStore } from "../../../core/src/practice.ts";
import * as gamify from "../../../core/src/gamify.ts";
import { ProfileStore } from "../../../core/src/profile.ts";
import type { GameLayer } from "../../../core/src/types.ts";
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

/** The learner's game-layer setting; "on" when the profile can't be read. */
function gameLayer(deps: PracticeDeps): GameLayer {
	try { return new ProfileStore(deps.practice.root).read().gameLayer ?? "on"; } catch { return "on"; }
}

/** Footer text: with the game layer off, only learning progress (hours) is shown — no level, XP bar or streak. */
export function statusLine(p: ReturnType<typeof progressReport>, layer: GameLayer): string {
	const hours = `${p.hours.logged.toFixed(1)}/${p.hours.goal}h`;
	if (layer === "off") return `ψ ${p.skill} · ${hours}`;
	return `ψ ${p.skill} · Lv ${p.level}${layer === "quiet" ? "" : ` ${p.levelBar}`} · 🔥${p.streak} · ${hours}`;
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
	ctx.ui.setStatus("psi-practice", statusLine(p, gameLayer(deps)));
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
