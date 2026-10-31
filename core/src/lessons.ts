import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PracticeStore } from "./practice.ts";
import { SourceStore } from "./sources.ts";
import { nowIso } from "./slug.ts";
import type { SkillLesson } from "./types.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A lesson draft may omit identity and timestamps; the store fills those fields. */
export type LessonDraft = Omit<SkillLesson, "skill" | "subskillId" | "createdAt" | "updatedAt"> &
	Partial<Pick<SkillLesson, "skill" | "subskillId" | "createdAt" | "updatedAt">>;

type LessonInput = LessonDraft | SkillLesson;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validSlug(value: unknown): value is string {
	return typeof value === "string" && SLUG.test(value);
}

function nonempty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function validDate(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertNoSymlink(root: string, target: string): void {
	const base = path.resolve(root);
	const absoluteTarget = path.resolve(target);
	const relative = path.relative(base, absoluteTarget);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path escapes store root: ${target}`);
	}
	let current = base;
	for (const component of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		try {
			if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink inside store: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

function readText(root: string, file: string): string | undefined {
	assertNoSymlink(root, file);
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function parseJson<T>(text: string, file: string): T {
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		throw new Error(`Invalid JSON in ${file}`, { cause: error });
	}
}

function atomicWrite(root: string, file: string, content: string): void {
	assertNoSymlink(root, file);
	const directory = path.dirname(file);
	fs.mkdirSync(directory, { recursive: true });
	assertNoSymlink(root, file);
	const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporary, content, { flag: "wx" });
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function validateCitation(value: unknown, index: number): string[] {
	const errors: string[] = [];
	if (!isRecord(value)) return [`citation[${index}] must be an object`];
	if (!nonempty(value.sourceId)) errors.push(`citation[${index}].sourceId must be a nonempty string`);
	if (value.quote !== undefined && typeof value.quote !== "string") {
		errors.push(`citation[${index}].quote must be a string`);
	} else if (typeof value.quote === "string" && value.quote.length > 200) {
		errors.push(`citation[${index}].quote must be at most 200 characters`);
	}
	if (value.locator !== undefined && typeof value.locator !== "string") {
		errors.push(`citation[${index}].locator must be a string`);
	}
	return errors;
}

/** Validate the shape of a lesson draft without consulting the backing stores. */
export function validateLesson(lesson: LessonInput): string[] {
	const errors: string[] = [];
	if (!isRecord(lesson)) return ["lesson must be an object"];
	if (lesson.skill !== undefined && !validSlug(lesson.skill)) {
		errors.push("skill must be a valid kebab-case slug");
	}
	if (lesson.subskillId !== undefined && !validSlug(lesson.subskillId)) {
		errors.push("subskillId must be a valid kebab-case slug");
	}
	if (!nonempty(lesson.title)) errors.push("title must be a nonempty string");
	if (!nonempty(lesson.explanation)) errors.push("explanation must be a nonempty trimmed string");
	if (!Array.isArray(lesson.keyIdeas) || lesson.keyIdeas.length < 2 || lesson.keyIdeas.length > 4 ||
		!lesson.keyIdeas.every((idea) => nonempty(idea))) {
		errors.push("keyIdeas must contain 2–4 nonempty strings");
	}
	if (!Array.isArray(lesson.citations) || lesson.citations.length < 1) {
		errors.push("citations must contain at least one citation");
	} else {
		lesson.citations.forEach((citation, index) => errors.push(...validateCitation(citation, index)));
	}
	if (lesson.workedExample !== undefined) {
		if (!isRecord(lesson.workedExample)) {
			errors.push("workedExample must be an object");
		} else {
			if (!nonempty(lesson.workedExample.problem)) errors.push("workedExample.problem must be a nonempty string");
			if (!Array.isArray(lesson.workedExample.steps) || lesson.workedExample.steps.length < 1 ||
				!lesson.workedExample.steps.every((step) => nonempty(step))) {
				errors.push("workedExample.steps must contain nonempty strings");
			}
			if (!nonempty(lesson.workedExample.answer)) errors.push("workedExample.answer must be a nonempty string");
		}
	}
	if (lesson.pitfalls !== undefined && (!Array.isArray(lesson.pitfalls) ||
		!lesson.pitfalls.every((pitfall) => nonempty(pitfall)))) {
		errors.push("pitfalls must be an array of nonempty strings");
	}
	if (lesson.createdAt !== undefined && !validDate(lesson.createdAt)) {
		errors.push("createdAt must be a valid date");
	}
	if (lesson.updatedAt !== undefined && !validDate(lesson.updatedAt)) {
		errors.push("updatedAt must be a valid date");
	}
	return errors;
}

/** Synchronous file-backed storage for source-grounded skill lessons. */
export class LessonStore {
	readonly root: string;
	private readonly practice: PracticeStore;
	private readonly sources: SourceStore;

	/** Resolve the storage home without creating it. */
	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.root = path.resolve(home);
		this.practice = new PracticeStore(this.root);
		this.sources = new SourceStore(this.root);
	}

	private directory(skill: string): string {
		if (!validSlug(skill)) throw new Error(`Invalid skill slug: ${skill}`);
		const directory = path.join(this.root, "skills", skill, "lessons");
		assertNoSymlink(this.root, directory);
		return directory;
	}

	private file(skill: string, subskillId: string): string {
		if (!validSlug(skill)) throw new Error(`Invalid skill slug: ${skill}`);
		if (!validSlug(subskillId)) throw new Error(`Invalid subskill slug: ${subskillId}`);
		const file = path.join(this.directory(skill), `${subskillId}.json`);
		assertNoSymlink(this.root, file);
		return file;
	}

	/** Read one lesson, returning undefined only when its file is absent. */
	read(skill: string, subskillId: string): SkillLesson | undefined {
		const file = this.file(skill, subskillId);
		const text = readText(this.root, file);
		return text === undefined ? undefined : parseJson<SkillLesson>(text, file);
	}

	/** Validate a lesson draft against both its skill plan and its stored sources. */
	validate(skill: string, subskillId: string, lesson: LessonInput): string[] {
		const errors = validateLesson(lesson);
		if (!validSlug(skill)) errors.push("Invalid skill slug");
		if (!validSlug(subskillId)) errors.push("Invalid subskill slug");
		if (isRecord(lesson)) {
			if (lesson.skill !== undefined && lesson.skill !== skill) errors.push("lesson skill does not match skill argument");
			if (lesson.subskillId !== undefined && lesson.subskillId !== subskillId) {
				errors.push("lesson subskillId does not match subskillId argument");
			}
		}
		if (!validSlug(skill) || !validSlug(subskillId)) return errors;

		const plan = this.practice.readPlan(skill);
		if (!plan) {
			errors.push(`Skill plan not found: ${skill}`);
		} else if (!plan.subskills.some((candidate) => candidate.id === subskillId)) {
			errors.push(`Unknown subskill: ${subskillId}`);
		}
		const sourceIds = new Set(this.sources.list(skill).map((source) => source.id));
		if (isRecord(lesson) && Array.isArray(lesson.citations)) {
			lesson.citations.forEach((citation, index) => {
				if (isRecord(citation) && typeof citation.sourceId === "string" && !sourceIds.has(citation.sourceId)) {
					errors.push(`citation[${index}] sourceId does not exist: ${citation.sourceId}`);
				}
			});
		}
		return errors;
	}

	/** Persist a lesson atomically, filling identity/timestamps and preserving createdAt on updates. */
	write(skill: string, subskillId: string, lesson: LessonInput): SkillLesson {
		const errors = this.validate(skill, subskillId, lesson);
		if (errors.length) throw new Error(errors.join("; "));
		const previous = this.read(skill, subskillId);
		const createdAt = previous?.createdAt ?? lesson.createdAt ?? nowIso();
		const previousUpdated = previous === undefined ? 0 : Date.parse(previous.updatedAt);
		const updatedAt = nowIso(new Date(Math.max(Date.now(),
			Number.isFinite(previousUpdated) ? previousUpdated + 1 : 0)));
		const keyIdeas = lesson.keyIdeas.map((idea) => idea.trim());
		const stored: SkillLesson = {
			...lesson,
			skill,
			subskillId,
			title: lesson.title.trim(),
			explanation: lesson.explanation.trim(),
			keyIdeas,
			createdAt,
			updatedAt,
		} as SkillLesson;
		atomicWrite(this.root, this.file(skill, subskillId), JSON.stringify(stored, null, "\t") + "\n");
		return stored;
	}

	/** List persisted lessons for a skill in deterministic subskill order. */
	list(skill: string): SkillLesson[] {
		const directory = this.directory(skill);
		assertNoSymlink(this.root, directory);
		try {
			return fs.readdirSync(directory, { withFileTypes: true })
				.filter((entry) => entry.isFile() && entry.name.endsWith(".json") &&
					validSlug(entry.name.slice(0, -5)))
				.map((entry) => this.read(skill, entry.name.slice(0, -5))!)
				.sort((a, b) => a.subskillId.localeCompare(b.subskillId));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}
}
