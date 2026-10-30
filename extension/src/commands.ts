import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { frontier, slugify, toMermaid, type PsiStore } from "../../core/src/index.ts";
import { masteredIds } from "./tools.ts";
import { persistTutor, type TutorState } from "./tutor.ts";
import { progressSummary } from "./widget.ts";

function listening(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(200, () => finish(false));
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

/** Register interactive lesson workflows using ordinary user-message turns. */
export function registerCommands(
	pi: ExtensionAPI, store: PsiStore, state: TutorState, refresh: (ctx: ExtensionContext) => void,
): void {
	const send = (message: string) => pi.sendUserMessage(message, { deliverAs: "followUp" });
	const topic = (ctx: ExtensionContext): string | undefined => {
		if (!state.topic) ctx.ui.notify("Choose a big idea with /learn <big idea> first.", "info");
		return state.topic;
	};
	pi.registerCommand("learn", {
		description: "Learn a big idea: diagnose, map prerequisites, and plan",
		async handler(args, ctx) {
			const idea = args.trim();
			if (!idea || !slugify(idea)) { ctx.ui.notify("Usage: /learn <big idea>", "info"); return; }
			state.topic = slugify(idea);
			state.mode = "on";
			delete state.currentLesson;
			persistTutor(pi, state);
			refresh(ctx);
			send(`Help me learn ${JSON.stringify(idea)} (topic: ${state.topic}). First diagnose my prior knowledge
with one focused question and wait for my answer. Then build a concept graph with psi_concept_graph and a
lesson plan with psi_lesson_plan. Use existing learner evidence; never assume mastery.`);
		},
	});
	pi.registerCommand("map", {
		description: "Show the concept graph and mastery frontier",
		async handler(_args, ctx) {
			const t = topic(ctx); if (!t) return;
			const graph = store.readGraph(t);
			if (!graph) { ctx.ui.notify("No graph yet. Use /learn to build one.", "info"); return; }
			const mastered = masteredIds(store, t);
			const available = frontier(graph, mastered).map((c) => c.title).join(", ") || "none";
			pi.sendMessage({ customType: "psi-map", display: true,
				content: `\`\`\`mermaid\n${toMermaid(graph, mastered)}\n\`\`\`\nFrontier: ${available}` });
		},
	});
	pi.registerCommand("lesson", {
		description: "Teach the next available concept or a specified concept",
		async handler(args, ctx) {
			const t = topic(ctx); if (!t) return;
			const graph = store.readGraph(t);
			if (!graph) { ctx.ui.notify("Create a concept graph with /learn first.", "info"); return; }
			const requested = args.trim();
			const concept = requested ? graph.concepts.find((c) =>
				c.id === requested || c.title.toLowerCase() === requested.toLowerCase())
				: frontier(graph, masteredIds(store, t))[0];
			if (!concept) {
				ctx.ui.notify(requested ? "Unknown concept. Use /map." : "No frontier concepts remain.", "info");
				return;
			}
			state.currentLesson = concept.id;
			state.mode = state.mode === "off" ? "on" : state.mode;
			persistTutor(pi, state);
			refresh(ctx);
			send(`Teach ${concept.id} in topic ${t}: hook → intuition → visual → formalism → check.
Check prerequisites with psi_lesson_plan targetId first; bridge missing foundations. Ask me to predict before
revealing. Use visual tools when helpful. Pause for my response and add retrieval cards;
never mark mastery by explanation alone.`);
		},
	});
	const flows = {
		quiz:
			"Quiz me one question at a time. Use psi_mastery to choose a concept, and psi_cards_add for " +
			"retrieval checks. Wait for my answer; give feedback before asking another question.",
		review:
			"Drill my due cards interactively. Call psi_review_next. Ask only the prompt/choices, hide the " +
			"answer, and wait for my attempt. Then reveal feedback, ask for a 1–4 rating " +
			"(Again/Hard/Good/Easy), and call psi_review_grade. Continue one card at a time until I stop or" +
			" no cards are due.",
		visualize:
			"Build an intuition-first animated storyboard with psi_storyboard. Ask for a prediction before " +
			"the reveal. Return the artifact path and suggest /studio.",
		explore:
			"Build a slider-driven explorable with psi_explorable. Include what to try and what to notice. " +
			"Return the artifact path and suggest /studio.",
		crew:
			"Build a full multi-agent lesson using psi_crew with conceptId. If the supplied concept is a " +
			"title, resolve it against the graph first. Report the crew results and artifacts.",
	};
	for (const [name, instruction] of Object.entries(flows)) {
		pi.registerCommand(name, {
			description: `${name[0].toUpperCase()}${name.slice(1)} the active topic`,
			async handler(args, ctx) {
				const t = topic(ctx); if (!t) return;
				const idea = args.trim() || state.currentLesson || "the next frontier concept";
				send(`Topic: ${t}. Focus: ${JSON.stringify(idea)}. ${instruction}`);
			},
		});
	}
	pi.registerCommand("progress", {
		description: "Show mastery and review progress",
		async handler(_args, ctx) { refresh(ctx); ctx.ui.notify(progressSummary(store, state.topic), "info"); },
	});
	pi.registerCommand("tutor", {
		description: "Set tutor mode: on, off, socratic, explain",
		async handler(args, ctx) {
			const mode = args.trim().toLowerCase();
			if (mode !== "on" && mode !== "off" && mode !== "socratic" && mode !== "explain") {
				ctx.ui.notify("Usage: /tutor on|off|socratic|explain", "info"); return;
			}
			state.mode = mode;
			persistTutor(pi, state);
			refresh(ctx);
			ctx.ui.notify(`Tutor mode: ${mode}`, "info");
		},
	});
	let starting: Promise<void> | undefined;
	pi.registerCommand("studio", {
		description: "Start the local artifact studio",
		async handler(_args, ctx) {
			const port = Number(process.env.PSI_STUDIO_PORT ?? 4173);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				ctx.ui.notify("PSI_STUDIO_PORT must be an integer from 1 to 65535.", "error"); return;
			}
			try {
				starting ??= (async () => {
					if (await listening(port)) return;
					const root = fileURLToPath(new URL("../../", import.meta.url));
					const child = spawn(process.execPath, ["studio/src/server.ts"], {
						cwd: root, detached: true, stdio: "ignore",
						env: { ...process.env, PSI_HOME: store.root, PSI_STUDIO_PORT: String(port) },
					});
					let failure: Error | undefined;
					child.once("error", (error) => { failure = error; });
					child.unref();
					for (let i = 0; i < 40; i++) {
						if (failure) throw failure;
						if (child.exitCode !== null) throw new Error(`Studio exited with code ${child.exitCode}`);
						if (await listening(port)) return;
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
					throw new Error("Studio did not become ready within 4 seconds.");
				})();
				await starting;
				ctx.ui.notify(`ψ studio: http://localhost:${port}`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not start studio: ${error instanceof Error ? error.message : String(error)}`, "error");
			} finally { starting = undefined; }
		},
	});
}
