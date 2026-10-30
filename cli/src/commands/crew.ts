import { arity, option } from "../args.ts";
import type { ParsedArgs } from "../args.ts";
import { hostConfig } from "../host.ts";
import { table } from "../term.ts";

/** Build a lesson with the role crew and summarize each result. */
export async function crew(args: ParsedArgs): Promise<number> {
	arity(args, 2, 2, "crew <topic> <conceptId> [--model M] [-- host args]");
	const { buildLesson } = await import("../../../crew/src/runner.ts");
	const results = await buildLesson(args.positionals[0], args.positionals[1], {
		...hostConfig(args), model: option(args, "model"), args: args.passthrough,
	});
	console.log(table(["Role", "Result", "Seconds", "Files", "Error"], results.map((result) => [
		result.role, result.ok ? "✓" : "✗", (result.durationMs / 1000).toFixed(1), result.files.join(", "),
		result.error ?? "",
	])));
	return results.every((result) => result.ok) ? 0 : 1;
}
