import { spawn } from "node:child_process";

export interface WebModel { id: string; provider: string; name: string; context?: number; reasoning?: boolean }
export interface ModelList { default: string; models: WebModel[]; error?: string }
const cache = new Map<string, { at: number; result: Promise<WebModel[]> }>();
/** Clear cached host discovery (also useful after credentials change). */
export function resetModelCache(): void { cache.clear(); }
/** Parse pi's provider/model/context/max-out/thinking/images table. */
export function parseModels(output: string): WebModel[] {
	const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
	const start = lines.findIndex((line) => /^provider\s+model\s+context\s+max-out\s+thinking\s+images\s*$/.test(line.trim()));
	if (start < 0) return [];
	return lines.slice(start + 1).flatMap((line) => {
		const fields = line.trim().split(/\s+/);
		if (fields.length !== 6 || !/^(yes|no)$/.test(fields[4])) return [];
		const count = /^(\d+(?:\.\d+)?)([KM])?$/i.exec(fields[2]);
		return [{ id: `${fields[0]}/${fields[1]}`, provider: fields[0], name: fields[1],
			...(count ? { context: Number(count[1]) * (count[2]?.toUpperCase() === "M" ? 1e6
				: count[2]?.toUpperCase() === "K" ? 1e3 : 1) } : {}), reasoning: fields[4] === "yes" }];
	});
}
/** Discover host models with a ten-minute cache and an explicit default fallback. */
export async function listModels(opts: { bin?: string; now?: number } = {}): Promise<ModelList> {
	const bin = opts.bin ?? process.env.PSI_BIN ?? (process.env.PSI_HOST === "omp" ? "omp" : "pi");
	const selected = process.env.PSI_WEB_MODEL ?? "";
	const now = opts.now ?? Date.now();
	let entry = cache.get(bin);
	if (!entry || now - entry.at >= 600_000) {
		const result = new Promise<WebModel[]>((resolve, reject) => {
			const child = spawn(bin, ["--list-models"], { stdio: ["ignore", "pipe", "pipe"], shell: false });
			let output = "", errors = "";
			const timer = setTimeout(() => { child.kill(); reject(new Error("Model discovery timed out")); }, 15_000);
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				output += chunk;
				if (output.length > 4 * 1024 * 1024) { child.kill(); reject(new Error("Model list too large")); }
			});
			child.stderr.on("data", (chunk: string) => { errors = (errors + chunk).slice(-1000); });
			child.on("error", (error) => { clearTimeout(timer); reject(new Error(`Model discovery failed: ${error.message}`)); });
			child.on("close", (code) => {
				clearTimeout(timer);
				if (code !== 0) { reject(new Error(`Model discovery failed: ${errors || code}`)); return; }
				const models = parseModels(output);
				if (!models.length) reject(new Error("No models available from host"));
				else resolve(models);
			});
		});
		entry = { at: now, result }; cache.set(bin, entry);
	}
	try { return { default: selected, models: await entry.result }; }
	catch (error) {
		const slash = selected.indexOf("/");
		return { default: selected, models: selected ? [{ id: selected,
			provider: slash < 0 ? "" : selected.slice(0, slash), name: selected.slice(slash + 1) }] : [],
			error: (error as Error).message };
	}
}
