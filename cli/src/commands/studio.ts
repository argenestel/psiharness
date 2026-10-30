import { spawn } from "node:child_process";
import { arity, option } from "../args.ts";
import type { ParsedArgs } from "../args.ts";

/** Start the local studio, optionally opening its URL in the default browser. */
export async function studio(args: ParsedArgs): Promise<number> {
	arity(args, 0, 0, "studio [--port N] [--open]");
	const portText = option(args, "port") ?? "3210";
	if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new Error("Port must be an integer from 0 to 65535");
	const { PsiStore } = await import("../../../core/src/store.ts");
	const { startStudio } = await import("../../../studio/src/server.ts");
	const server = await startStudio({ port: Number(portText), host: "127.0.0.1", store: new PsiStore() });
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
