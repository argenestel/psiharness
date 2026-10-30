import { Type } from "@earendil-works/pi-ai";
import type { Concept, ExplorableSpec, LessonPlan, Storyboard } from "../../core/src/types.ts";

const strings = () => Type.Array(Type.String());
const style = Type.Union([Type.Literal("3b1b"), Type.Literal("kurzgesagt"), Type.Literal("plain")]);
const props = Type.Record(Type.String(), Type.Unknown());
const anim = Type.Object({
	type: Type.Union([
		"fade", "pop", "slide", "draw", "pulse", "orbit", "float", "grow", "typewriter",
	].map((value) => Type.Literal(value))),
	delay: Type.Optional(Type.Number()), duration: Type.Optional(Type.Number()),
	from: Type.Optional(Type.Union(["left", "right", "top", "bottom"].map((value) => Type.Literal(value)))),
});
export const conceptSchema = Type.Unsafe<Concept>(Type.Object({
	id: Type.String(), title: Type.String(), summary: Type.String(), prerequisites: strings(),
	difficulty: Type.Integer({ minimum: 1, maximum: 5 }), intuition: Type.Optional(Type.String()),
	misconceptions: Type.Optional(strings()), visualHooks: Type.Optional(strings()), tags: Type.Optional(strings()),
}));
export const planSchema = Type.Unsafe<LessonPlan>(Type.Object({
	topic: Type.String(), goal: Type.String(),
	learnerLevel: Type.Union(["curious", "student", "practitioner", "expert"].map((value) => Type.Literal(value))),
	createdAt: Type.String(), updatedAt: Type.String(), lessons: Type.Array(Type.Object({
		conceptId: Type.String(), objective: Type.String(), checks: strings(),
		status: Type.Union(["planned", "in-progress", "done"].map((value) => Type.Literal(value))),
		beats: Type.Array(Type.Object({
			kind: Type.Union(["hook", "question", "build", "reveal", "zoom-out", "recap"].map((value) => Type.Literal(value))),
			text: Type.String(),
		})),
		visuals: Type.Array(Type.Object({
			kind: Type.Union(["storyboard", "manim", "explorable", "diagram"].map((value) => Type.Literal(value))),
			style, title: Type.String(), goal: Type.String(), path: Type.Optional(Type.String()),
		})),
	})),
}));
export const storyboardSchema = Type.Unsafe<Storyboard>(Type.Object({
	id: Type.String(), title: Type.String(), topic: Type.String(), conceptId: Type.Optional(Type.String()),
	style, palette: Type.Optional(Type.String()), scenes: Type.Array(Type.Object({
		id: Type.String(), narration: Type.String(), durationSec: Type.Number(), background: Type.Optional(Type.String()),
		camera: Type.Optional(Type.Object({
			zoom: Type.Optional(Type.Number()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()),
		})),
		elements: Type.Array(Type.Object({
			id: Type.String(), kind: Type.Union([
				"circle", "rect", "text", "arrow", "path", "equation", "graph", "vector", "creature", "particles", "group",
			].map((value) => Type.Literal(value))), props,
			enter: Type.Optional(anim), exit: Type.Optional(anim), loop: Type.Optional(anim),
		})),
	})),
}));
export const explorableSchema = Type.Unsafe<ExplorableSpec>(Type.Object({
	id: Type.String(), title: Type.String(), topic: Type.String(), conceptId: Type.Optional(Type.String()), style,
	template: Type.Union([
		"function-plot", "linear-transform", "vector-field", "fourier-epicycles", "probability-sim", "exponential-growth",
	].map((value) => Type.Literal(value))), params: props, prompts: strings(), sliders: Type.Array(Type.Object({
		name: Type.String(), label: Type.String(), min: Type.Number(), max: Type.Number(),
		step: Type.Number(), value: Type.Number(),
	})),
}));
export const cardSchema = Type.Object({
	conceptId: Type.String(), kind: Type.Union([
		Type.Literal("recall"), Type.Literal("predict"), Type.Literal("explain"), Type.Literal("mcq"),
	]), prompt: Type.String(), answer: Type.String(), choices: Type.Optional(strings()),
});
