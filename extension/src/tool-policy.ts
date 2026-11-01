/** Explicit web tool policy: adding an extension tool never grants web access automatically. */
export const WEB_TOOL_POLICY = [
	{ name: "psi_concept_graph" }, { name: "psi_lesson_plan" }, { name: "psi_cards_add" },
	{ name: "psi_review_next" }, { name: "psi_review_grade" }, { name: "psi_mastery" },
	{ name: "psi_storyboard" }, { name: "psi_explorable" }, { name: "psi_note" },
	{ name: "psi_memory_remember" }, { name: "psi_memory_recall" }, { name: "psi_memory_forget" },
	{ name: "psi_recap" }, { name: "psi_skill_plan" }, { name: "psi_challenge" }, { name: "psi_attempt" },
	{ name: "psi_hint" }, { name: "psi_practice_session" }, { name: "psi_progress_report" },
	{ name: "psi_path" }, { name: "psi_lesson" }, { name: "psi_sources" }, { name: "psi_fetch" },
	{ name: "psi_search" }, { name: "psi_verify" }, { name: "psi_next_steps" }, { name: "psi_ask" },
	{ name: "psi_run", execution: true }, { name: "psi_manim", execution: true },
	{ name: "psi_crew", execution: true },
] as const;

/** Names permitted for web chats under the supplied execution opt-in. */
export function webToolNames(source: NodeJS.ProcessEnv = process.env): string[] {
	return WEB_TOOL_POLICY.filter((tool) => !("execution" in tool) || source.PSI_CODE_EXEC === "1")
		.map((tool) => tool.name).sort();
}
