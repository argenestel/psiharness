import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileLock } from "./lock.ts";
import { newId, nowIso } from "./slug.ts";
import type { LearnerMemory, MemoryItem, MemoryKind, SessionRecap } from "./types.ts";

type Draft = Pick<MemoryItem, "kind" | "text"> &
	Partial<Pick<MemoryItem, "topic" | "skill" | "confidence" | "source">>;
type Query = { kind?: MemoryKind; skill?: string; topic?: string; query?: string; limit?: number };
const kinds: MemoryKind[] = [
	"goal", "background", "preference", "strength", "struggle", "misconception", "insight", "motivation", "constraint",
];
const stopwords = new Set(("a an the and or of to in on for with is are was were be it this that as at by from " +
	"i you they we he she my your their our so do does not no but if then than too very just").split(" "));
const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const tokens = (text: string): Set<string> => new Set(words(text).filter((word) => !stopwords.has(word)));
const newest = (a: string, b: string): number => Date.parse(b) - Date.parse(a);
const count = (n: number): number => Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));

function normalize(draft: Draft): Draft & Pick<MemoryItem, "source" | "confidence"> {
	if (!kinds.includes(draft.kind)) throw new Error(`Invalid memory kind: ${draft.kind}`);
	if (typeof draft.text !== "string" || !draft.text.trim()) throw new Error("Memory text must not be empty");
	const source = draft.source ?? "learner";
	if (!["learner", "observed", "inferred"].includes(source)) throw new Error(`Invalid memory source: ${source}`);
	const fallback = { learner: 0.9, observed: 0.6, inferred: 0.5 }[source];
	const confidence = draft.confidence === undefined || Number.isNaN(draft.confidence) ? fallback : draft.confidence;
	return { ...draft, text: draft.text.trim().slice(0, 400).trimEnd(), source,
		confidence: Math.max(0, Math.min(1, confidence)) };
}

function similar(a: string, b: string): boolean {
	const left = tokens(a), right = tokens(b);
	if (!left.size && !right.size) return words(a).join(" ") === words(b).join(" ");
	const overlap = [...left].filter((word) => right.has(word)).length;
	return overlap / (left.size + right.size - overlap) >= 0.6;
}

/** Durable learner facts and session recaps stored as atomic JSON snapshots. */
export class MemoryStore {
	private readonly file: string;

	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.file = path.join(home, "memory.json");
	}

	/** Read valid records, tolerating missing, malformed, or partially written data. */
	read(): LearnerMemory {
		let data: Partial<LearnerMemory> | null;
		try {
			data = JSON.parse(fs.readFileSync(this.file, "utf8"));
		} catch (error) {
			if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			data = null;
		}
		const items: MemoryItem[] = [];
		for (const item of Array.isArray(data?.items) ? data.items : []) {
			try {
				if (!item || typeof item.id !== "string" || !Number.isFinite(Date.parse(item.updatedAt)) ||
					!Number.isFinite(Date.parse(item.createdAt))) continue;
				const clean = { ...item, ...normalize(item) };
				if (typeof clean.skill !== "string") delete clean.skill;
				if (typeof clean.topic !== "string") delete clean.topic;
				items.push(clean);
			} catch { /* Ignore malformed individual records while preserving usable memory. */ }
		}
		const recaps = (Array.isArray(data?.recaps) ? data.recaps : []).filter((recap) => recap &&
			typeof recap.id === "string" && Number.isFinite(Date.parse(recap.date)) &&
			typeof recap.summary === "string" && typeof recap.next === "string" &&
			Number.isFinite(recap.minutes) && recap.minutes >= 0);
		return { ...(typeof data?.name === "string" && data.name.trim() ? { name: data.name.trim() } : {}),
			items, recaps, updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : nowIso() };
	}

	private write(data: LearnerMemory): void {
		if (data.items.length > 300) {
			data.items.sort((a, b) => b.confidence - a.confidence || newest(a.updatedAt, b.updatedAt));
			data.items = data.items.slice(0, 300);
		}
		data.recaps.sort((a, b) => newest(a.date, b.date));
		data.recaps = data.recaps.slice(0, 100);
		data.updatedAt = nowIso();
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.${newId("tmp")}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify(data, null, "\t") + "\n", { flag: "wx" });
			fs.renameSync(temporary, this.file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
	}

	/** Set a trimmed learner name; an empty name clears it. Returns nothing. */
	setName(name: string): void {
		withFileLock(this.file, () => {
			const data = this.read();
			data.name = name.trim() || undefined;
			this.write(data);
		});
	}

	/** Save a fact, merging similar same-kind facts and increasing confidence. */
	remember(draft: Draft): MemoryItem {
		return withFileLock(this.file, () => {
			const clean = normalize(draft), data = this.read(), now = nowIso();
			let item = data.items.find((candidate) => candidate.kind === clean.kind && similar(candidate.text, clean.text));
			if (item) {
				const confidence = Math.min(1, Math.max(item.confidence, clean.confidence) + 0.1);
				Object.assign(item, clean, { confidence, updatedAt: now });
			} else {
				item = { ...clean, id: newId("mem"), createdAt: now, updatedAt: now };
				data.items.push(item);
			}
			this.write(data);
			return item;
		});
	}

	/** Patch an existing fact using the same validation as remember. */
	update(id: string, patch: Partial<Pick<MemoryItem, "text" | "kind" | "topic" | "skill" | "confidence" | "source">>)
		: MemoryItem {
		return withFileLock(this.file, () => {
			const data = this.read(), item = data.items.find((candidate) => candidate.id === id);
			if (!item) throw new Error(`Memory item not found: ${id}`);
			Object.assign(item, normalize({ ...item, ...patch }), { updatedAt: nowIso() });
			this.write(data);
			return item;
		});
	}

	/** Remove a fact, writing only when the identifier exists. */
	forget(id: string): boolean {
		return withFileLock(this.file, () => {
			const data = this.read(), remaining = data.items.filter((item) => item.id !== id);
			if (remaining.length === data.items.length) return false;
			data.items = remaining;
			this.write(data);
			return true;
		});
	}

	/** Rank facts with +2 for each exact skill/topic match and mark returned facts used. */
	recall(q: Query = {}): MemoryItem[] {
		return withFileLock(this.file, () => {
			const data = this.read(), query = tokens(q.query ?? ""), now = nowIso();
			const score = (item: MemoryItem): number => {
				const text = tokens(`${item.text} ${item.skill ?? ""} ${item.topic ?? ""}`);
				const overlap = [...query].filter((word) => text.has(word)).length;
				const title = [item.skill, item.topic].some((value) => value &&
					(query.has(value.toLowerCase()) || value.toLowerCase() === q.query?.trim().toLowerCase()));
				const age = Math.max(0, (Date.parse(now) - Date.parse(item.updatedAt)) / 86400000);
				return (query.size ? 3 * overlap / query.size : 0) + (title ? 0.5 : 0) + item.confidence +
					(item.skill !== undefined && item.skill === q.skill ? 2 : 0) +
					(item.topic !== undefined && item.topic === q.topic ? 2 : 0) + 2 ** (-age / 30);
			};
			const result = data.items.filter((item) => q.kind === undefined || item.kind === q.kind)
				.map((item) => ({ item, score: score(item) })).sort((a, b) => b.score - a.score ||
					newest(a.item.updatedAt, b.item.updatedAt) || a.item.id.localeCompare(b.item.id))
				.slice(0, count(q.limit ?? 12)).map(({ item }) => Object.assign(item, { lastUsedAt: now }));
			if (result.length) this.write(data);
			return result;
		});
	}

	/** Add a trimmed session recap, retaining the latest hundred by date. */
	addRecap(draft: Omit<SessionRecap, "id" | "date"> & { date?: string }): SessionRecap {
		return withFileLock(this.file, () => {
			const data = this.read();
			const recap = { ...draft, id: newId("rec"), date: draft.date ?? nowIso(),
				minutes: Number.isFinite(draft.minutes) ? Math.max(0, draft.minutes) : 0,
				summary: draft.summary.trim(), next: draft.next.trim() };
			data.recaps.push(recap);
			this.write(data);
			return recap;
		});
	}

	/** Return the most recent recaps first. */
	recentRecaps(n = 3): SessionRecap[] {
		return this.read().recaps.sort((a, b) => newest(a.date, b.date)).slice(0, count(n));
	}

	/** Render a deterministic, bounded Markdown profile without changing usage timestamps. */
	summarize(opts: { skill?: string; topic?: string; maxChars?: number } = {}): string {
		const data = this.read(), max = count(opts.maxChars ?? 1800);
		const matches = (item: { skill?: string; topic?: string }): boolean =>
			(opts.skill !== undefined && item.skill === opts.skill) ||
			(opts.topic !== undefined && item.topic === opts.topic);
		const items = data.items.sort((a, b) => Number(matches(b)) - Number(matches(a)) ||
			b.confidence - a.confidence || newest(a.updatedAt, b.updatedAt) || a.id.localeCompare(b.id));
		const sections: [string, MemoryKind[]][] = [
			["Goals", ["goal"]], ["How they learn best", ["preference", "insight"]],
			["Watch out for", ["struggle", "misconception"]],
			["Background & constraints", ["background", "constraint", "strength", "motivation"]],
		];
		const blocks: string[][] = data.name ? [[`Learner: ${data.name}`]] : [];
		for (const [title, kinds] of sections) {
			const bullets = items.filter((item) => kinds.includes(item.kind)).map((item) => `- ${item.text}`);
			if (bullets.length) blocks.push([`## ${title}\n${bullets[0]}`, ...bullets.slice(1)]);
		}
		const recap = data.recaps.sort((a, b) => newest(a.date, b.date))
			.find((item) => opts.skill === undefined && opts.topic === undefined || matches(item));
		if (recap) blocks.push([`## Last session\n- ${recap.date.slice(0, 10)}, ${recap.minutes} min: ${recap.summary}`,
			`- Next: ${recap.next}`]);
		let result = "";
		for (const block of blocks) {
			for (const [index, line] of block.entries()) {
				const separator = result ? (index === 0 ? "\n\n" : "\n") : "";
				const candidate = result + separator + line;
				if (candidate.length > max) {
					const base = index === 0 ? candidate : result;
					return max ? base.slice(0, max - 1).trimEnd() + "…" : "";
				}
				result = candidate;
			}
		}
		return result;
	}
}
