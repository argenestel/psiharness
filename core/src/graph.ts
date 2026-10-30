import type { Concept, ConceptGraph } from "./types.ts";

const compareIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Report invalid identifiers, prerequisites, and named cycle paths. */
export function validateGraph(g: ConceptGraph): string[] {
	const errors: string[] = [];
	const concepts = new Map<string, Concept>();
	for (const c of g.concepts) {
		if (concepts.has(c.id)) errors.push(`duplicate concept id: ${c.id}`);
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) errors.push(`non-kebab-case concept id: ${c.id}`);
		concepts.set(c.id, c);
	}
	for (const c of g.concepts) {
		for (const p of c.prerequisites) {
			if (!concepts.has(p)) errors.push(`unknown prerequisite ${p} for ${c.id}`);
			if (p === c.id) errors.push(`self-loop: ${c.id}`);
		}
	}
	const visited = new Set<string>();
	const active = new Map<string, number>();
	const path: string[] = [];
	const visit = (id: string): void => {
		if (active.has(id)) {
			errors.push(`cycle detected: ${[...path.slice(active.get(id)!), id].join(" -> ")}`);
			return;
		}
		if (visited.has(id)) return;
		active.set(id, path.length);
		path.push(id);
		for (const p of [...new Set(concepts.get(id)!.prerequisites)].sort(compareIds)) {
			if (concepts.has(p)) visit(p);
		}
		path.pop();
		active.delete(id);
		visited.add(id);
	};
	for (const id of [...concepts.keys()].sort(compareIds)) visit(id);
	return errors;
}

/** Return Kahn's topological order, prioritizing difficulty and then identifier. */
export function topoOrder(g: ConceptGraph): string[] {
	const errors = validateGraph(g);
	if (errors.length) throw new Error(errors.join("; "));
	const concepts = new Map(g.concepts.map(c => [c.id, c]));
	const remaining = new Map(g.concepts.map(c => [c.id, new Set(c.prerequisites).size]));
	const dependents = new Map<string, string[]>();
	for (const c of g.concepts) {
		for (const p of new Set(c.prerequisites)) {
			if (!dependents.has(p)) dependents.set(p, []);
			dependents.get(p)!.push(c.id);
		}
	}
	const ready = g.concepts.filter(c => remaining.get(c.id) === 0).map(c => c.id);
	const result: string[] = [];
	while (ready.length) {
		ready.sort((a, b) => concepts.get(a)!.difficulty - concepts.get(b)!.difficulty || compareIds(a, b));
		const id = ready.shift()!;
		result.push(id);
		for (const next of dependents.get(id) ?? []) {
			remaining.set(next, remaining.get(next)! - 1);
			if (remaining.get(next) === 0) ready.push(next);
		}
	}
	return result;
}

/** Return unmastered concepts with all prerequisites mastered, in teaching order. */
export function frontier(g: ConceptGraph, mastered: Set<string>): Concept[] {
	const concepts = new Map(g.concepts.map(c => [c.id, c]));
	return topoOrder(g).map(id => concepts.get(id)!)
		.filter(c => !mastered.has(c.id) && c.prerequisites.every(p => mastered.has(p)));
}

function collectAncestors(g: ConceptGraph, id: string): Set<string> {
	const concepts = new Map(g.concepts.map(c => [c.id, c]));
	if (!concepts.has(id)) throw new Error(`unknown concept: ${id}`);
	const result = new Set<string>();
	const pending = [...concepts.get(id)!.prerequisites];
	while (pending.length) {
		const next = pending.pop()!;
		if (result.has(next)) continue;
		result.add(next);
		pending.push(...concepts.get(next)!.prerequisites);
	}
	return result;
}

/** Return all transitive prerequisites, excluding the requested concept. */
export function ancestors(g: ConceptGraph, id: string): Set<string> {
	topoOrder(g);
	return collectAncestors(g, id);
}

/** Return unmastered ancestors and always the target, in topological order. */
export function pathTo(g: ConceptGraph, targetId: string, mastered: Set<string>): string[] {
	const order = topoOrder(g);
	const required = collectAncestors(g, targetId);
	return order.filter(id => id === targetId || (required.has(id) && !mastered.has(id)));
}

/** Render a deterministic Mermaid diagram with safe labels and mastery classes. */
export function toMermaid(g: ConceptGraph, mastered: Set<string> = new Set()): string {
	const order = topoOrder(g);
	const concepts = new Map(g.concepts.map(c => [c.id, c]));
	// Prefix IDs to avoid Mermaid reserved words such as "end" and numeric IDs.
	const node = (id: string): string => `concept_${id}`;
	const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
		.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\r\n]/g, " ");
	const lines = ["flowchart TD"];
	for (const id of order) lines.push(`  ${node(id)}["${escape(concepts.get(id)!.title || id)}"]`);
	for (const id of order) {
		for (const p of [...new Set(concepts.get(id)!.prerequisites)].sort(compareIds)) {
			lines.push(`  ${node(p)} --> ${node(id)}`);
		}
	}
	const learned = order.filter(id => mastered.has(id)).map(node);
	if (learned.length) {
		lines.push("  classDef mastered fill:#cfc,stroke:#383;");
		lines.push(`  class ${learned.join(",")} mastered;`);
	}
	return lines.join("\n");
}
