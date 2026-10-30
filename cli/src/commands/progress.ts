import { progressBar } from "../practice-commands.ts";
import type { PracticeContext } from "../practice-commands.ts";

/** Show XP, levels, streaks, attempts, and earned badges. */
export async function progress(argv: string[], ctx: PracticeContext): Promise<number> {
	if (argv.length > 1 || argv[0]?.startsWith("-")) throw new Error("Usage: psi progress [skill]");
	const { PracticeStore } = await import("../../../core/src/practice.ts");
	const { levelFor } = await import("../../../core/src/gamify.ts");
	const store = new PracticeStore(ctx.home ?? process.env.PSI_HOME);
	const out = ctx.stdout ?? process.stdout;
	const skills = argv.length ? argv : store.listSkills();
	for (const skill of skills) {
		const p = store.progress(skill);
		const level = levelFor(p.xp);
		out.write(`${skill}: ${p.xp} XP | Level ${level.level} `
			+ `${progressBar(level.intoLevel, level.intoLevel + level.toNext)} | ${level.toNext} XP to next level\n`
			+ `Streak: ${p.streakDays} days | Attempts: ${p.attempts} | Success: ${p.successes} | Fail: ${p.failures}\n`
			+ `Badges: ${p.badges.join(", ") || "none yet"}\n`);
	}
	if (!skills.length) out.write("No skills yet.\n");
	return 0;
}
