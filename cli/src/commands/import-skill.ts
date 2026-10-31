import { LessonStore } from "../../../core/src/lessons.ts";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { slugify } from "../../../core/src/slug.ts";
import type { PracticeContext } from "../practice-commands.ts";

/** Import a skill plan and challenges, preserving learner history even with --force. */
export async function importSkill(argv: string[], ctx: PracticeContext): Promise<number> {
	const force = argv.includes("--force");
	const args = argv.filter((arg) => arg !== "--force");
	if (args.length !== 1 || args[0].startsWith("-")) throw new Error("Usage: psi import-skill <dir> [--force]");
	const source = resolve(args[0]);
	const planText = readFileSync(join(source, "plan.json"), "utf8");
	const challengesText = readFileSync(join(source, "challenges.json"), "utf8");
	const plan = JSON.parse(planText);
	const challenges = JSON.parse(challengesText);
	if (!plan || typeof plan.skill !== "string" || !slugify(plan.skill)) {
		throw new Error("plan.json must contain a non-empty skill name");
	}
	if (!Array.isArray(challenges)) throw new Error("challenges.json must contain an array");
	const slug = slugify(plan.skill);
	const home = resolve(ctx.home ?? process.env.PSI_HOME ?? join(homedir(), ".psi"));
	const target = join(home, "skills", slug);
	for (const path of [join(home, "skills"), target, join(target, "plan.json"), join(target, "challenges.json")]) {
		try {
			if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symlink inside store: ${path}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	if (existsSync(target) && !force) throw new Error(`Skill ${slug} already exists; use --force to overwrite the pack`);
	// Normalize identity alongside the destination so imported packs can be read and practiced immediately.
	plan.skill = slug;
	const normalized = challenges.map((challenge) => ({ ...challenge, skill: slug }));
	mkdirSync(target, { recursive: true });
	writeFileSync(join(target, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
	writeFileSync(join(target, "challenges.json"), JSON.stringify(normalized, null, 2) + "\n");

	const sourcesFile = join(source, "sources.json");
	if (existsSync(sourcesFile) && lstatSync(sourcesFile).isFile()) {
		const destination = join(target, "sources.json");
		if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
			throw new Error("Refusing sources symlink inside store");
		}
		const sources = JSON.parse(readFileSync(sourcesFile, "utf8"));
		if (!Array.isArray(sources)) throw new Error("sources.json must contain an array");
		copyFileSync(sourcesFile, destination);
	}
	const lessonDirectory = join(source, "lessons");
	const lessons = new LessonStore(home);
	if (existsSync(lessonDirectory) && lstatSync(lessonDirectory).isDirectory()) {
		for (const entry of readdirSync(lessonDirectory, { withFileTypes: true })) {
			if (!entry.isFile() || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(entry.name)) continue;
			try {
				const id = entry.name.slice(0, -5);
				const lesson = JSON.parse(readFileSync(join(lessonDirectory, entry.name), "utf8"));
				const errors = lessons.validate(slug, id, lesson);
				if (errors.length) throw new Error(errors.join("; "));
				lessons.write(slug, id, lesson);
			} catch (error) {
				const warning = `Skipped lesson ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
				process.stderr.write(`${warning}\n`);
			}
		}
	}
	(ctx.stdout ?? process.stdout).write(`Imported ${slug} -> ${target}\n`);
	return 0;
}
