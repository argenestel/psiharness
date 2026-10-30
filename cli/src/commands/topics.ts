import { arity } from "../args.ts";
import type { ParsedArgs } from "../args.ts";
import { table } from "../term.ts";

/** List stored topics and their mastery and due-card counts. */
export async function topics(args: ParsedArgs): Promise<number> {
	arity(args, 0, 0, "topics");
	const { PsiStore } = await import("../../../core/src/store.ts");
	const { isMastered } = await import("../../../core/src/bkt.ts");
	const store = new PsiStore();
	const rows = store.listTopics().map((topic) => {
		const graph = store.readGraph(topic);
		const profile = store.readLearner(topic);
		const mastered = graph?.concepts.filter((c) => isMastered(profile?.mastery[c.id])).length ?? 0;
		return [topic, graph?.title ?? topic,
			`${mastered}/${graph?.concepts.length ?? 0}`, `${store.dueCards(topic).length}`];
	});
	console.log(rows.length ? table(["Topic", "Title", "Mastered", "Due"], rows)
		: "No topics yet. Try psi learn <big idea>.");
	return 0;
}
