import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { arity } from "../args.ts";
import type { ParsedArgs } from "../args.ts";
import type { ConceptGraph } from "../../../core/src/types.ts";

function rejectLinks(path: string): void {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) throw new Error(`Topic packs cannot contain symbolic links: ${path}`);
	if (stat.isDirectory()) for (const name of readdirSync(path)) rejectLinks(join(path, name));
	else if (!stat.isFile()) throw new Error(`Unsupported pack entry: ${path}`);
}

/** Import a complete topic pack, refusing to overwrite an existing topic. */
export async function importPack(args: ParsedArgs): Promise<number> {
	arity(args, 1, 1, "import <dir>");
	const source = resolve(args.positionals[0]);
	rejectLinks(source);
	const graph = JSON.parse(readFileSync(join(source, "graph.json"), "utf8")) as ConceptGraph;
	if (typeof graph.topic !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(graph.topic)) {
		throw new Error("Pack graph.json must contain a kebab-case topic slug");
	}
	const { PsiStore } = await import("../../../core/src/store.ts");
	const { validateGraph } = await import("../../../core/src/graph.ts");
	const errors = validateGraph(graph);
	if (errors.length) throw new Error(`Invalid graph: ${errors.join("; ")}`);
	const store = new PsiStore();
	const target = store.topicDir(graph.topic);
	if (existsSync(target)) throw new Error(`Topic ${graph.topic} already exists; import will not overwrite learner data`);
	// Stage beside the target so an interrupted copy never leaves a partial topic.
	const { mkdirSync } = await import("node:fs");
	mkdirSync(dirname(target), { recursive: true });
	const staging = mkdtempSync(join(dirname(target), ".psi-import-"));
	try {
		cpSync(source, join(staging, basename(target)), { recursive: true, errorOnExist: true, force: false });
		renameSync(join(staging, basename(target)), target);
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
	console.log(`Imported ${graph.topic} → ${target}`);
	return 0;
}
