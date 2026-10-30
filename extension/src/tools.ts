import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { frontier, isMastered, nowIso, pathTo, slugify, toMermaid, validateGraph } from "../../core/src/index.ts";
import type { PsiStore } from "../../core/src/index.ts";
import type { CrewRole, Rating } from "../../core/src/types.ts";
import { cardSchema, conceptSchema, explorableSchema, planSchema, storyboardSchema } from "./schemas.ts";
import type { TutorState } from "./tutor.ts";

/** Bound both model-facing text and structured details. */
export function toolResult(details: unknown, hint = "") {
	const json = JSON.stringify(details, null, 2) ?? "null";
	const truncated = json.length > 16000;
	const text = truncated ? `${json.slice(0, 16000)}\n[truncated]` : json;
	return {
		content: [{ type: "text" as const, text: `${hint ? `${hint}\n` : ""}${text}` }],
		details: truncated ? { truncated: true, preview: text } : details,
	};
}

/** Concepts mastered by retrieval evidence, never by lesson completion. */
export function masteredIds(store: PsiStore, topic: string): Set<string> {
	return new Set(Object.values(store.readLearner(topic)?.mastery ?? {})
		.filter((m) => isMastered(m)).map((m) => m.conceptId));
}

/** Register the learning, retrieval, rendering, and studio orchestration tools. */
export function registerTools(
	pi: ExtensionAPI, store: PsiStore, state: TutorState, refresh: (ctx: ExtensionContext) => void,
): void {
	const topicSchema = Type.Optional(Type.String({ description: "Topic slug; defaults to active topic" }));
	const topicOf = (topic?: string) => {
		const value = slugify(topic ?? state.topic ?? "");
		if (!value) throw new Error("Choose a topic with /learn, or supply topic.");
		return value;
	};
	pi.registerTool(defineTool({
		name: "psi_concept_graph",
		label: "Concept graph",
		description: "Create or update a prerequisite graph; return validation errors or Mermaid.",
		parameters: Type.Object({
			topic: topicSchema, title: Type.String(), bigIdea: Type.String(), concepts: Type.Array(conceptSchema),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const topic = topicOf(p.topic);
			const graph = { ...p, topic, createdAt: store.readGraph(topic)?.createdAt ?? nowIso(), updatedAt: nowIso() };
			const errors = validateGraph(graph);
			if (errors.length) return toolResult({ errors });
			store.writeGraph(topic, graph);
			refresh(ctx);
			return toolResult({ topic, mermaid: toMermaid(graph, masteredIds(store, topic)) });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_lesson_plan",
		label: "Lesson plan",
		description: "Save a lesson plan or find the mastery frontier/path to a target concept.",
		parameters: Type.Object({
			topic: topicSchema, plan: Type.Optional(planSchema), targetId: Type.Optional(Type.String()),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const topic = topicOf(p.topic ?? p.plan?.topic);
			const graph = store.readGraph(topic);
			if (!graph) return toolResult({ errors: ["Create a concept graph first."] });
			const ids = new Set(graph.concepts.map((c) => c.id));
			const errors = [
				...(p.plan?.lessons ?? []).filter((l) => !ids.has(l.conceptId)).map((l) => `Unknown concept: ${l.conceptId}`),
				...(p.targetId && !ids.has(p.targetId) ? [`Unknown concept: ${p.targetId}`] : []),
			];
			// Validate everything before writing so a bad targetId cannot leave a half-applied call.
			if (errors.length) return toolResult({ errors });
			if (p.plan) {
				const now = nowIso();
				store.writePlan(topic, { ...p.plan, topic, createdAt: p.plan.createdAt || now, updatedAt: now });
			}
			const mastered = masteredIds(store, topic);
			refresh(ctx);
			return toolResult({ plan: store.readPlan(topic), frontier: frontier(graph, mastered),
				path: p.targetId ? pathTo(graph, p.targetId, mastered) : undefined });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_cards_add",
		label: "Add cards",
		description: "Add retrieval cards for a topic's concepts.",
		parameters: Type.Object({ topic: topicSchema, cards: Type.Array(cardSchema, { minItems: 1 }) }),
		async execute(_id, p, _signal, _update, ctx) {
			const topic = topicOf(p.topic);
			const graph = store.readGraph(topic);
			const errors = p.cards.flatMap((c) => [
				...(graph && !graph.concepts.some((x) => x.id === c.conceptId) ? [`Unknown concept: ${c.conceptId}`] : []),
				...(c.kind === "mcq" && (c.choices?.length ?? 0) < 2 ? ["MCQ cards need at least two choices."] : []),
			]);
			if (errors.length) return toolResult({ errors });
			const cards = store.addCards(topic, p.cards);
			refresh(ctx);
			return toolResult({ cards });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_review_next",
		label: "Next review",
		description: "Get one due card. Ask the learner before revealing its answer.",
		parameters: Type.Object({ topic: topicSchema }),
		async execute(_id, p) {
			const due = store.dueCards(p.topic ? topicOf(p.topic) : state.topic);
			return toolResult({ card: due[0] ?? null, remaining: due.length });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_review_grade",
		label: "Grade review",
		description: "Record retrieval: 1 Again, 2 Hard, 3 Good, 4 Easy. Return mastery change and next card.",
		parameters: Type.Object({
			topic: topicSchema, cardId: Type.String(), rating: Type.Integer({ minimum: 1, maximum: 4 }),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const topic = topicOf(p.topic);
			if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 4) throw new Error("Rating must be 1–4.");
			const existing = store.readCards(topic).find((c) => c.id === p.cardId);
			if (!existing) return toolResult({ errors: ["Card not found."] });
			const before = store.readLearner(topic)?.mastery[existing.conceptId];
			const card = store.review(topic, p.cardId, p.rating as Rating);
			const after = store.readLearner(topic)?.mastery[card.conceptId];
			const due = store.dueCards(topic);
			refresh(ctx);
			return toolResult({ card, masteryChange: { before: before ?? null, after: after ?? null,
				delta: (after?.pKnown ?? 0) - (before?.pKnown ?? 0) }, next: due[0] ?? null, remaining: due.length });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_mastery",
		label: "Mastery",
		description: "Report observed concept mastery and currently available frontier.",
		parameters: Type.Object({ topic: topicSchema }),
		async execute(_id, p) {
			const topic = topicOf(p.topic);
			const graph = store.readGraph(topic);
			return toolResult({ topic, mastery: store.readLearner(topic)?.mastery ?? {},
				frontier: graph ? frontier(graph, masteredIds(store, topic)) : [], due: store.dueCards(topic).length });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_storyboard",
		label: "Storyboard",
		description: "Validate, save, and render storyboard HTML. Return errors or an artifact path.",
		parameters: Type.Object({
			storyboard: storyboardSchema,
			speech: Type.Optional(Type.Boolean({ description: "Read narration aloud with browser speech synthesis" })),
			autoplay: Type.Optional(Type.Boolean({ description: "Start playing when the page opens" })),
		}),
		async execute(_id, p) {
			const { validateStoryboard, renderStoryboardHtml } = await import("../../visual/src/index.ts");
			const errors = validateStoryboard(p.storyboard);
			if (errors.length) return toolResult({ errors });
			const html = renderStoryboardHtml(p.storyboard, { speech: p.speech === true, autoplay: p.autoplay === true });
			store.saveStoryboard(p.storyboard);
			const path = store.writeArtifact(p.storyboard.topic, `${slugify(p.storyboard.id)}.html`, html);
			return toolResult({ path }, "Use /studio to view this artifact.");
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_explorable",
		label: "Explorable",
		description: "Validate, save, and render a slider-driven HTML explorable; return errors or an artifact path.",
		parameters: Type.Object({ spec: explorableSchema }),
		async execute(_id, p) {
			const { validateExplorable, renderExplorableHtml } = await import("../../visual/src/index.ts");
			const errors = validateExplorable(p.spec);
			if (errors.length) return toolResult({ errors });
			const html = renderExplorableHtml(p.spec);
			store.saveExplorable(p.spec);
			const path = store.writeArtifact(p.spec.topic, `${slugify(p.spec.id)}.html`, html);
			return toolResult({ path }, "Use /studio to view this artifact.");
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_manim",
		label: "Manim",
		description: "Render manim code, or transpile a saved storyboard to Python (optionally render it).",
		parameters: Type.Object({
			topic: topicSchema, code: Type.Optional(Type.String()), storyboardId: Type.Optional(Type.String()),
			render: Type.Optional(Type.Boolean()), scene: Type.Optional(Type.String()),
			quality: Type.Optional(Type.Union([Type.Literal("l"), Type.Literal("m"), Type.Literal("h")])),
			runner: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("local"), Type.Literal("docker")])),
		}),
		async execute(_id, p, signal) {
			const topic = topicOf(p.topic);
			const { renderManim, storyboardToManim } = await import("../../visual/src/index.ts");
			let code = p.code;
			let sourcePath: string | undefined;
			if (p.storyboardId) {
				const sb = store.readStoryboard(topic, p.storyboardId);
				if (!sb) return toolResult({ errors: ["Storyboard not found."] });
				code = storyboardToManim(sb);
				sourcePath = store.writeArtifact(topic, `${slugify(p.storyboardId)}.py`, code);
			}
			if (!code) return toolResult({ errors: ["Supply code or storyboardId."] });
			if (p.storyboardId && p.render !== true) {
				return toolResult({ outputs: [sourcePath] }, "Use /studio to view artifacts.");
			}
			const result = await renderManim({ code, scene: p.scene, outDir: store.artifactsDir(topic),
				quality: p.quality, runner: p.runner, signal });
			// Studio lists artifacts/ flat, so publish finished videos next to the HTML artifacts.
			const videos = result.outputs.map((file, index) => {
				const scene = basename(file, ".mp4").replace(/([a-z0-9])([A-Z])/g, "$1-$2");
				const name = slugify(p.storyboardId ?? scene) || "manim";
				return store.writeArtifact(topic, `${name}${index ? `-${index + 1}` : ""}.mp4`, readFileSync(file));
			});
			const outputs = [...(sourcePath ? [sourcePath] : []), ...videos];
			return toolResult({ ...result, outputs, ...(sourcePath ? { source: sourcePath } : {}),
				...(result.outputs.length ? { media: result.outputs } : {}) }, "Use /studio to view rendered artifacts.");
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_crew",
		label: "Lesson crew",
		description: "Run specialist role tasks, or build a complete multi-agent lesson for a concept.",
		parameters: Type.Object({ topic: topicSchema, conceptId: Type.Optional(Type.String()),
			tasks: Type.Optional(Type.Array(Type.Object({
				role: Type.Union([
					"architect", "intuition", "storyteller", "visualizer", "quizmaster", "critic",
				].map((v) => Type.Literal(v))),
				instructions: Type.String(), conceptId: Type.Optional(Type.String()),
				inputs: Type.Optional(Type.Array(Type.String())),
			}), { minItems: 1 })),
		}),
		async execute(_id, p, signal, _update, ctx) {
			const topic = topicOf(p.topic);
			const { runCrewTask, buildLesson } = await import("../../crew/src/index.ts");
			// Children inherit the session's model unless PSI_CREW_MODEL overrides it.
			const current = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
			const opts = { store, signal, model: process.env.PSI_CREW_MODEL || current };
			const results = [];
			if (p.tasks) {
				for (const task of p.tasks) results.push(await runCrewTask({ ...task,
					role: task.role as CrewRole, topic, conceptId: task.conceptId ?? p.conceptId }, opts));
			} else {
				if (!p.conceptId) return toolResult({ errors: ["Supply conceptId for a full lesson, or tasks."] });
				results.push(...await buildLesson(topic, p.conceptId, opts));
			}
			refresh(ctx);
			return toolResult({ results });
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_note",
		label: "Learner note",
		description: "Append an observation about learner thinking or misconceptions; does not grant mastery.",
		parameters: Type.Object({ topic: topicSchema, note: Type.String({ minLength: 1 }) }),
		async execute(_id, p) {
			const topic = topicOf(p.topic);
			const text = p.note.replace(/\s+/g, " ").trim();
			if (!text) return toolResult({ errors: ["Note must not be blank."] });
			store.appendNote(topic, `- ${nowIso()} ${text}`);
			const notes = store.readNotes(topic).split(/\r?\n/).filter((line) => line.trim()).length;
			return toolResult({ saved: true, path: `${store.topicDir(topic)}/notes.md`, notes });
		},
	}));
}
