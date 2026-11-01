import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const short = (value: unknown, max: number): value is string =>
	typeof value === "string" && !!value.trim() && value.length <= max;
const result = (details: unknown, text: string) => ({ content: [{ type: "text" as const, text }], details });
const error = (text: string) => ({ ...result({ errors: [text] }, text), isError: true });

/** Register ungraded lesson prompts and concrete continuation choices. */
export function registerFlow(pi: ExtensionAPI): void {
	pi.registerTool(defineTool({
		name: "psi_next_steps", label: "Next steps", description: "Offer 2–4 concrete choices, including Continue.",
		parameters: Type.Object({ options: Type.Array(Type.Object({
			label: Type.String({ minLength: 1, maxLength: 60 }),
			message: Type.String({ minLength: 1, maxLength: 400 }),
		}), { minItems: 2, maxItems: 4 }) }),
		async execute(_id, p) {
			if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 4
				|| p.options.some((o) => !o || !short(o.label, 60) || !short(o.message, 400))) {
				return error("Provide 2–4 options with nonempty labels (≤60 characters) and messages (≤400 characters).");
			}
			return result({ widget: { type: "next_steps", options: p.options } }, "Offered next steps");
		},
	}));
	pi.registerTool(defineTool({
		name: "psi_ask", label: "Think along", description: "Offer a short, optional, ungraded Socratic prompt; no XP.",
		parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 400 }),
			kind: Type.Union([Type.Literal("predict"), Type.Literal("why"), Type.Literal("what-if")]),
			hint: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })) }),
		async execute(_id, p) {
			if (!short(p.question, 400) || !["predict", "why", "what-if"].includes(p.kind)
				|| (p.hint !== undefined && !short(p.hint, 400))) return error("Provide a short question, valid kind and hint.");
			return result({ widget: { type: "socratic", ...p } }, p.question);
		},
	}));
}
