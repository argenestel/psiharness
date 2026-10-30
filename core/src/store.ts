import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { newId, nowIso } from "./slug.ts";
import { initFsrs, schedule } from "./fsrs.ts";
import { updateMastery } from "./bkt.ts";
import type {
	Card, ConceptGraph, ExplorableSpec, LearnerProfile, LessonPlan, Rating, ReviewLog, Storyboard,
} from "./types.ts";

function assertNoSymlink(root: string, target: string): void {
	const base = path.resolve(root);
	const absoluteTarget = path.resolve(target);
	const relative = path.relative(base, absoluteTarget);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path escapes store root: ${target}`);
	}
	// The store root itself may be a symlink (docker volumes, dotfile setups); only links below it are refused.
	const components = relative === "" ? [] : relative.split(path.sep);
	if (components.length === 0) return;
	let current = path.join(base, components[0]!);
	for (const component of components.slice(1)) {
		try {
			if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink inside store: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		current = path.join(current, component);
	}
	try {
		if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink inside store: ${current}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function hasUnsafeComponentSyntax(value: string): boolean {
	if (typeof value !== "string" || value.length === 0 || value === "." || value === "..") return true;
	if (value.includes("\0") || value.includes("/") || value.includes("\\") || value.includes("..")) return true;
	if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return true;
	let decoded = value;
	for (let attempt = 0; attempt < 8; attempt += 1) {
		let next: string;
		try {
			next = decodeURIComponent(decoded);
		} catch {
			return false;
		}
		if (next === decoded) return false;
		if (next.includes("\0") || next.includes("/") || next.includes("\\") || next.includes("..")) return true;
		decoded = next;
	}
	return true;
}

function readText(file: string, root: string): string | undefined {
	assertNoSymlink(root, file);
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function readJson<T>(file: string, root: string): T | undefined {
	const text = readText(file, root);
	return text === undefined ? undefined : JSON.parse(text) as T;
}

function atomicWrite(file: string, content: string | Uint8Array, root: string): void {
	assertNoSymlink(root, file);
	const directory = path.dirname(file);
	fs.mkdirSync(directory, { recursive: true });
	assertNoSymlink(root, file);
	const temporary = path.join(directory,
		`.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
	try {
		fs.writeFileSync(temporary, content, { flag: "wx" });
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function writeJson(file: string, value: unknown, root: string): void {
	atomicWrite(file, JSON.stringify(value, null, "\t") + "\n", root);
}

function validateId(id: string): void {
	if (hasUnsafeComponentSyntax(id) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
		throw new Error(`Invalid id: ${id}`);
	}
}

function listFiles(directory: string, directories: boolean, root: string): string[] {
	assertNoSymlink(root, directory);
	try {
		return fs.readdirSync(directory, { withFileTypes: true })
			.filter((entry) => directories ? entry.isDirectory() : entry.isFile())
			.map((entry) => entry.name).sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

/** Synchronous, file-backed storage for learning topics and artifacts. */
export class PsiStore {
	readonly root: string;

	/** Resolve the storage home at construction time without creating directories. */
	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.root = path.resolve(home);
	}

	/** Return the absolute directory for a validated topic slug. */
	topicDir(topic: string): string {
		if (hasUnsafeComponentSyntax(topic) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)) {
			throw new Error(`Invalid topic slug: ${topic}`);
		}
		const directory = path.join(this.root, "topics", topic);
		assertNoSymlink(this.root, directory);
		return directory;
	}

	/** List topic directories alphabetically. */
	listTopics(): string[] {
		return listFiles(path.join(this.root, "topics"), true, this.root);
	}

	/** Read a topic graph, if present. */
	readGraph(topic: string): ConceptGraph | undefined {
		return readJson(path.join(this.topicDir(topic), "graph.json"), this.root);
	}

	/** Atomically persist a topic graph. */
	writeGraph(topic: string, graph: ConceptGraph): void {
		writeJson(path.join(this.topicDir(topic), "graph.json"), graph, this.root);
	}

	/** Read a lesson plan, if present. */
	readPlan(topic: string): LessonPlan | undefined {
		return readJson(path.join(this.topicDir(topic), "plan.json"), this.root);
	}

	/** Atomically persist a lesson plan. */
	writePlan(topic: string, plan: LessonPlan): void {
		writeJson(path.join(this.topicDir(topic), "plan.json"), plan, this.root);
	}

	/** Read the learner profile, if present. */
	readLearner(topic: string): LearnerProfile | undefined {
		return readJson(path.join(this.topicDir(topic), "learner.json"), this.root);
	}

	/** Atomically persist a learner profile. */
	writeLearner(topic: string, learner: LearnerProfile): void {
		writeJson(path.join(this.topicDir(topic), "learner.json"), learner, this.root);
	}

	/** Read saved cards, returning an empty array when absent. */
	readCards(topic: string): Card[] {
		return readJson<Card[]>(path.join(this.topicDir(topic), "cards.json"), this.root) ?? [];
	}

	/** Atomically replace a topic's cards. */
	writeCards(topic: string, cards: Card[]): void {
		writeJson(path.join(this.topicDir(topic), "cards.json"), cards, this.root);
	}

	/** Append fresh cards and return only the newly created cards. */
	addCards(
		topic: string,
		drafts: Pick<Card, "conceptId" | "kind" | "prompt" | "answer" | "choices">[],
		now: Date = new Date(),
	): Card[] {
		const existing = this.readCards(topic);
		const cards = drafts.map((draft): Card => ({
			id: newId("card"), topic, conceptId: draft.conceptId, kind: draft.kind,
			prompt: draft.prompt, answer: draft.answer,
			...(draft.choices === undefined ? {} : { choices: draft.choices }),
			createdAt: nowIso(now), fsrs: initFsrs(now),
		}));
		this.writeCards(topic, [...existing, ...cards]);
		return cards;
	}

	/** Return due cards across one or all topics, earliest due first. */
	dueCards(topic?: string, now: Date = new Date()): Card[] {
		const topics = topic === undefined ? this.listTopics() : [topic];
		return topics.flatMap((name) => this.readCards(name))
			.filter((card) => Date.parse(card.fsrs.due) <= now.getTime())
			.sort((a, b) => Date.parse(a.fsrs.due) - Date.parse(b.fsrs.due));
	}

	/** Schedule a review, append its log, and update concept mastery. */
	review(topic: string, cardId: string, rating: Rating, now: Date = new Date()): Card {
		const cards = this.readCards(topic);
		validateId(cardId);
		const card = cards.find((candidate) => candidate.id === cardId);
		if (!card) throw new Error(`Card not found: ${cardId}`);
		const result = schedule(card.fsrs, rating, now);
		card.fsrs = result.state;
		this.writeCards(topic, cards);
		const reviewedAt = nowIso(now);
		const log: ReviewLog = {
			cardId, rating, reviewedAt,
			elapsedDays: result.log.elapsedDays, scheduledDays: result.log.scheduledDays,
		};
		const reviewsFile = path.join(this.topicDir(topic), "reviews.jsonl");
		const existingReviews = readText(reviewsFile, this.root) ?? "";
		atomicWrite(reviewsFile, `${existingReviews}${JSON.stringify(log)}\n`, this.root);
		const learner = this.readLearner(topic) ?? { topic, mastery: {}, notes: [], updatedAt: reviewedAt };
		learner.mastery[card.conceptId] = updateMastery(
			learner.mastery[card.conceptId], card.conceptId, rating >= 3,
		);
		learner.updatedAt = reviewedAt;
		this.writeLearner(topic, learner);
		return card;
	}

	/** Read review history, ignoring blank lines. */
	readReviews(topic: string): ReviewLog[] {
		const text = readText(path.join(this.topicDir(topic), "reviews.jsonl"), this.root) ?? "";
		return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as ReviewLog);
	}

	/** Read topic notes, returning empty text when absent. */
	readNotes(topic: string): string {
		return readText(path.join(this.topicDir(topic), "notes.md"), this.root) ?? "";
	}

	/** Append a note followed by a newline. */
	appendNote(topic: string, text: string): void {
		const directory = this.topicDir(topic);
		const file = path.join(directory, "notes.md");
		const existing = readText(file, this.root) ?? "";
		atomicWrite(file, existing + text + "\n", this.root);
	}

	/** Save a storyboard under its topic and id. */
	saveStoryboard(storyboard: Storyboard): void {
		const directory = this.topicDir(storyboard.topic);
		validateId(storyboard.id);
		writeJson(path.join(directory, "storyboards", `${storyboard.id}.json`), storyboard, this.root);
	}

	/** Read a storyboard, if present. */
	readStoryboard(topic: string, id: string): Storyboard | undefined {
		const directory = this.topicDir(topic);
		validateId(id);
		return readJson(path.join(directory, "storyboards", `${id}.json`), this.root);
	}

	/** Save an explorable under its topic and id. */
	saveExplorable(spec: ExplorableSpec): void {
		const directory = this.topicDir(spec.topic);
		validateId(spec.id);
		writeJson(path.join(directory, "explorables", `${spec.id}.json`), spec, this.root);
	}

	/** Read an explorable, if present. */
	readExplorable(topic: string, id: string): ExplorableSpec | undefined {
		const directory = this.topicDir(topic);
		validateId(id);
		return readJson(path.join(directory, "explorables", `${id}.json`), this.root);
	}

	/** Return the artifacts directory without creating it. */
	artifactsDir(topic: string): string {
		const directory = path.join(this.topicDir(topic), "artifacts");
		assertNoSymlink(this.root, directory);
		return directory;
	}

	/** Write a single artifact with a safe filename and return its absolute path. */
	writeArtifact(topic: string, filename: string, content: string | Uint8Array): string {
		const directory = this.artifactsDir(topic);
		if (hasUnsafeComponentSyntax(filename)) {
			throw new Error(`Invalid artifact filename: ${filename}`);
		}
		const file = path.join(directory, filename);
		atomicWrite(file, content, this.root);
		return file;
	}

	/** List artifact filenames alphabetically. */
	listArtifacts(topic: string): string[] {
		return listFiles(this.artifactsDir(topic), false, this.root);
	}
}
