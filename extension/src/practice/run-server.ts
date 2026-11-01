import { createServer } from "node:http";
import type { Server } from "node:http";
import { chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCode } from "./run-core.ts";
import type { RunOptions } from "./run-core.ts";

const LANGUAGES = new Set(["python", "javascript", "sql", "bash"]);
const MAX_BODY = 512 * 1024;
/** Simultaneous runs; more wait for a slot rather than piling processes onto the container's pid limit. */
const SLOTS = 4;

/** Validate a decoded request body into RunOptions, or return an error message. */
export function parseRun(value: unknown): RunOptions | string {
	if (!value || typeof value !== "object") return "Expected a JSON object.";
	const v = value as Record<string, unknown>;
	if (typeof v.language !== "string" || !LANGUAGES.has(v.language)) return "Unsupported language.";
	if (typeof v.code !== "string") return "code must be a string.";
	for (const key of ["setup", "stdin"]) if (v[key] !== undefined && typeof v[key] !== "string") return `${key} must be a string.`;
	return { language: v.language as RunOptions["language"], code: v.code,
		...(v.setup !== undefined ? { setup: v.setup as string } : {}), ...(v.stdin !== undefined ? { stdin: v.stdin as string } : {}) };
}

/** Serve POST /run on a Unix socket (mode 0600). The runner container has no network, volumes or secrets. */
export function serveRuns(socketPath: string): Promise<Server> {
	let active = 0;
	const waiting: (() => void)[] = [];
	const slot = async () => {
		if (active >= SLOTS) await new Promise<void>((r) => waiting.push(r));
		active++;
	};
	const release = () => { active--; waiting.shift()?.(); };
	const server = createServer((req, res) => {
		const reply = (status: number, body: unknown) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.method === "GET" && req.url === "/health") return reply(200, { ok: true });
		if (req.method !== "POST" || req.url !== "/run") return reply(404, { error: "Not found." });
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > MAX_BODY) { reply(413, { error: "Request too large." }); req.destroy(); return; }
			chunks.push(c);
		});
		req.on("end", async () => {
			if (size > MAX_BODY) return;
			let parsed: RunOptions | string;
			try { parsed = parseRun(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
			catch { parsed = "Invalid JSON."; }
			if (typeof parsed === "string") return reply(400, { error: parsed });
			await slot();
			try { reply(200, await runCode(parsed)); }
			catch (error) { reply(400, { error: error instanceof Error ? error.message : String(error) }); }
			finally { release(); }
		});
	});
	rmSync(socketPath, { force: true });
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => { chmodSync(socketPath, 0o600); resolve(server); });
	});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const socketPath = process.argv[2] ?? "/run/psi-run/run.sock";
	const server = await serveRuns(socketPath);
	process.stderr.write(`psi runner: listening on ${socketPath}\n`);
	const stop = () => server.close(() => process.exit(0));
	process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
