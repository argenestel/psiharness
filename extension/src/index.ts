import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PsiStore } from "../../core/src/index.ts";
import { registerCommands } from "./commands.ts";
import { registerPractice } from "./practice/index.ts";
import { registerTools } from "./tools.ts";
import { registerTutor, type TutorState } from "./tutor.ts";
import { updateWidget } from "./widget.ts";

/** Install psi: the practice-first layer (memory, 20-hour skills, challenges) plus the concept/visual tutor. */
export default function psiExtension(pi: ExtensionAPI): void {
	registerPractice(pi);
	registerConceptLayer(pi);
}

/** Concept graphs, lessons, flashcards, and optional visuals, with one shared store and session-local tutor state. */
export function registerConceptLayer(pi: ExtensionAPI): void {
	const store = new PsiStore();
	const state: TutorState = { mode: "off" };
	const refresh = (ctx: Parameters<typeof updateWidget>[0]) => updateWidget(ctx, store, state);
	registerTutor(pi, store, state, refresh);
	registerTools(pi, store, state, refresh);
	registerCommands(pi, store, state, refresh);
	pi.on("turn_end", async (_event, ctx) => refresh(ctx));
}
