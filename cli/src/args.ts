/** Parsed CLI arguments; tokens following -- are forwarded unchanged to the host. */
export interface ParsedArgs {
	positionals: string[];
	options: Record<string, string | boolean>;
	passthrough: string[];
}

const values = new Set(["host", "model", "thinking", "topic", "psi-topic", "port", "o", "q"]);
const switches = new Set(["help", "version", "mermaid", "manim", "docker", "open"]);
const aliases: Record<string, string> = { h: "help", v: "version", output: "o", quality: "q" };

/** Parse supported options without consuming host arguments after --. */
export function parseArgs(argv: string[]): ParsedArgs {
	const result: ParsedArgs = { positionals: [], options: {}, passthrough: [] };
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === "--") {
			result.passthrough = argv.slice(i + 1);
			break;
		}
		if (!token.startsWith("-") || token === "-") {
			result.positionals.push(token);
			continue;
		}
		const match = /^--?([^=]+)(?:=(.*))?$/.exec(token);
		if (!match) throw new Error(`Invalid option: ${token}`);
		const key = aliases[match[1]] ?? match[1];
		if (values.has(key)) {
			const value = match[2] ?? argv[++i];
			if (!value || (match[2] === undefined && value.startsWith("-"))) {
				throw new Error(`Option ${token} requires a value`);
			}
			result.options[key] = value;
		} else if (switches.has(key) && match[2] === undefined) {
			result.options[key] = true;
		} else {
			throw new Error(`Unknown option: ${token}. Forward host options after --.`);
		}
	}
	return result;
}

/** Get a string option when supplied. */
export function option(args: ParsedArgs, name: string): string | undefined {
	const value = args.options[name];
	return typeof value === "string" ? value : undefined;
}

/** Enforce a command's positional argument count. */
export function arity(args: ParsedArgs, min: number, max: number, usage: string): void {
	if (args.positionals.length < min || args.positionals.length > max) throw new Error(`Usage: psi ${usage}`);
}
