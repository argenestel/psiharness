import { table } from "../term.ts";
import { progressBar } from "../practice-commands.ts";
import type { PracticeContext } from "../practice-commands.ts";

/** List skills with practice progress and the next available subskill. */
export async function skills(argv: string[], ctx: PracticeContext): Promise<number> {
	if (argv.length) throw new Error("Usage: psi skills");
	const { PracticeStore } = await import("../../../core/src/practice.ts");
	const store = new PracticeStore(ctx.home ?? process.env.PSI_HOME);
	const rows = store.listSkills().map((skill) => {
		const plan = store.readPlan(skill);
		const p = store.progress(skill);
		const h = store.hours(skill);
		return [skill, `${p.level}`, `${p.xp}`, `${p.streakDays} days`,
			`${progressBar(h.logged, h.goal)} ${h.logged.toFixed(2)}/${h.goal} h`,
			plan ? store.nextSubskill(plan)?.title ?? "Complete" : "No plan"];
	});
	(ctx.stdout ?? process.stdout).write(rows.length
		? `${table(["Skill", "Level", "XP", "Streak", "Hours", "Next subskill"], rows)}\n`
		: "No skills yet. Try psi learn and /skill <thing to learn>.\n");
	return 0;
}
