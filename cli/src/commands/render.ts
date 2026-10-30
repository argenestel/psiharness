import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { arity, option } from "../args.ts";
import type { ParsedArgs } from "../args.ts";
import type { ExplorableSpec, Storyboard } from "../../../core/src/types.ts";

/** Render storyboard/explorable JSON to HTML, or Python/storyboard JSON through manim. */
export async function render(args: ParsedArgs): Promise<number> {
	arity(args, 1, 1, "render [--manim] <file> [-o path] [-q l|m|h] [--docker]");
	const file = resolve(args.positionals[0]);
	const source = readFileSync(file, "utf8");
	if (args.options.manim) {
		const quality = option(args, "q") ?? "m";
		if (quality !== "l" && quality !== "m" && quality !== "h") throw new Error("Quality must be l, m, or h");
		const { renderManim, storyboardToManim } = await import("../../../visual/src/manim.ts");
		let code = source;
		if (extname(file).toLowerCase() !== ".py") {
			const sb = JSON.parse(source) as Storyboard;
			const { validateStoryboard } = await import("../../../visual/src/storyboard-html.ts");
			const errors = validateStoryboard(sb);
			if (errors.length) throw new Error(errors.join("; "));
			code = storyboardToManim(sb);
		}
		const result = await renderManim({ code, outDir: resolve(option(args, "o") ?? dirname(file)),
			quality, runner: args.options.docker ? "docker" : "auto" });
		if (result.outputs.length) console.log(result.outputs.join("\n"));
		if (!result.ok) throw new Error(result.log || "Manim rendering failed");
		return 0;
	}
	const spec: unknown = JSON.parse(source);
	if (!spec || typeof spec !== "object") throw new Error("Expected a storyboard or explorable object");
	let html: string;
	if ("scenes" in spec && Array.isArray(spec.scenes)) {
		const { renderStoryboardHtml, validateStoryboard } = await import("../../../visual/src/storyboard-html.ts");
		const errors = validateStoryboard(spec as Storyboard);
		if (errors.length) throw new Error(errors.join("; "));
		html = renderStoryboardHtml(spec as Storyboard);
	} else if ("template" in spec && "sliders" in spec && "params" in spec) {
		const { renderExplorableHtml, validateExplorable } = await import("../../../visual/src/explorable.ts");
		const errors = validateExplorable(spec as ExplorableSpec);
		if (errors.length) throw new Error(errors.join("; "));
		html = renderExplorableHtml(spec as ExplorableSpec);
	} else {
		throw new Error("Unrecognized JSON: expected storyboard scenes or explorable template, params, and sliders");
	}
	const output = resolve(option(args, "o") ?? file.replace(/\.[^/.]+$/, "") + ".html");
	if (output === file) throw new Error("Output must differ from the input file");
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, html);
	console.log(output);
	return 0;
}
