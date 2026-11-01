import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sourceId } from "../../../core/src/sources.ts";
import type { Source } from "../../../core/src/types.ts";
import { fetchPage } from "./web.ts";

export type PageFetcher = (url: string) => Promise<{ text: string; url: string }>;
export interface CachedPage { text: string; fetchedAt: string; url: string }
const MAX_BYTES = 2 * 1024 * 1024;

function cacheFile(home: string, skill: string, url: string): string {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw new Error("Invalid cache skill slug");
	const root = resolve(home);
	const parts = ["skills", skill, "source-cache", `${sourceId(url)}.txt`];
	let current = root;
	for (const part of parts) {
		current = join(current, part);
		try {
			if (lstatSync(current).isSymbolicLink()) throw new Error("Refusing source-cache symlink");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return current;
}

/** Read a cached page without its metadata header; missing files return undefined. */
export function readCachedPage(home: string, skill: string, url: string): CachedPage | undefined {
	try {
		const raw = readFileSync(cacheFile(home, skill, url), "utf8");
		const match = raw.match(/^# fetchedAt: ([^\n]+)\n# url: ([^\n]+)\n\n/);
		if (!match) return undefined;
		return { fetchedAt: match[1]!, url: match[2]!, text: raw.slice(match[0].length) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/** Atomically cache UTF-8 text, with the entire file bounded to 2 MiB. */
export function cachePage(home: string, skill: string, url: string, text: string): CachedPage {
	const file = cacheFile(home, skill, url);
	const fetchedAt = new Date().toISOString();
	const header = `# fetchedAt: ${fetchedAt}\n# url: ${new URL(url).href}\n\n`;
	const budget = MAX_BYTES - Buffer.byteLength(header);
	if (budget < 0) throw new Error("Cache URL exceeds 2 MB");
	const bytes = Buffer.from(text);
	let end = Math.min(budget, bytes.length);
	while (end < bytes.length && end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
	const bounded = bytes.subarray(0, end).toString("utf8");
	mkdirSync(join(file, ".."), { recursive: true });
	cacheFile(home, skill, url);
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, header + bounded, { flag: "wx" });
		renameSync(temporary, file);
	} finally { rmSync(temporary, { force: true }); }
	return { text: bounded, fetchedAt, url: new URL(url).href };
}

/** Reuse cached text or fetch once through the injectable, SSRF-safe page reader. */
export async function sourcePage(home: string, skill: string, url: string,
	fetcher: PageFetcher = (url) => fetchPage(url, { fullText: true })): Promise<CachedPage> {
	return readCachedPage(home, skill, url) ?? cachePage(home, skill, url, (await fetcher(url)).text);
}

/** Gather all cached references, fetching at most three missing sources in rank order. */
export async function gatherEvidence(home: string, skill: string, sources: Source[],
	fetcher?: PageFetcher): Promise<{ documents: { source: Source; text: string }[]; failures: string[] }> {
	const documents: { source: Source; text: string }[] = [], failures: string[] = [];
	let fetched = 0;
	for (const source of [...sources].sort((a, b) => b.rank - a.rank)) {
		let page = readCachedPage(home, skill, source.url);
		if (!page && fetched < 3) {
			fetched++;
			try { page = await sourcePage(home, skill, source.url, fetcher); }
			catch (error) { failures.push(`${source.id}: ${String(error)}`); }
		}
		const text = page?.text || source.excerpt;
		if (text) documents.push({ source, text });
	}
	return { documents, failures };
}
