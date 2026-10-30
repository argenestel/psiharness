/** Streams and storage override for terminal practice commands. */
export interface PracticeContext {
	home?: string;
	stdin?: NodeJS.ReadableStream;
	stdout?: NodeJS.WritableStream;
}

/** Render bounded progress using plain terminal characters. */
export function progressBar(value: number, goal: number): string {
	const filled = Math.round(Math.max(0, Math.min(1, goal > 0 ? value / goal : 0)) * 20);
	return `[${"#".repeat(filled)}${"-".repeat(20 - filled)}]`;
}

/** Practice-first dispatch entries; argv excludes the command name. Errors go to the supplied stdout. */
export const PRACTICE_COMMANDS: {
	name: string;
	usage: string;
	summary: string;
	run(argv: string[], ctx: PracticeContext): Promise<number>;
}[] = [
	{ name: "skills", usage: "skills", summary: "List skills and the next practice step",
		run: async (argv: string[], ctx: PracticeContext) => (await import("./commands/skills.ts")).skills(argv, ctx) },
	{ name: "practice", usage: "practice <skill> [--minutes N]", summary: "Drill auto-gradable challenges",
		run: async (argv: string[], ctx: PracticeContext) => (await import("./commands/practice.ts")).practice(argv, ctx) },
	{ name: "hours", usage: "hours [skill]", summary: "Show hours toward the first 20 hours",
		run: async (argv: string[], ctx: PracticeContext) => (await import("./commands/hours.ts")).hours(argv, ctx) },
	{ name: "memory", usage: "memory [list|add <kind> <text>|forget <id>|name <name>|show]",
		summary: "Inspect and edit learner memory",
		run: async (argv: string[], ctx: PracticeContext) => (await import("./commands/memory.ts")).memory(argv, ctx) },
	{ name: "progress", usage: "progress [skill]", summary: "Show XP, streaks, and badges",
		run: async (argv: string[], ctx: PracticeContext) => (await import("./commands/progress.ts")).progress(argv, ctx) },
	{ name: "import-skill", usage: "import-skill <dir> [--force]", summary: "Import a practice skill pack",
		run: async (argv: string[], ctx: PracticeContext) =>
			(await import("./commands/import-skill.ts")).importSkill(argv, ctx) },
].map((command) => ({ ...command, run: async (argv: string[], ctx: PracticeContext) => {
	try {
		return await command.run(argv, ctx);
	} catch (error) {
		(ctx.stdout ?? process.stdout).write(`psi: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
} }));
