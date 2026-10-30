import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { option } from "./args.ts";
import type { ParsedArgs } from "./args.ts";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ompInstallHint = "bun install -g @oh-my-pi/pi-coding-agent or curl -fsSL https://omp.sh/install | sh";

/** Options for building host arguments without launching a process. */
export interface HostOptions {
	repo?: string;
	topic?: string;
	model?: string;
	thinking?: string;
	message?: string;
	print?: boolean;
	passthrough?: string[];
}

/** Construct the host argv, with psi resources and tutor mode enabled. */
export function buildHostArgs(opts: HostOptions = {}): string[] {
	const root = opts.repo ?? repoRoot;
	const args = ["-e", join(root, "extension/src/index.ts"), "--skill", join(root, "skills"),
		"--prompt-template", join(root, "prompts"), "--psi-tutor"];
	if (opts.topic) args.push("--psi-topic", opts.topic);
	if (opts.model) args.push("--model", opts.model);
	if (opts.thinking) args.push("--thinking", opts.thinking);
	if (opts.print) args.push("-p");
	args.push(...(opts.passthrough ?? []));
	if (opts.message) {
		if (!opts.passthrough?.includes("--")) args.push("--");
		args.push(opts.message);
	}
	return args;
}

/** Resolve the host and binary, honoring explicit host selection and environment overrides. */
export function hostConfig(args: ParsedArgs): { host: "pi" | "omp"; bin: string } {
	const host = option(args, "host") ?? process.env.PSI_HOST ?? "pi";
	if (host !== "pi" && host !== "omp") throw new Error("--host / PSI_HOST must be pi or omp");
	const bin = process.env.PSI_BIN || host;
	return { host, bin: /[/\\]/.test(bin) ? resolve(bin) : bin };
}

/** Launch the host with inherited terminal streams in the learner workspace. */
export async function launchHost(args: ParsedArgs, message?: string, print = false): Promise<number> {
	const { host, bin } = hostConfig(args);
	if (host === "omp") {
		const check = spawnSync(bin, ["--help"], { stdio: "ignore", timeout: 15_000 });
		if (check.error || check.status !== 0) throw new Error(`Cannot run ${bin} --help. Install omp: ${ompInstallHint}`);
	}
	const home = resolve(process.env.PSI_HOME ?? join(homedir(), ".psi"));
	const workspace = join(home, "workspace");
	mkdirSync(workspace, { recursive: true });
	return new Promise((resolveExit, reject) => {
		const child = spawn(bin, buildHostArgs({
			topic: option(args, "topic") ?? option(args, "psi-topic"),
			model: option(args, "model"), thinking: option(args, "thinking"),
			message, print, passthrough: args.passthrough,
		}), { cwd: workspace, stdio: "inherit", env: { ...process.env, PSI_HOME: home } });
		const interrupt = () => { child.kill("SIGINT"); };
		const terminate = () => { child.kill("SIGTERM"); };
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		const cleanup = () => {
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
		};
		child.once("error", (error) => {
			cleanup();
			reject(new Error(`Cannot launch ${bin}: ${error.message}. Install the ${host} coding agent.`));
		});
		child.once("exit", (code, signal) => {
			cleanup();
			resolveExit(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1));
		});
	});
}
