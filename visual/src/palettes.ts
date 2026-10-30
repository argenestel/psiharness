import type { VisualStyle } from "../../core/src/types.ts";

/** Colors shared by the standalone visual renderers. */
export type Palette = {
	name: string; bg: string; fg: string; muted: string; accent: string[]; deep: string; glow: string;
};

/** Built-in narrative and mathematical color schemes. */
export const PALETTES: Record<string, Palette> = {
	"kurzgesagt": {
		name: "kurzgesagt", bg: "#0e1a40", fg: "#fff5e6", muted: "#a4b5d8",
		accent: ["#22d4c5", "#ff9351", "#f465a9", "#ffda66"], deep: "#080e28", glow: "#ffc582",
	},
	"kurzgesagt-space": {
		name: "kurzgesagt-space", bg: "#100d30", fg: "#f2edff", muted: "#aaa0cf",
		accent: ["#a57aff", "#32d8d0", "#f2c969"], deep: "#06051b", glow: "#9aafff",
	},
	"kurzgesagt-bio": {
		name: "kurzgesagt-bio", bg: "#092e30", fg: "#effff3", muted: "#9ac9bb",
		accent: ["#87e878", "#ec62b6", "#33c9ac", "#f5d569"], deep: "#041c20", glow: "#b7f4ad",
	},
	"3b1b": {
		name: "3b1b", bg: "#0f0f0f", fg: "#dedede", muted: "#999999",
		accent: ["#58C4DD", "#FFFF8A", "#83C167", "#FC6255"], deep: "#050505", glow: "#58C4DD",
	},
	"plain": {
		name: "plain", bg: "#f7f8fa", fg: "#202733", muted: "#626c7a",
		accent: ["#456a91", "#8b7355", "#637e6b", "#8c6886"], deep: "#e3e7ec", glow: "#ffffff",
	},
};

/** Select a named palette, falling back to the visual style. */
export function paletteFor(style: VisualStyle, name?: string): Palette {
	return (name && Object.hasOwn(PALETTES, name) ? PALETTES[name] : PALETTES[style]) ?? PALETTES.plain!;
}
