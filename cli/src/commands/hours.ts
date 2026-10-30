import { progressBar } from "../practice-commands.ts";
import type { PracticeContext } from "../practice-commands.ts";

/** Show deliberate practice time against each skill's goal. */
export async function hours(argv: string[], ctx: PracticeContext): Promise<number> {
	if (argv.length > 1 || argv[0]?.startsWith("-")) throw new Error("Usage: psi hours [skill]");
	const { PracticeStore } = await import("../../../core/src/practice.ts");
	const store = new PracticeStore(ctx.home ?? process.env.PSI_HOME);
	const out = ctx.stdout ?? process.stdout;
	const skills = argv.length ? argv : store.listSkills();
	out.write("The first 20 hours: deconstruct the skill, practice the essentials, and learn to self-correct.\n");
	for (const skill of skills) {
		const h = store.hours(skill);
		out.write(`${skill} ${progressBar(h.logged, h.goal)} ${h.logged.toFixed(2)} / ${h.goal} hours\n`);
	}
	if (!skills.length) out.write("No skills yet.\n");
	return 0;
}
