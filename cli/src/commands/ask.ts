import { arity } from "../args.ts";
import type { ParsedArgs } from "../args.ts";
import { launchHost } from "../host.ts";

/** Ask the tutor a question and exit after its response. */
export async function ask(args: ParsedArgs): Promise<number> {
	arity(args, 1, Infinity, 'ask "<question>"');
	return launchHost(args, args.positionals.join(" "), true);
}
