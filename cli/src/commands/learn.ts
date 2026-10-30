import type { ParsedArgs } from "../args.ts";
import { launchHost } from "../host.ts";

/** Start an interactive learning session, optionally with a new big idea. */
export async function learn(args: ParsedArgs): Promise<number> {
	const idea = args.positionals.join(" ");
	return launchHost(args, idea ? `/learn ${idea}` : undefined);
}
