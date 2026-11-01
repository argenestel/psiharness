import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runCode } from "./run-core.ts";
import type { RunOptions, RunResult } from "./run-core.ts";
import { runRemote } from "./run-client.ts";

export { runCode };

function result(details: unknown, text: string) {
	return { content: [{ type: "text" as const, text }], details };
}

/**
 * Run locally, or — when PSI_RUN_SOCKET is set (Docker) — in the separate runner container, which holds no
 * credentials, no learner data and no network. A configured runner that is unreachable fails closed.
 */
export function execute(options: RunOptions): Promise<RunResult> {
	const socket = process.env.PSI_RUN_SOCKET;
	// Gate here too, so a runner started with bash on cannot widen what this agent was allowed.
	if (options.language === "bash" && process.env.PSI_CODE_EXEC_BASH !== "1") {
		return Promise.reject(new Error("Bash execution requires PSI_CODE_EXEC_BASH=1."));
	}
	return socket ? runRemote(socket, options) : runCode(options);
}

/** Expose demos only on hosts that explicitly enable code execution. */
export function registerRun(pi: ExtensionAPI): void {
	if (process.env.PSI_CODE_EXEC !== "1") return;
	pi.registerTool(defineTool({
		name: "psi_run", label: "Run lesson demo", description: "Execute a bounded demo and verify computed claims.",
		parameters: Type.Object({ language: Type.Union([
			Type.Literal("python"), Type.Literal("javascript"), Type.Literal("sql"), Type.Literal("bash"),
		]), code: Type.String(), setup: Type.Optional(Type.String()), stdin: Type.Optional(Type.String()) }),
		async execute(_id, p) {
			try {
				const output = await execute(p);
				const fence = "`".repeat(Math.max(3, ...[...p.code.matchAll(/`+/g)].map((m) => m[0].length + 1)));
				return result({ widget: { type: "run", language: p.language, code: p.code, ...output } },
					`${fence}${p.language}\n${p.code}\n${fence}\n`
					+ `stdout:\n${output.stdout}\nstderr:\n${output.stderr}\nExit code: ${output.exitCode}; `
					+ `timedOut: ${output.timedOut}${output.timedOut ? " (10 s timeout)" : ""}`);
			} catch (error) {
				return { ...result({ errors: [String(error)] }, String(error)), isError: true };
			}
		},
	}));
}
