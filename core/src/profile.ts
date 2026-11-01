import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { levelFor, levelTitle } from "./gamify.ts";
import { PracticeStore } from "./practice.ts";
import { SourceStore } from "./sources.ts";
import { newId, nowIso } from "./slug.ts";
import type { Achievement, Attempt, GameProfile, LearnerSummary, PracticeSession } from "./types.ts";

type Context = {
	attempts: Attempt[]; comboMax: number; comeback: boolean; goalMet: boolean; streakMax: number;
	minutes: number; boss: boolean; path: boolean; sources: boolean;
};

/** Achievement definitions; earned flags are evaluated by summarize, never persisted here. */
export const ACHIEVEMENTS: readonly (Achievement & { test: (ctx: Context) => boolean })[] = [
	{ id: "first-attempt", title: "First step", description: "Try a challenge.",
		earned: false, test: (c) => c.attempts.length > 0 },
	{ id: "first-fail", title: "Failure is progress", description: "Miss a challenge and keep learning.",
		earned: false, test: (c) => c.attempts.some((a) => a.outcome === "fail") },
	{ id: "lesson-learned", title: "Lesson learned", description: "Write what a failed attempt taught you.",
		earned: false, test: (c) => c.attempts.some((a) => a.outcome === "fail" && !!a.lesson?.trim()) },
	{ id: "comeback", title: "Comeback", description: "Succeed after a failure on the same challenge or subskill.",
		earned: false, test: (c) => c.comeback },
	{ id: "combo-5", title: "On a roll", description: "Succeed five times in a row in one session.",
		earned: false, test: (c) => c.comboMax >= 5 },
	{ id: "daily-goal-met", title: "Today's goal", description: "Meet your configured daily practice goal.",
		earned: false, test: (c) => c.goalMet },
	...[3, 7, 30].map((days) => ({ id: `streak-${days}`, title: `${days} day streak`,
		description: `Practise on ${days} consecutive days.`, earned: false, test: (c: Context) => c.streakMax >= days })),
	...[1, 5, 20].map((hours) => ({ id: `hour-${hours}`, title: `${hours} practice ${hours === 1 ? "hour" : "hours"}`,
		description: `Log ${hours} ${hours === 1 ? "hour" : "hours"} of practice.`, earned: false, test: (c: Context) => c.minutes >= hours * 60 })),
	{ id: "boss-slayer", title: "Boss slayer", description: "Complete a boss challenge successfully.",
		earned: false, test: (c) => c.boss },
	{ id: "path-maker", title: "Path maker", description: "Create a learning path.",
		earned: false, test: (c) => c.path },
	{ id: "source-checker", title: "Source checker", description: "Collect three sources for one skill.",
		earned: false, test: (c) => c.sources },
];

function day(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
		+ `-${String(date.getDate()).padStart(2, "0")}`;
}

function offset(date: Date, days: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
}

function assertPath(root: string, file: string): void {
	let current = root;
	for (const component of path.relative(root, file).split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		try {
			if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

function readText(root: string, file: string): string | undefined {
	assertPath(root, file);
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function lines<T>(root: string, file: string): T[] {
	return (readText(root, file) ?? "").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

function validate(profile: GameProfile): void {
	if (!profile.dailyGoal || !["challenges", "minutes"].includes(profile.dailyGoal.kind) ||
		!Number.isFinite(profile.dailyGoal.target) || profile.dailyGoal.target <= 0) {
		throw new Error("Daily goal requires a positive target and challenges or minutes kind");
	}
	if (!["teach", "practice", "test"].includes(profile.tutorMode)) throw new Error("Invalid tutor mode");
}

function run(attempts: Attempt[]): { current: number; max: number } {
	let current = 0, max = 0;
	for (const attempt of attempts) {
		current = attempt.outcome === "success" ? current + 1 : 0;
		max = Math.max(max, current);
	}
	return { current, max };
}

/** Learner-wide settings and activity, derived from practice records without modifying them. */
export class ProfileStore {
	private readonly root: string;
	private readonly file: string;

	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.root = path.resolve(home);
		this.file = path.join(this.root, "profile.json");
	}

	/** Read the profile, defaulting to five challenges per day in practice mode. */
	read(): GameProfile {
		const text = readText(this.root, this.file);
		const profile: GameProfile = text === undefined
			? { dailyGoal: { kind: "challenges", target: 5 }, tutorMode: "practice", updatedAt: nowIso() }
			: JSON.parse(text);
		validate(profile);
		return profile;
	}

	/** Validate and atomically merge profile settings. */
	update(patch: Partial<Omit<GameProfile, "updatedAt">>): GameProfile {
		const profile = { ...this.read(), ...patch, updatedAt: nowIso() };
		validate(profile);
		fs.mkdirSync(this.root, { recursive: true });
		assertPath(this.root, this.file);
		const temporary = `${this.file}.${process.pid}.${newId("tmp")}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify(profile, null, "\t") + "\n", { flag: "wx" });
			fs.renameSync(temporary, this.file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
		return profile;
	}

	/** Summarize local-day activity; session minutes are credited to the day the session started. */
	summarize(now = new Date()): LearnerSummary {
		if (!Number.isFinite(now.getTime())) throw new Error("Invalid summary date");
		const profile = this.read(), practice = new PracticeStore(this.root), sources = new SourceStore(this.root);
		const skills = practice.listSkills();
		const attempts = skills.flatMap((skill) =>
			lines<Attempt>(this.root, path.join(this.root, "skills", skill, "attempts.jsonl")))
			.filter((a) => Number.isFinite(Date.parse(a.at)) && Date.parse(a.at) <= now.getTime())
			.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
		const sessions = skills.flatMap((skill) =>
			lines<PracticeSession>(this.root, path.join(this.root, "skills", skill, "sessions.jsonl")))
			.filter((s) => Number.isFinite(Date.parse(s.startedAt)) && Date.parse(s.startedAt) <= now.getTime());
		const today = day(now), counts = new Map<string, number>(), activity = new Set<string>();
		for (const a of attempts) {
			const date = day(new Date(a.at));
			counts.set(date, (counts.get(date) ?? 0) + 1);
			activity.add(date);
		}
		let minutesToday = 0;
		for (const s of sessions) {
			const elapsed = Math.max(0, Math.round((Math.min(now.getTime(),
				s.endedAt ? Date.parse(s.endedAt) : now.getTime()) - Date.parse(s.startedAt)) / 60_000));
			const minutes = Math.min(180, Math.max(0, s.minutes ?? elapsed));
			const date = day(new Date(s.startedAt));
			if (minutes > 0) activity.add(date);
			if (date === today) minutesToday += minutes;
		}
		let streakDays = 0, cursor = activity.has(today) ? now : offset(now, -1);
		while (activity.has(day(cursor))) { streakDays++; cursor = offset(cursor, -1); }
		let streakMax = 0, previous = "", length = 0;
		for (const date of [...activity].sort()) {
			const parsed = new Date(`${date}T12:00:00`);
			length = previous === day(offset(parsed, -1)) ? length + 1 : 1;
			streakMax = Math.max(streakMax, length);
			previous = date;
		}
		const todays = attempts.filter((a) => day(new Date(a.at)) === today);
		const goalMet = (profile.dailyGoal.kind === "minutes" ? minutesToday : todays.length) >= profile.dailyGoal.target;
		const active = practice.activeSession();
		// Without an active session, use today's chronological attempts across all skills.
		const inSession = (s: PracticeSession) => attempts.filter((a) => a.skill === s.skill && s.attemptIds.includes(a.id));
		const combo = run(active ? inSession(active) : todays).current;
		const progress = skills.map((skill) => practice.progress(skill));
		const totalXp = progress.reduce((sum, p) => sum + p.xp, 0), level = levelFor(totalXp).level;
		const failedChallenges = new Set<string>(), failedSubskills = new Set<string>();
		let comeback = false;
		for (const a of attempts) {
			const challenge = `${a.skill}/${a.challengeId}`, subskill = a.subskillId && `${a.skill}/${a.subskillId}`;
			if (a.outcome === "success" && (failedChallenges.has(challenge) ||
				(subskill && failedSubskills.has(subskill)))) comeback = true;
			if (a.outcome === "fail") {
				failedChallenges.add(challenge);
				if (subskill) failedSubskills.add(subskill);
			}
		}
		const bosses = new Set(skills.flatMap((skill) => practice.listChallenges(skill))
			.filter((c) => c.kind === "boss").map((c) => `${c.skill}/${c.id}`));
		const paths = path.join(this.root, "graph", "paths");
		let hasPath = false;
		assertPath(this.root, paths);
		try {
			if (fs.lstatSync(paths).isSymbolicLink()) throw new Error(`Refusing symlink: ${paths}`);
			hasPath = fs.readdirSync(paths, { withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith(".json"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const ctx: Context = { attempts, comeback, goalMet, streakMax,
			comboMax: Math.max(0, ...sessions.map((s) => run(inSession(s)).max)),
			minutes: progress.reduce((sum, p) => sum + p.minutesLogged, 0),
			boss: attempts.some((a) => a.outcome === "success" && bosses.has(`${a.skill}/${a.challengeId}`)),
			path: hasPath, sources: skills.some((skill) => sources.list(skill).length >= 3) };
		const achievements = ACHIEVEMENTS.map(({ test, ...definition }) => {
			const earned = test(ctx);
			const first = definition.id === "first-attempt" ? attempts[0]
				: definition.id === "first-fail" ? attempts.find((a) => a.outcome === "fail")
				: definition.id === "lesson-learned" ? attempts.find((a) => a.outcome === "fail" && a.lesson?.trim())
				: undefined;
			return { ...definition, earned, ...(earned && first ? { earnedAt: first.at } : {}) };
		});
		return { today: { date: today, challenges: todays.length, minutes: minutesToday,
			xp: todays.reduce((sum, a) => sum + a.xp, 0), goalMet }, dailyGoal: profile.dailyGoal,
			streakDays, calendar: Array.from({ length: 84 }, (_, i) => {
				const date = day(offset(now, i - 83));
				return { date, attempts: counts.get(date) ?? 0 };
			}), totalXp, level, levelTitle: levelTitle(level), combo, achievements };
	}
}
