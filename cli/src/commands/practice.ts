import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { slugify } from "../../../core/src/slug.ts";
import type { Attempt, Challenge } from "../../../core/src/types.ts";
import { progressBar } from "../practice-commands.ts";
import type { PracticeContext } from "../practice-commands.ts";

/** Run a model-free drill; EOF, q, or the time limit always closes the practice session. */
export async function practice(argv: string[], ctx: PracticeContext): Promise<number> {
	let minutes: number | undefined;
	const args: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === "--minutes" || token.startsWith("--minutes=")) {
			const value = token === "--minutes" ? argv[++i] : token.slice("--minutes=".length);
			minutes = Number(value);
			if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--minutes must be a positive number");
		} else if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
		else args.push(token);
	}
	if (args.length !== 1) throw new Error("Usage: psi practice <skill> [--minutes N]");
	const { PracticeStore } = await import("../../../core/src/practice.ts");
	const home = resolve(ctx.home ?? process.env.PSI_HOME ?? join(homedir(), ".psi"));
	const store = new PracticeStore(home);
	const skill = slugify(args[0]);
	const plan = store.readPlan(skill);
	if (!plan) throw new Error(`No plan for ${skill}. Try psi learn and /skill, or psi import-skill.`);
	if (store.activeSession(skill)) throw new Error(`A session for ${skill} is already active; finish it first.`);
	const next = store.nextSubskill(plan);
	const solid = new Set(plan.subskills.filter((s) => s.status === "solid").map((s) => s.id));
	const eligible = plan.subskills.filter((s) => s.status !== "solid" && s.prerequisites.every((id) => solid.has(id)))
		.sort((a, b) => Number(b.id === next?.id) - Number(a.id === next?.id) || a.priority - b.priority);
	const challenges = store.listChallenges(skill);
	const unattempted = new Set(store.listChallenges(skill, { unattempted: true }).map((c) => c.id));
	// PracticeStore exposes no history reader; use its documented append-only disk format for failed retries.
	const historyPath = join(home, "skills", skill, "attempts.jsonl");
	const latest = new Map<string, Attempt>();
	if (existsSync(historyPath)) {
		for (const line of readFileSync(historyPath, "utf8").split("\n").filter((line) => line.trim())) {
			const attempt = JSON.parse(line) as Attempt;
			latest.set(attempt.challengeId, attempt);
		}
	}
	const rank = (c: Challenge) => c.subskillId ? eligible.findIndex((s) => s.id === c.subskillId) : eligible.length;
	const available = challenges.filter((c) => !c.subskillId || rank(c) >= 0)
		.sort((a, b) => rank(a) - rank(b));
	const out = ctx.stdout ?? process.stdout;
	for (const c of available.filter((c) => c.expected === undefined)) {
		out.write(`${c.prompt}\n→ open-ended; run \`psi learn\` and use /practice for these\n`);
	}
	const queue = available.filter((c) => c.expected !== undefined
		&& (unattempted.has(c.id) || latest.get(c.id)?.outcome === "fail"))
		.sort((a, b) => Number(unattempted.has(b.id)) - Number(unattempted.has(a.id)));
	const input = ctx.stdin ?? process.stdin;
	const rl = createInterface({ input, terminal: false });
	const lines = rl[Symbol.asyncIterator]();
	const started = Date.now();
	const deadline = minutes === undefined ? Infinity : started + minutes * 60_000;
	const read = async (prompt: string): Promise<string | undefined> => {
		out.write(prompt);
		const remaining = deadline - Date.now();
		if (remaining <= 0) return undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const line = Number.isFinite(remaining) ? await Promise.race([
				lines.next(), new Promise<undefined>((done) => {
					timer = setTimeout(() => done(undefined), Math.min(remaining, 2_147_483_647));
				}),
			]) : await lines.next();
			return line && !line.done ? line.value.trim() : undefined;
		} finally {
			if (timer) clearTimeout(timer);
		}
	};
	let count = 0;
	let gained = 0;
	let successes = 0;
	let failures = 0;
	let quit = false;
	store.startSession(skill, next?.id);
	out.write(`Practice ${skill}. ? = hint, s = skip, q = quit.\n`
		+ "Fail = +4 XP. Every level is beaten by dying a few times.\n");
	try {
		if (!queue.length) out.write("No auto-gradable challenges ready. Try psi learn and /practice for more.\n");
		for (const c of queue) {
			if (Date.now() >= deadline || quit) break;
			out.write(`\n${c.prompt}\n`);
			let hintsUsed = 0;
			while (true) {
				const elapsed = ((Date.now() - started) / 60_000).toFixed(2);
				const answer = await read(`[${elapsed} minutes elapsed] Answer: `);
				if (answer === undefined || answer.toLowerCase() === "q") { quit = true; break; }
				if (answer === "?") {
					out.write(`${c.hints[hintsUsed] ?? "No more hints. Try a small step."}\n`);
					if (hintsUsed < c.hints.length) hintsUsed++;
					continue;
				}
				const skipped = answer.toLowerCase() === "s";
				const outcome = skipped ? "skipped" : store.checkAnswer(c, answer);
				if (outcome === undefined) {
					out.write("→ open-ended; run `psi learn` and use /practice for these\n");
					break;
				}
				let lesson: string | undefined;
				if (outcome === "fail") {
					out.write("A useful attempt. You can try again next time.\n");
					const reflection = await read("What will you try differently? (optional; Enter to continue, q to quit): ");
					if (reflection === undefined || reflection.toLowerCase() === "q") quit = true;
					else lesson = reflection || undefined;
				}
				const result = store.recordAttempt({ challengeId: c.id, skill, answer, outcome, hintsUsed, lesson,
					source: skipped ? "tutor" : "checked", verified: !skipped });
				count++;
				gained += result.attempt.xp;
				if (outcome === "success") successes++;
				if (outcome === "fail") failures++;
				out.write(`${outcome}: +${result.attempt.xp} XP${lesson ? " (lesson bonus included)" : ""}\n`);
				if (result.leveledUp) out.write(`Level up! Level ${result.progress.level}.\n`);
				if (result.badges.length) out.write(`Badges earned: ${result.badges.join(", ")}\n`);
				break;
			}
		}
	} finally {
		rl.close();
		const session = store.endSession(skill);
		const elapsed = session?.minutes ?? (Date.now() - started) / 60_000;
		if (Date.now() >= deadline) out.write("Time is up.\n");
		const h = store.hours(skill);
		out.write(`Session: ${count} attempts, ${successes} success, ${failures} fail, +${gained} XP; `
			+ `${elapsed.toFixed(2)} minutes.\n`
			+ `${skill} ${progressBar(h.logged, h.goal)} ${h.logged.toFixed(2)} / ${h.goal} hours\n`);
	}
	return 0;
}
