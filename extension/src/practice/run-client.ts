import { request } from "node:http";
import type { RunOptions, RunResult } from "./run-core.ts";

/** POST a run to the runner's Unix socket; rejects (never falls back to local execution) when it is unreachable. */
export function runRemote(socketPath: string, options: RunOptions, timeoutMs = 20000): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const body = JSON.stringify(options);
		const req = request({ socketPath, path: "/run", method: "POST",
			headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (c: Buffer) => chunks.push(c));
			res.on("end", () => {
				let data: { error?: string } & Partial<RunResult>;
				try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
				catch { reject(new Error("Code runner sent an unreadable reply.")); return; }
				if (res.statusCode !== 200 || data.error) reject(new Error(data.error ?? `Code runner failed (${res.statusCode}).`));
				else resolve(data as RunResult);
			});
		});
		req.setTimeout(timeoutMs, () => req.destroy(new Error("Code runner timed out.")));
		req.on("error", (error) => reject(new Error(`Code runner unavailable: ${error.message}`)));
		req.end(body);
	});
}
