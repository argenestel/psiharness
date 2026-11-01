import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemoryStore } from "../../../core/src/memory.ts";
import { PracticeStore } from "../../../core/src/practice.ts";
import { StateStore } from "../../../core/src/state.ts";
import { slugify } from "../../../core/src/slug.ts";
import { registerTools } from "./tools.ts";
import { registerCommands } from "./commands.ts";
import { registerInjection } from "./inject.ts";
import { registerPaths } from "./paths.ts";
import { registerLessons } from "./lessons.ts";
import { registerRun } from "./run.ts";
import { registerFlow } from "./flow.ts";
import { registerGuards } from "./guards.ts";
import { refreshHud } from "./hud.ts";

export interface PracticeState {
	skill?: string;
	challengeId?: string;
	hintIndex: number;
	plannedMinutes?: number;
}

export interface PracticeDeps {
	memory: MemoryStore;
	practice: PracticeStore;
	state: PracticeState;
	resume(): void;
	persist(): void;
	activate(skill: string): void;
	refresh(ctx: ExtensionContext): void;
}

/** Register the text-first practice tools, commands, and learner context. */
export function registerPractice(pi: ExtensionAPI, options: { home?: string } = {}): void {
	const state: PracticeState = { hintIndex: 0 };
	const savedState = new StateStore(options.home);
	let timer: ReturnType<typeof setInterval> | undefined;
	const clearTimer = () => { if (timer) clearInterval(timer); timer = undefined; };
	const deps: PracticeDeps = {
		memory: new MemoryStore(options.home), practice: new PracticeStore(options.home), state,
		resume() {
			if (state.skill) return;
			const saved = savedState.read();
			state.skill = saved.activeSkill;
			if (saved.openChallenge && saved.openChallenge.skill === state.skill) state.challengeId = saved.openChallenge.id;
		},
		persist() {
			savedState.update({ activeSkill: state.skill,
				openChallenge: state.skill && state.challengeId ? { skill: state.skill, id: state.challengeId } : undefined });
			pi.appendEntry("psi-practice", { skill: state.skill, challengeId: state.challengeId });
		},
		activate(skill) {
			const normalized = slugify(skill);
			if (!normalized) throw new Error("Choose a skill with /skill <what to learn>.");
			if (state.skill !== normalized) {
				state.challengeId = undefined;
				state.hintIndex = 0;
				state.plannedMinutes = undefined;
			}
			state.skill = normalized;
			deps.persist();
		},
		refresh(ctx) {
			refreshHud(ctx, deps);
			clearTimer();
			if (state.skill && deps.practice.activeSession(state.skill)) {
				timer = setInterval(() => refreshHud(ctx, deps), 15000);
				timer.unref();
			}
		},
	};
	pi.registerFlag("psi-skill", { type: "string", description: "Start practicing this skill slug" });
	deps.resume();
	registerTools(pi, deps);
	registerRun(pi);
	registerFlow(pi);
	registerLessons(pi, deps);
	registerCommands(pi, deps);
	const paths = registerPaths(pi, options.home);
	registerInjection(pi, deps, paths.injection);
	registerGuards(pi, deps);
	pi.on("session_start", async (_event, ctx) => {
		state.skill = undefined;
		state.challengeId = undefined;
		state.hintIndex = 0;
		state.plannedMinutes = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== "psi-practice") continue;
			const saved = entry.data as { skill?: unknown; challengeId?: unknown } | undefined;
			if (typeof saved?.skill === "string") {
				state.skill = slugify(saved.skill) || undefined;
				state.challengeId = typeof saved.challengeId === "string" ? saved.challengeId : undefined;
			}
		}
		deps.resume();
		const flag = pi.getFlag("psi-skill");
		if (typeof flag === "string" && slugify(flag)) deps.activate(flag);
		const recap = deps.memory.recentRecaps(1)[0];
		if (recap) {
			const name = deps.memory.read().name;
			ctx.ui.notify(`Welcome back${name ? ` ${name}` : ""} — last time: ${recap.summary}. Next: ${recap.next}`, "info");
		}
		deps.refresh(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => deps.refresh(ctx));
	pi.on("session_shutdown", async () => clearTimer());
}
