import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface RunOptions {
	language: "python" | "javascript" | "sql" | "bash";
	code: string;
	setup?: string;
	stdin?: string;
}

function result(details: unknown, text: string) {
	return { content: [{ type: "text" as const, text }], details };
}

const limit = 64 * 1024;
const sqlRunner = `import sys, sqlite3, json
connection = sqlite3.connect(":memory:")
connection.executescript(sys.argv[1])
pending = ""
for character in sys.argv[2] + "\\n;":
    pending += character
    if character == ";" and sqlite3.complete_statement(pending):
        cursor = connection.execute(pending)
        if cursor.description:
            print(json.dumps(cursor.fetchall()))
        pending = ""
`;

/** Run a bounded demo in a temporary directory with no inherited secrets. */
export async function runCode(options: RunOptions) {
	const started = Date.now();
	if (options.language === "bash" && process.env.PSI_CODE_EXEC_BASH !== "1") {
		throw new Error("Bash execution requires PSI_CODE_EXEC_BASH=1.");
	}
	const source = [options.setup, options.code].filter(Boolean).join("\n");
	let binary: string;
	let args: string[];
	switch (options.language) {
		case "python": binary = "python3"; args = ["-I", "-c", source]; break;
		case "javascript": binary = "node"; args = ["--input-type=module", "-e", source]; break;
		case "sql": binary = "python3"; args = ["-I", "-c", sqlRunner, options.setup ?? "", options.code]; break;
		case "bash": binary = "bash"; args = ["--noprofile", "--norc", "-c", source]; break;
		default: throw new Error("Unsupported language.");
	}
	const directory = await mkdtemp(join(tmpdir(), "psi-run-"));
	try {
		return await new Promise<{
			stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; truncated: boolean; ms: number;
		}>((resolve, reject) => {
			const child = spawn(binary, args, { cwd: directory, detached: true,
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: directory, LANG: "C.UTF-8" },
				stdio: ["pipe", "pipe", "pipe"] });
			const streams = [{ chunks: [] as Buffer[], size: 0, truncated: false },
				{ chunks: [] as Buffer[], size: 0, truncated: false }];
			let timedOut = false;
			const kill = () => {
				if (child.pid) {
					try { process.kill(-child.pid, "SIGKILL"); }
					catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL"); }
				}
			};
			const timer = setTimeout(() => { timedOut = true; kill(); }, 10000);
			const collect = async (stream: typeof child.stdout, index: number) => {
				const target = streams[index]!;
				for await (const data of stream) {
					const chunk = Buffer.from(data);
					const remaining = limit - target.size;
					if (chunk.length > remaining) target.truncated = true;
					if (remaining > 0) {
						const part = chunk.subarray(0, remaining);
						target.chunks.push(part); target.size += part.length;
					}
				}
			};
			const closed = new Promise<number | null>((done, fail) => {
				child.once("error", fail);
				child.once("close", done);
			});
			Promise.all([closed, collect(child.stdout, 0), collect(child.stderr, 1)]).then(([exitCode]) => {
				const output = streams.map((s) => Buffer.concat(s.chunks).toString("utf8")
					+ (s.truncated ? "\n[output truncated at 64 KB]" : ""));
				resolve({ stdout: output[0]!, stderr: output[1]!, exitCode, timedOut,
					truncated: streams.some((s) => s.truncated), ms: Date.now() - started });
			}, reject).finally(() => { clearTimeout(timer); kill(); });
			child.stdin.on("error", () => { /* A child may exit before consuming its input. */ });
			child.stdin.end(options.stdin ?? "");
		});
	} finally { await rm(directory, { recursive: true, force: true }); }
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
				const output = await runCode(p);
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
