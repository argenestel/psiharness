import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isMastered, type PsiStore } from "../../core/src/index.ts";
import type { TutorState } from "./tutor.ts";

/** Summarize evidence-based mastery and scheduled retrieval. */
export function progressSummary(store: PsiStore, topic?: string): string {
	const graph = topic ? store.readGraph(topic) : undefined;
	const learner = topic ? store.readLearner(topic) : undefined;
	const mastered = graph?.concepts.filter((c) => isMastered(learner?.mastery[c.id])).length ?? 0;
	const due = store.dueCards(topic).length;
	return `ψ ${topic ?? "—"} · ${mastered}/${graph?.concepts.length ?? 0} mastered · ${due} due`;
}

/** Refresh the common pi/omp footer and plain-text widget. */
export function updateWidget(ctx: ExtensionContext, store: PsiStore, state: TutorState): void {
	const text = progressSummary(store, state.topic);
	ctx.ui.setStatus("psi", text);
	ctx.ui.setWidget("psi-progress", state.mode === "off" ? undefined : [text]);
}
