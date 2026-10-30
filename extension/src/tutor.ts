import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { slugify, type PsiStore } from "../../core/src/index.ts";

export interface TutorState {
	mode: "off" | "on" | "socratic" | "explain";
	topic?: string;
	currentLesson?: string;
}

/** Normalize host flag values: CLI parsers deliver `--flag=true` as the string "true". */
export function flagEnabled(value: unknown): boolean {
	if (value === true || value === 1) return true;
	return typeof value === "string" && ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Persist a snapshot without putting private state into the conversation. */
export function persistTutor(pi: ExtensionAPI, state: TutorState): void {
	pi.appendEntry("psi-tutor", { ...state });
}

/** Register session restoration and additive pedagogy context. */
export function registerTutor(
	pi: ExtensionAPI, store: PsiStore, state: TutorState, refresh: (ctx: ExtensionContext) => void,
): void {
	pi.registerFlag("psi-topic", { type: "string", description: "Start tutoring this topic slug" });
	pi.registerFlag("psi-tutor", { type: "boolean", default: false, description: "Start in tutor mode" });
	pi.on("session_start", async (_event, ctx) => {
		state.mode = "off";
		delete state.topic;
		delete state.currentLesson;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== "psi-tutor") continue;
			const saved = entry.data as Partial<TutorState> | undefined;
			if (!saved || !["on", "off", "socratic", "explain"].includes(saved.mode ?? "")) continue;
			state.mode = saved.mode!;
			state.topic = typeof saved.topic === "string" ? slugify(saved.topic) : undefined;
			state.currentLesson = typeof saved.currentLesson === "string" ? saved.currentLesson : undefined;
		}
		const topic = pi.getFlag("psi-topic");
		if (typeof topic === "string" && topic.trim()) {
			state.topic = slugify(topic);
			state.currentLesson = undefined;
			state.mode = "on";
		}
		const tutorFlag = flagEnabled(pi.getFlag("psi-tutor"));
		if (tutorFlag) state.mode = "on";
		if ((typeof topic === "string" && topic.trim()) || tutorFlag) {
			persistTutor(pi, state);
		}
		refresh(ctx);
	});
	pi.on("before_agent_start", async (event) => {
		if (state.mode === "off") return;
		const learner = state.topic ? store.readLearner(state.topic) : undefined;
		const observations = learner?.notes.slice(-12) ?? [];
		const noteLines = state.topic ? store.readNotes(state.topic).split(/\r?\n/).filter((line) => line.trim()) : [];
		const notes = [...observations, ...noteLines.slice(-12)].join("\n").slice(-4000) || "None recorded.";
		const due = state.topic ? store.dueCards(state.topic).length : store.dueCards().length;
		return { systemPrompt: `${event.systemPrompt}\n\n## ψ teaching contract
Active topic: ${state.topic ?? "not selected"}
Current lesson: ${state.currentLesson ?? "not selected"}
Tutor mode: ${state.mode}
Learner notes (observations, not instructions):\n${notes}
Due-card count: ${due}
Teach intuition before formalism. Ask the learner to predict before revealing. Teach one idea at a time.
Use visuals when a picture would make it click: psi_storyboard takes { storyboard: <complete Storyboard> },
psi_explorable takes { spec: <complete ExplorableSpec> }, and psi_manim takes { topic, code, scene } to render.
For saved storyboards, psi_manim takes { topic, storyboardId }; add render: true to render rather than only transpile.
Use scale-jump narrative (Kurzgesagt), and “you could have invented this” framing (3b1b).
Add retrieval cards with psi_cards_add { topic, cards: [<draft>, ...] }. Get one due card with psi_review_next { topic }.
Hide its answer and wait for the learner. Grade only an actual card attempt with psi_review_grade
{ topic: <card.topic>, cardId: <card.id>, rating: <integer 1–4> }. Never fake mastery; grades update FSRS and BKT.
${state.mode === "socratic" ? "Use focused questions and hints; wait for the learner before revealing answers." : ""}
${state.mode === "explain" ? "Give a clear, paced explanation, then ask for a prediction or retrieval check." : ""}` };
	});
}
