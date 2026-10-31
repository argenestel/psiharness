import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KnowledgeGraph, KnowledgeNode, LearningPath } from "../../../core/src/types.ts";
import { newId } from "../../../core/src/slug.ts";

// Keep the extension loadable while the independently developed knowledge module is absent.
interface PathStore {
	build(): KnowledgeGraph;
	listPaths(): LearningPath[];
	readPath(id: string): LearningPath | undefined;
	savePath(draft: { title: string; goal: string; steps?: string[]; targetId?: string;
		source: LearningPath["source"] }): LearningPath;
}

const entryType = "psi-active-path";
const done = (node?: KnowledgeNode) => node?.status === "solid" || node?.status === "mastered";
const line = (text: string) => text.replace(/[\r\n]+/g, " ");
const result = (details: unknown, text: string) => ({ content: [{ type: "text" as const, text }], details });

/** Persist the active path separately from the stable core state contract. */
export class ActivePathStore {
	private readonly file: string;
	private readonly directory: string;

	constructor(home = process.env.PSI_HOME ?? join(homedir(), ".psi")) {
		this.directory = join(home, "graph");
		this.file = join(this.directory, "active-path.json");
	}

	/** Read the cross-process fallback, ignoring absent or invalid state. */
	read(): string | undefined {
		try {
			const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
			return typeof value?.activePath === "string" ? value.activePath : undefined;
		} catch (error) {
			if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	/** Replace the state atomically using a unique temporary file in the same directory. */
	write(activePath: string): void {
		fs.mkdirSync(this.directory, { recursive: true });
		const temporary = `${this.file}.${process.pid}.${newId("tmp")}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify({ activePath }) + "\n", { flag: "wx" });
			fs.renameSync(temporary, this.file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
	}
}

function stepsFor(path: LearningPath, graph: KnowledgeGraph) {
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	let foundNext = false;
	return path.steps.map((id, index) => {
		const node = nodes.get(id);
		const status = done(node) ? "done" : foundNext ? "pending" : "next";
		if (status === "next") foundNext = true;
		return { id, title: node?.title ?? id, status, index: index + 1, node };
	});
}

function instruction(node?: KnowledgeNode): string {
	if (!node) return "This step is missing from the graph; repair the path before continuing.";
	const [skill, subskillId] = node.id.slice(node.id.indexOf(":") + 1).split("/");
	if (node.kind === "subskill") {
		return `Serve it via psi_challenge with action "next", skill ${JSON.stringify(skill)}, `
			+ `subskillId ${JSON.stringify(subskillId)}.`;
	}
	if (node.kind === "skill") return `Start /practice for skill ${skill}.`;
	return `Teach ${node.title}.`;
}

/** Register learning paths and return context for the existing prompt injection hook. */
export function registerPaths(pi: ExtensionAPI, home?: string): { injection(): Promise<string> } {
	const saved = new ActivePathStore(home);
	let activePath = saved.read();
	const load = async (): Promise<PathStore> => {
		const location = new URL("../../../core/src/knowledge.ts", import.meta.url).href;
		const module = await import(location);
		return new module.KnowledgeStore(home);
	};
	const activate = (id: string) => {
		saved.write(id);
		pi.appendEntry(entryType, { activePath: id });
		activePath = id;
	};
	const restore = (_event: unknown, ctx: ExtensionContext) => {
		activePath = undefined;
		let found = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== entryType) continue;
			found = true;
			const value = entry.data as { activePath?: unknown } | undefined;
			activePath = typeof value?.activePath === "string" ? value.activePath : undefined;
		}
		if (!found) activePath = saved.read();
	};
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	const summary = (path: LearningPath, graph: KnowledgeGraph) => {
		const steps = stepsFor(path, graph);
		return { ...path, done: steps.filter((step) => step.status === "done").length, total: steps.length };
	};
	const list = (store: PathStore) => {
		const graph = store.build();
		const paths = store.listPaths().map((path) => summary(path, graph));
		return result({ paths }, paths.map((path) =>
			`${path.id}: ${path.title} — ${path.done}/${path.total} done. Goal: ${path.goal}`
		).join("\n") || "No learning paths yet. Use /path new <goal>.");
	};
	const next = (store: PathStore, id?: string) => {
		const path = id ? store.readPath(id) : undefined;
		if (!path) return result({ errors: ["Path not found."] }, "No such learning path. Use /path list.");
		const step = stepsFor(path, store.build()).find((step) => step.status === "next");
		const guidance = step ? instruction(step.node) : "All steps are done!";
		return result({ path, next: step, instruction: guidance }, step
			? `${path.title} — step ${step.index} of ${path.steps.length}: ${step.title}. ${guidance}`
			: `${path.title}: ${guidance}`);
	};
	pi.registerTool(defineTool({
		name: "psi_path", label: "Learning paths",
		description: "List, get, create, or continue a learning path. When the learner gives a goal but no target, "
			+ 'first look at the graph by calling action "list" and psi_skill_plan with action "get", '
			+ "then call create with a targetId or steps. Creating a path makes it active.",
		parameters: Type.Object({
			action: Type.Union(["list", "get", "create", "next"].map((value) => Type.Literal(value))),
			id: Type.Optional(Type.String()), title: Type.Optional(Type.String()), goal: Type.Optional(Type.String()),
			targetId: Type.Optional(Type.String()), steps: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params) {
			try {
				const store = await load();
				if (params.action === "list") return list(store);
				if (params.action === "next") return next(store, params.id ?? activePath);
				if (params.action === "create") {
					if (!params.title?.trim() || !params.goal?.trim() || (!params.steps && !params.targetId)) {
						throw new Error("Provide title, goal, and steps or targetId.");
					}
					const path = store.savePath({ title: params.title.trim(), goal: params.goal.trim(), steps: params.steps,
						targetId: params.targetId, source: "tutor" });
					activate(path.id);
					const details = summary(path, store.build());
					return result({ path: details }, `${path.title} — ${details.done}/${details.total} done. Goal: ${path.goal}`);
				}
				const path = params.id ? store.readPath(params.id) : undefined;
				if (!path) throw new Error("Path not found. Use /path list.");
				const steps = stepsFor(path, store.build());
				return result({ path, steps }, `${path.title}\n` + steps.map((step) =>
					`${step.index}. ${step.title} [${step.status}]`).join("\n"));
			} catch (error) {
				return result({ errors: [String(error)] }, `Could not use learning paths: ${String(error)}`);
			}
		},
	}));
	pi.registerCommand("path", {
		description: "Learning paths: /path [list | <id> | new <goal>]",
		async handler(args, ctx) {
			const text = args.trim();
			if (/^new(?:\s|$)/.test(text)) {
				const goal = text.slice(3).trim();
				if (!goal) { ctx.ui.notify("Usage: /path new <goal>", "info"); return; }
				pi.sendUserMessage(`Build a learning path for: ${goal}. `
					+ "Look at my knowledge graph first, then call psi_path create.");
				return;
			}
			try {
				const store = await load();
				if (!text || text === "list") { ctx.ui.notify(list(store).content[0].text, "info"); return; }
				if (!store.readPath(text)) { ctx.ui.notify("Path not found. Try /path list.", "warning"); return; }
				activate(text);
				ctx.ui.notify(next(store, text).content[0].text, "info");
			} catch (error) {
				ctx.ui.notify(`Could not use learning paths: ${String(error)}`, "warning");
			}
		},
	});
	return {
		async injection() {
			if (!activePath) return "";
			try {
				const store = await load();
				const path = store.readPath(activePath);
				if (!path) return "";
				const step = stepsFor(path, store.build()).find((step) => step.status === "next");
				return step ? `Active path: ${line(path.title)} — step ${step.index} of ${path.steps.length}: `
					+ `${line(step.title)}. Continue it unless the learner asks otherwise.` : "";
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") return "";
				throw error;
			}
		},
	};
}
