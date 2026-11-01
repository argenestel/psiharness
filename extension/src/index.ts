import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { PsiStore } from "../../core/src/index.ts";
import { webReadPath } from "./read-policy.ts";
import { registerCommands } from "./commands.ts";
import { registerPractice } from "./practice/index.ts";
import { registerTools } from "./tools.ts";
import { registerTutor, type TutorState } from "./tutor.ts";
import { updateWidget } from "./widget.ts";

/** Install psi: the practice-first layer (memory, 20-hour skills, challenges) plus the concept/visual tutor. */
export default function psiExtension(pi: ExtensionAPI): void {
	const root = process.env.PSI_WEB_READ_ROOT;
	// psi's own skills and prompt templates are read-only teaching material the tutor must be able to open.
	const bundled = ["skills", "prompts"].map((dir) => fileURLToPath(new URL(`../../${dir}/`, import.meta.url)));
	if (root) pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "read") return;
		const path = [root, ...bundled].map((base) => webReadPath(base, event.input.path, ctx.cwd)).find(Boolean);
		if (!path) return { block: true, reason: "Web reads are restricted to PSI_HOME and psi's skills." };
		event.input.path = path;
	});
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
