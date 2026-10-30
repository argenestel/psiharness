import { spawn } from "node:child_process";
import { arity, option } from "../args.ts";
import type { ParsedArgs } from "../args.ts";

/** Resolve the bind address: --port/--host, then PSI_STUDIO_PORT/PSI_STUDIO_HOST, then 4173 on loopback (never HOST). */
export function studioAddress(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env): { port: number; host: string } {
	const portText = option(args, "port") ?? (env.PSI_STUDIO_PORT?.trim() || "4173");
	if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new Error("Port must be an integer from 0 to 65535");
	// The generic HOST variable is ignored on purpose: containers often export HOST=0.0.0.0.
	const host = option(args, "host") ?? (env.PSI_STUDIO_HOST?.trim() || "127.0.0.1");
	return { port: Number(portText), host };
}

/** Start the local studio, optionally opening its URL in the default browser. */
export async function studio(args: ParsedArgs): Promise<number> {
	arity(args, 0, 0, "studio [--port N] [--host H] [--open]");
	const { port, host } = studioAddress(args);
	const { PsiStore } = await import("../../../core/src/store.ts");
	const { startStudio } = await import("../../../studio/src/server.ts");
	const server = await startStudio({ port, host, store: new PsiStore() });
	console.log(`ψ studio: ${server.url}`);
	if (args.options.open) {
		const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
		if (opener) {
			const browser = spawn(opener, [server.url], { stdio: "ignore" });
			browser.on("error", (error) => console.error(`Could not open browser: ${error.message}`));
			browser.on("exit", (code) => {
				if (code) console.error(`Browser opener exited with status ${code}; open ${server.url} manually.`);
			});
		} else console.error(`Open ${server.url} in your browser.`);
	}
	return new Promise((resolveExit, reject) => {
		const close = () => {
			process.off("SIGINT", close);
			process.off("SIGTERM", close);
			Promise.resolve().then(() => server.close()).then(() => resolveExit(0), reject);
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
	});
}
