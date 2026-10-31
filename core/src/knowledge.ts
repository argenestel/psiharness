import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { isMastered } from "./bkt.ts";
import { frontier } from "./graph.ts";
import { MemoryStore } from "./memory.ts";
import { PracticeStore } from "./practice.ts";
import { PsiStore } from "./store.ts";
import { newId, nowIso, slugify } from "./slug.ts";
import type { Attempt, KnowledgeEdge, KnowledgeGraph, KnowledgeNode, LearningPath } from "./types.ts";

type Link = { from: string; to: string };
type PathOptions = { includeDone?: boolean };
type PathDraft = Pick<LearningPath, "title" | "goal"> &
	Partial<Pick<LearningPath, "id" | "steps" | "targetId" | "source">>;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const edgeOrder = (a: KnowledgeEdge | Link, b: KnowledgeEdge | Link): number =>
	compare(a.from, b.from) || compare(a.to, b.to) ||
	compare("kind" in a ? a.kind : "", "kind" in b ? b.kind : "");
const clamp = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const stopwords = new Set("a an the and or of to in on for with is are was be this that as at by from it".split(" "));
const safe = <T>(read: () => T, fallback: T): T => { try { return read(); } catch { return fallback; } };
const strings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

function ordered(graph: KnowledgeGraph): KnowledgeGraph {
	return { ...graph, nodes: [...graph.nodes].sort((a, b) => compare(a.id, b.id)),
		edges: [...graph.edges].sort(edgeOrder) };
}

/** Return prerequisite ancestors and contained children in teaching order, with the target last. */
export function knowledgePathTo(graph: KnowledgeGraph, targetId: string, opts: PathOptions = {}): string[] {
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	if (!nodes.has(targetId)) throw new Error(`Unknown target: ${targetId}`);
	const parents = new Map<string, Set<string>>();
	for (const edge of graph.edges) {
		// A contained child must be learned before completing its container.
		if (edge.kind !== "contains" && edge.kind !== "prerequisite") continue;
		const [before, after] = edge.kind === "contains" ? [edge.to, edge.from] : [edge.from, edge.to];
		if (!nodes.has(before) || !nodes.has(after)) continue;
		if (!parents.has(after)) parents.set(after, new Set());
		parents.get(after)!.add(before);
	}
	const required = new Set<string>();
	const pending = [targetId];
	while (pending.length) {
		const id = pending.pop()!;
		if (required.has(id)) continue;
		required.add(id);
		pending.push(...parents.get(id) ?? []);
	}
	const order = (a: string, b: string) => compare(nodes.get(a)!.title, nodes.get(b)!.title) || compare(a, b);
	const degrees = new Map([...required].map((id) => [id, parents.get(id)?.size ?? 0]));
	const children = new Map<string, string[]>();
	for (const id of required) for (const parent of parents.get(id) ?? []) {
		if (!children.has(parent)) children.set(parent, []);
		children.get(parent)!.push(id);
	}
	const ready = [...required].filter((id) => degrees.get(id) === 0);
	const result: string[] = [];
	while (ready.length) {
		ready.sort(order);
		const id = ready.shift()!;
		result.push(id);
		for (const child of children.get(id) ?? []) {
			degrees.set(child, degrees.get(child)! - 1);
			if (degrees.get(child) === 0) ready.push(child);
		}
	}
	const emitted = new Set(result);
	result.push(...[...required].filter((id) => !emitted.has(id)).sort(order));
	return [...result.filter((id) => id !== targetId), targetId].filter((id) =>
		opts.includeDone || !["solid", "mastered"].includes(nodes.get(id)!.status ?? ""));
}

/** Return the undirected neighborhood within a bounded number of hops. */
export function neighborhood(graph: KnowledgeGraph, id: string, depth = 1): KnowledgeGraph {
	if (!graph.nodes.some((node) => node.id === id)) throw new Error(`Unknown node: ${id}`);
	const adjacent = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
	for (const edge of graph.edges) {
		if (!adjacent.has(edge.from) || !adjacent.has(edge.to)) continue;
		adjacent.get(edge.from)!.add(edge.to);
		adjacent.get(edge.to)!.add(edge.from);
	}
	const found = new Set([id]);
	let layer = [id];
	const hops = Number.isNaN(depth) ? 0 : Math.max(0, Math.floor(depth));
	for (let hop = 0; hop < hops && layer.length; hop++) {
		const next: string[] = [];
		for (const current of layer) for (const neighbor of adjacent.get(current)!) {
			if (!found.has(neighbor)) { found.add(neighbor); next.push(neighbor); }
		}
		layer = next;
	}
	return ordered({ builtAt: graph.builtAt, nodes: graph.nodes.filter((node) => found.has(node.id)),
		edges: graph.edges.filter((edge) => found.has(edge.from) && found.has(edge.to)) });
}

/** Derive a second brain from existing stores and persist learner links and paths. */
export class KnowledgeStore {
	private readonly home: string;
	private readonly practice: PracticeStore;
	private readonly topics: PsiStore;
	private readonly memory: MemoryStore;

	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.home = path.resolve(home);
		this.practice = new PracticeStore(this.home);
		this.topics = new PsiStore(this.home);
		this.memory = new MemoryStore(this.home);
	}

	/** Build deterministically, isolating missing or malformed source records. */
	build(): KnowledgeGraph {
		const nodes = new Map<string, KnowledgeNode>();
		const owners = new Map<string, string>();
		const edges: KnowledgeEdge[] = [];
		const add = (node: KnowledgeNode, owner: string) => { nodes.set(node.id, node); owners.set(node.id, owner); };
		for (const skill of safe(() => this.practice.listSkills(), [])) {
			const plan = safe(() => this.practice.readPlan(skill), undefined);
			if (!plan || typeof plan.title !== "string" || !Array.isArray(plan.subskills)) continue;
			const subskills = plan.subskills.filter((s) => s && typeof s.id === "string" &&
				typeof s.title === "string" && strings(s.prerequisites));
			const next = safe(() => this.practice.nextSubskill({ ...plan, subskills }), undefined);
			const progress = safe(() => this.practice.progress(skill), undefined);
			const hours = safe(() => this.practice.hours(skill), undefined);
			// No attempts means new; any practice means practising; every subskill solid means solid.
			const status = subskills.length && subskills.every((s) => s.status === "solid") ? "solid" :
				(progress?.attempts ?? 0) > 0 ? "practising" : "new";
			const owner = `skill:${slugify(skill)}`;
			add({ id: owner, kind: "skill", title: plan.title, summary: plan.targetPerformance,
				status, progress: clamp((hours?.logged ?? 0) / (hours?.goal ?? 20)),
				href: `#/skills/${encodeURIComponent(skill)}` }, owner);
			// PracticeStore has no public history reader. Read its documented JSONL, skipping bad lines individually.
			const attempts = safe(() => fs.readFileSync(path.join(this.home, "skills", skill, "attempts.jsonl"),
				"utf8"), "").split("\n").flatMap((line) => {
				const value: unknown = safe(() => JSON.parse(line), undefined);
				return record(value) && typeof value.challengeId === "string" ? [value as unknown as Attempt] : [];
			});
			const solved = new Set(attempts.filter((a) => a.outcome === "success").map((a) => a.challengeId));
			const challenges = safe(() => this.practice.listChallenges(skill), []);
			for (const s of subskills) {
				const id = `subskill:${skill}/${s.id}`;
				const own = Array.isArray(challenges) ? challenges.filter((c) => c && c.subskillId === s.id) : [];
				// Solved means at least one success, even if a later retry fails; partial is not passing.
				add({ id, kind: "subskill", title: s.title, summary: s.why,
					status: s.status === "practicing" ? "practising" : s.status === "active" ?
						(next?.id === s.id ? "next" : "new") : s.status === "solid" ? "solid" : "locked",
					progress: own.length ? own.filter((c) => solved.has(c.id)).length / own.length : 0 }, owner);
				edges.push({ from: owner, to: id, kind: "contains" });
				for (const prereq of s.prerequisites) {
					edges.push({ from: `subskill:${skill}/${prereq}`, to: id, kind: "prerequisite" });
				}
			}
		}
		for (const topic of safe(() => this.topics.listTopics(), [])) {
			const graph = safe(() => this.topics.readGraph(topic), undefined);
			if (!graph || typeof graph.title !== "string" || !Array.isArray(graph.concepts)) continue;
			const concepts = graph.concepts.filter((c) => c && typeof c.id === "string" &&
				typeof c.title === "string" && strings(c.prerequisites));
			const learner = safe(() => this.topics.readLearner(topic), undefined);
			const mastery = record(learner?.mastery) ? learner.mastery : {};
			const mastered = new Set(concepts.filter((c) => safe(() => isMastered(mastery[c.id]), false)).map((c) => c.id));
			const next = new Set(safe(() => frontier({ ...graph, concepts }, mastered), []).map((c) => c.id));
			const slug = slugify(topic);
			const owner = `topic:${slug}`;
			add({ id: owner, kind: "topic", title: graph.title, summary: graph.bigIdea,
				href: `#/${encodeURIComponent(topic)}/map` }, owner);
			for (const c of concepts) {
				const id = `concept:${slug}/${c.id}`;
				// Concept progress is the BKT probability, clamped to the node contract's 0..1 range.
				add({ id, kind: "concept", title: c.title, summary: c.summary,
					tags: strings(c.tags) ? c.tags : undefined, progress: clamp(mastery[c.id]?.pKnown ?? 0),
					status: mastered.has(c.id) ? "mastered" : next.has(c.id) ? "next" : "new" }, owner);
				edges.push({ from: owner, to: id, kind: "contains" });
				for (const prereq of c.prerequisites) {
					edges.push({ from: `concept:${slug}/${prereq}`, to: id, kind: "prerequisite" });
				}
			}
		}
		const candidates = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
		for (const item of safe(() => this.memory.read().items, [])) {
			if (!item || typeof item.id !== "string" || typeof item.text !== "string") continue;
			const id = `note:${item.id}`;
			nodes.set(id, { id, kind: "note", title: item.text.replace(/\s+/g, " ").trim().slice(0, 60),
				summary: item.text });
			if (item.skill || item.topic) {
				if (typeof item.skill === "string") edges.push({ from: id, to: `skill:${slugify(item.skill)}`, kind: "about" });
				if (typeof item.topic === "string") edges.push({ from: id, to: `topic:${slugify(item.topic)}`, kind: "about" });
			} else {
				const text = item.text.toLowerCase();
				for (const node of candidates.filter((n) => n.title.length >= 4 &&
					text.includes(n.title.toLowerCase())).slice(0, 3)) {
					edges.push({ from: id, to: node.id, kind: "about" });
				}
			}
		}
		const tokens = candidates.map((node) => new Set([node.title, node.summary, ...(node.tags ?? [])]
			.filter((text): text is string => typeof text === "string").join(" ").toLowerCase()
			.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !stopwords.has(word))));
		const related: KnowledgeEdge[] = [];
		for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
			if (owners.get(candidates[i].id) === owners.get(candidates[j].id)) continue;
			const overlap = [...tokens[i]].filter((word) => tokens[j].has(word)).length;
			const weight = overlap / (tokens[i].size + tokens[j].size - overlap);
			if (weight >= 0.25) related.push({ from: candidates[i].id, to: candidates[j].id, kind: "related", weight });
		}
		// Greedy strongest-first selection enforces a hard degree cap of three at both endpoints.
		const degrees = new Map<string, number>();
		for (const edge of related.sort((a, b) => b.weight! - a.weight! || edgeOrder(a, b))) {
			if ((degrees.get(edge.from) ?? 0) >= 3 || (degrees.get(edge.to) ?? 0) >= 3) continue;
			edges.push(edge);
			for (const id of [edge.from, edge.to]) degrees.set(id, (degrees.get(id) ?? 0) + 1);
		}
		edges.push(...this.listLinks().map((link) => ({ ...link, kind: "link" as const })));
		const unique = new Map(edges.filter((e) => nodes.has(e.from) && nodes.has(e.to))
			.map((edge) => [JSON.stringify([edge.from, edge.to, edge.kind]), edge]));
		return ordered({ nodes: [...nodes.values()], edges: [...unique.values()], builtAt: nowIso() });
	}

	private file(name: string): string {
		const target = path.join(this.home, "graph", name);
		let current = this.home;
		for (const component of path.relative(this.home, target).split(path.sep)) {
			current = path.join(current, component);
			try {
				if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
				throw error;
			}
		}
		return target;
	}

	private write(name: string, value: unknown): void {
		const file = this.file(name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify(value, null, "\t") + "\n", { flag: "wx" });
			fs.renameSync(temporary, file);
		} finally { fs.rmSync(temporary, { force: true }); }
	}

	/** Read canonical, undirected links, skipping malformed entries. */
	listLinks(): Link[] {
		const data: unknown = safe(() => JSON.parse(fs.readFileSync(this.file("links.json"), "utf8")), []);
		const links = new Map<string, Link>();
		for (const link of Array.isArray(data) ? data : []) {
			if (!record(link) || typeof link.from !== "string" || typeof link.to !== "string" || link.from === link.to) continue;
			const [from, to] = [link.from, link.to].sort(compare);
			links.set(JSON.stringify([from, to]), { from, to });
		}
		return [...links.values()].sort(edgeOrder);
	}

	/** Validate and persist one undirected learner link. */
	addLink(from: string, to: string): Link {
		const ids = new Set(this.build().nodes.map((node) => node.id));
		if (from === to) throw new Error("Cannot link a node to itself");
		for (const id of [from, to]) if (!ids.has(id)) throw new Error(`Unknown node: ${id}`);
		const [first, second] = [from, to].sort(compare);
		const links = this.listLinks();
		const existing = links.find((link) => link.from === first && link.to === second);
		if (existing) return existing;
		const link = { from: first, to: second };
		this.write("links.json", [...links, link].sort(edgeOrder));
		return link;
	}

	/** Remove a learner link in either direction. */
	removeLink(from: string, to: string): boolean {
		const links = this.listLinks();
		const remaining = links.filter((link) => !(link.from === from && link.to === to ||
			link.from === to && link.to === from));
		if (remaining.length === links.length) return false;
		this.write("links.json", remaining);
		return true;
	}

	private pathFile(id: string): string {
		if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id.includes("..")) {
			throw new Error(`Invalid path id: ${id}`);
		}
		return this.file(path.join("paths", `${id}.json`));
	}

	/** Read a path, returning undefined for absent or corrupt files. */
	readPath(id: string): LearningPath | undefined {
		// Reject unsafe identifiers even when the file does not exist.
		this.pathFile(id);
		return safe(() => {
			const value: unknown = JSON.parse(fs.readFileSync(this.pathFile(id), "utf8"));
			if (!record(value) || value.id !== id || typeof value.title !== "string" ||
				typeof value.goal !== "string" || !strings(value.steps) ||
				!["learner", "tutor", "generated"].includes(value.source as string) ||
				typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
				typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) ||
				(value.targetId !== undefined && typeof value.targetId !== "string")) return undefined;
			return value as unknown as LearningPath;
		}, undefined);
	}

	/** List valid paths by most recent update, breaking ties by identifier. */
	listPaths(): LearningPath[] {
		return safe(() => fs.readdirSync(this.file("paths")), []).filter((name) => name.endsWith(".json"))
			.flatMap((name) => {
				const value = safe(() => this.readPath(name.slice(0, -5)), undefined);
				return value ? [value] : [];
			}).sort((a, b) => compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id));
	}

	/** Save an explicit or generated path with validated graph references. */
	savePath(draft: PathDraft): LearningPath {
		const id = draft.id ?? newId("path");
		this.pathFile(id);
		const graph = this.build();
		const steps = draft.steps ?? (draft.targetId ? knowledgePathTo(graph, draft.targetId) : []);
		if (!strings(steps)) throw new Error("Path steps must be strings");
		const ids = new Set(graph.nodes.map((node) => node.id));
		for (const step of [...steps, ...(draft.targetId ? [draft.targetId] : [])]) {
			if (!ids.has(step)) throw new Error(`Unknown path step: ${step}`);
		}
		const now = nowIso();
		const value: LearningPath = { id, title: draft.title, goal: draft.goal, steps: [...steps],
			...(draft.targetId !== undefined ? { targetId: draft.targetId } : {}),
			source: draft.source ?? (draft.steps === undefined && draft.targetId ? "generated" : "learner"),
			createdAt: this.readPath(id)?.createdAt ?? now, updatedAt: now };
		this.write(path.join("paths", `${id}.json`), value);
		return value;
	}

	/** Delete a path; return false if it was absent. */
	deletePath(id: string): boolean {
		const file = this.pathFile(id);
		try { fs.unlinkSync(file); return true; } catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}

	/** Generate a path against the current graph. */
	pathTo(targetId: string, opts?: PathOptions): string[] { return knowledgePathTo(this.build(), targetId, opts); }

	/** Inspect a neighborhood in the current graph. */
	neighborhood(id: string, depth = 1): KnowledgeGraph { return neighborhood(this.build(), id, depth); }
}
