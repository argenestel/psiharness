import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { PracticeDeps } from "./index.ts";

/** Register learner-facing practice commands using only shared pi/omp surfaces. */
export function registerCommands(pi: ExtensionAPI, deps: PracticeDeps): void {
	const { memory, practice, state } = deps;
	const requireSkill = (ctx: ExtensionCommandContext): string | undefined => {
		if (!state.skill) ctx.ui.notify("Choose a skill with /skill <what to learn> first.", "warning");
		return state.skill;
	};
	pi.registerCommand("skill", {
		description: "Deconstruct a skill into a first-20-hours practice plan",
		async handler(args, ctx) {
			if (!args.trim()) { ctx.ui.notify("Usage: /skill <what to learn>", "info"); return; }
			deps.activate(args);
			deps.refresh(ctx);
			pi.sendUserMessage(`Help me learn ${JSON.stringify(args.trim())}. Active skill slug: ${state.skill}.
Follow Josh Kaufman's first 20 hours: ask my target performance, current level, and time per day.
Then use psi_skill_plan create to deconstruct the skill into prioritized subskills with self-correction drills.
List practice barriers and fixes; choose at most 3 resources, just enough to self-correct. Set hoursGoal to 20.
Gather 3–6 sources with psi_search, psi_fetch, psi_sources add; write and show a psi_lesson before psi_challenge.`);
		},
	});
	pi.registerCommand("practice", {
		description: "Start a practice block: /practice [focus] [minutes=20]",
		async handler(args, ctx) {
			const skill = requireSkill(ctx);
			if (!skill) return;
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const tail = parts.at(-1);
			const minutes = tail && /^\d+(?:\.\d+)?$/.test(tail) ? Number(parts.pop()) : 20;
			if (!(minutes > 0 && minutes <= 180)) {
				ctx.ui.notify("Choose a practice block between 0 and 180 minutes.", "warning"); return;
			}
			const focus = parts.join(" ") || undefined;
			const hasSession = !!practice.activeSession(skill);
			const hasPlan = !!practice.readPlan(skill);
			state.plannedMinutes = minutes;
			deps.refresh(ctx);
			pi.sendUserMessage(`Practice ${skill}; focus: ${JSON.stringify(focus ?? "next subskill")};
planned block: ${minutes} minutes.
${hasSession ? "Use psi_practice_session status to track elapsed time."
	: "First call psi_practice_session with action start; there is no active session."}
${hasPlan ? "A saved plan exists; begin practising immediately with no planning step."
	: "No plan exists; only then use psi_skill_plan create to make a short plan."}
Then call psi_challenge with action "next" to serve ready challenges when they exist.
Only if none remain, use action "create". Give one challenge at a time. Wait for my prediction/attempt before explaining.
Offer hints only on request, grade via psi_attempt, celebrate failed experiments and extract a lesson.
When the block ends, stop the session, save psi_recap, and remember durable learning observations.`);
		},
	});
	for (const [name, description, instruction] of [
		["challenge", "Try one fresh challenge", "Create one new psi_challenge; wait for my attempt before explaining."],
		["boss", "Try a mixed harder challenge",
			"Create one harder boss challenge mixing solid subskills; wait for my attempt."],
		["quest", "Build a small project to learn",
			"Design a small build-to-learn project with 3–5 milestones. Use build challenges one milestone at a time."],
		["recap", "End this block with a saved recap",
			"Stop the active practice session. Save psi_recap with wins, struggles, minutes, and a concrete next step; "
				+ "save durable memory observations."],
	]) {
		pi.registerCommand(name, {
			description,
			async handler(args, ctx) {
				const skill = requireSkill(ctx);
				if (skill) pi.sendUserMessage(`Active skill: ${skill}. ${instruction} Request: ${JSON.stringify(args)}`);
			},
		});
	}
	pi.registerCommand("hint", {
		description: "Show the next hint for the current challenge",
		async handler(_args, ctx) {
			const skill = requireSkill(ctx);
			if (!skill) return;
			const c = state.challengeId ? practice.getChallenge(skill, state.challengeId) : undefined;
			if (!c) { ctx.ui.notify("No current challenge. Try /challenge.", "info"); return; }
			if (state.hintIndex >= c.hints.length) {
				ctx.ui.notify("No more hints in this ladder. Try an attempt or ask for feedback.", "info"); return;
			}
			ctx.ui.notify(`Hint ${state.hintIndex + 1}/${c.hints.length}: ${c.hints[state.hintIndex++]}`, "info");
		},
	});
	pi.registerCommand("remember", {
		description: "Save a learning preference directly, without a model call",
		async handler(args, ctx) {
			if (!args.trim()) { ctx.ui.notify("Usage: /remember <fact about your learning>", "info"); return; }
			const item = memory.remember({ kind: "preference", text: args.trim(), skill: state.skill, source: "learner" });
			ctx.ui.notify(`Remembered ${item.id}: ${item.text}`, "info");
		},
	});
	pi.registerCommand("memory", {
		description: "List learner memory with ids",
		async handler(_args, ctx) {
			const items = memory.read().items;
			ctx.ui.notify(items.map((m) => `${m.id} [${m.kind}] ${m.text}`).join("\n") || "No memories yet.", "info");
		},
	});
	pi.registerCommand("forget", {
		description: "Delete one learner memory by id",
		async handler(args, ctx) {
			if (!args.trim()) { ctx.ui.notify("Usage: /forget <id>", "info"); return; }
			ctx.ui.notify(memory.forget(args.trim()) ? "Memory forgotten." : "Memory id not found.", "info");
		},
	});
	pi.registerCommand("hours", {
		description: "Show practice hours toward your goal",
		async handler(_args, ctx) {
			const skill = requireSkill(ctx);
			if (!skill) return;
			const h = practice.hours(skill);
			ctx.ui.notify(`${skill}: ${h.logged.toFixed(2)}/${h.goal} hours practiced.`, "info");
		},
	});
	pi.registerCommand("streak", {
		description: "Show your current practice streak",
		async handler(_args, ctx) {
			const skill = requireSkill(ctx);
			if (skill) ctx.ui.notify(`🔥 ${practice.progress(skill).streakDays} day practice streak.`, "info");
		},
	});
}
