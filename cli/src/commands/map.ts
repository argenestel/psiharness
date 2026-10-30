import { arity } from "../args.ts";
import type { ParsedArgs } from "../args.ts";

/** Display a prerequisite tree in topological order, or emit Mermaid source. */
export async function map(args: ParsedArgs): Promise<number> {
	arity(args, 1, 1, "map <topic> [--mermaid]");
	const { PsiStore } = await import("../../../core/src/store.ts");
	const { isMastered } = await import("../../../core/src/bkt.ts");
	const { topoOrder, frontier, toMermaid } = await import("../../../core/src/graph.ts");
	const store = new PsiStore();
	const graph = store.readGraph(args.positionals[0]);
	if (!graph) throw new Error(`No graph found for topic: ${args.positionals[0]}`);
	const profile = store.readLearner(graph.topic);
	const mastered = new Set(graph.concepts.filter((c) => isMastered(profile?.mastery[c.id])).map((c) => c.id));
	if (args.options.mermaid) {
		console.log(toMermaid(graph, mastered));
		return 0;
	}
	const ready = new Set(frontier(graph, mastered).map((c) => c.id));
	const depths = new Map<string, number>();
	console.log(graph.title);
	for (const id of topoOrder(graph)) {
		const concept = graph.concepts.find((c) => c.id === id)!;
		const depth = concept.prerequisites.length
			? 1 + Math.max(...concept.prerequisites.map((p) => depths.get(p) ?? 0)) : 0;
		depths.set(id, depth);
		const marker = mastered.has(id) ? "✓" : ready.has(id) ? "▶" : "·";
		const prereqs = concept.prerequisites.length > 1 ? ` (requires: ${concept.prerequisites.join(", ")})` : "";
		console.log(`${"  ".repeat(depth)}${depth ? "└─ " : ""}${marker} ${concept.title} [${id}]${prereqs}`);
	}
	return 0;
}
