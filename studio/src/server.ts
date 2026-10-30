import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { isIP } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Card, ConceptGraph, LearnerProfile, LessonPlan, Rating } from "../../core/src/types.ts";

/** The documented storage surface consumed by Studio. */
export interface StudioStore {
	root: string;
	listTopics(): string[];
	topicDir(topic: string): string;
	readGraph(topic: string): ConceptGraph | undefined;
	readPlan(topic: string): LessonPlan | undefined;
	readLearner(topic: string): LearnerProfile | undefined;
	dueCards(topic?: string): Card[];
	readCards(topic: string): Card[];
	review(topic: string, cardId: string, rating: Rating): Card;
	artifactsDir(topic: string): string;
	listArtifacts(topic: string): string[];
}

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
// A variable import keeps Studio importable while core is being developed independently.
const coreModule = "../../core/src/index.ts";
const mime: Record<string, string> = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm",
	".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf", ".ico": "image/x-icon",
};

class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) { super(message); this.status = status; }
}

function partsOf(raw: string): string[] {
	const pathname = raw.split("?")[0];
	if (!pathname.startsWith("/") || pathname.startsWith("//") || /%2f|%5c/i.test(pathname)) {
		throw new HttpError(400, "Invalid path");
	}
	return pathname.split("/").filter(Boolean).map((segment) => {
		let value: string;
		try { value = decodeURIComponent(segment); } catch { throw new HttpError(400, "Invalid encoding"); }
		if (value.includes("..") || /[\\/\x00-\x1f:]/.test(value) || /%[0-9a-f]{2}/i.test(value)
			|| isAbsolute(value) || value === ".") throw new HttpError(400, "Invalid path");
		return value;
	});
}

function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function safeFile(root: string, segments: string[]): string {
	try {
		const base = realpathSync(root);
		const target = realpathSync(resolve(base, ...segments));
		if (!inside(base, target) || !statSync(target).isFile()) throw new HttpError(404, "File not found");
		return target;
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(404, "File not found");
	}
}

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** Hostname from a Host header, without port or IPv6 brackets; undefined when malformed. */
function hostName(header: string | undefined): string | undefined {
	const match = /^(?:\[([0-9a-f:.]+)\]|([^:\[\]]+))(?::\d{1,5})?$/i.exec(header?.trim() ?? "");
	return match ? (match[1] ?? match[2])!.toLowerCase().replace(/\.$/, "") : undefined;
}

/**
 * DNS-rebinding guard: a hostile page can point its own domain at 127.0.0.1 and then read the API
 * same-origin. Only IP literals, localhost names, the bind host and PSI_STUDIO_ALLOWED_HOSTS are accepted.
 */
export function allowedHost(
	header: string | undefined, bindHost: string, extra = process.env.PSI_STUDIO_ALLOWED_HOSTS,
): boolean {
	const name = hostName(header);
	if (!name) return false;
	if (LOOPBACK_NAMES.has(name) || name.endsWith(".localhost") || isIP(name)) return true;
	const allowed = new Set([bindHost.toLowerCase().replace(/^\[|\]$/g, ""),
		...(extra ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)]);
	return allowed.has(name);
}

function json(res: ServerResponse, data: unknown, status = 200): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(data));
}

async function ratingBody(req: IncomingMessage): Promise<Rating> {
	if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
		throw new HttpError(415, "Expected application/json");
	}
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 16384) throw new HttpError(413, "Body too large");
		chunks.push(Buffer.from(chunk));
	}
	let body;
	try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
	catch { throw new HttpError(400, "Invalid JSON"); }
	if (!body || ![1, 2, 3, 4].includes(body.rating)) throw new HttpError(400, "Rating must be 1–4");
	return body.rating;
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, artifact: boolean): void {
	const size = statSync(file).size;
	res.setHeader("Content-Type", mime[extname(file).toLowerCase()] ?? "application/octet-stream");
	res.setHeader("Accept-Ranges", "bytes");
	if (artifact) {
		// Explorables compile mathematical expressions. The opaque sandbox origin and
		// default-src restriction keep their scripts isolated from Studio and its API.
		res.setHeader("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; "
			+ "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
			+ "style-src 'unsafe-inline' https://cdn.jsdelivr.net; "
			+ "font-src https://cdn.jsdelivr.net data:; img-src 'self' data: blob:; media-src 'self' blob:");
	}
	let start = 0;
	let end = size - 1;
	// RFC 9110 §14.2: unknown units, malformed or multi-range specs, and conditional If-Range requests
	// (Studio emits no validators) are ignored and answered with the full file; only a well-formed
	// single range that cannot be satisfied yields 416.
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range?.trim() ?? "");
	if (range && (range[1] || range[2]) && !req.headers["if-range"]
		&& !(range[1] && range[2] && Number(range[2]) < Number(range[1]))) {
		if (!range[1]) start = Math.max(0, size - Number(range[2]));
		else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
			res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return;
		}
		res.statusCode = 206;
		res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
	}
	res.setHeader("Content-Length", Math.max(0, end - start + 1));
	if (req.method === "HEAD" || size === 0) { res.end(); return; }
	const stream = createReadStream(file, { start, end });
	stream.on("error", () => res.destroy());
	res.on("close", () => stream.destroy());
	stream.pipe(res);
}

/** A running Studio; `clients()` reports open live-update streams. */
export interface StudioHandle { url: string; clients(): number; close(): Promise<void> }

/** Start the local Studio HTTP app; port 0 requests an available port. */
export async function startStudio({
	port = Number(process.env.PSI_STUDIO_PORT) || 4173,
	// Deliberately not the generic HOST variable: shells and containers often export it, which would
	// silently expose learner data on the network. Opt in with PSI_STUDIO_HOST (e.g. docker compose).
	host = process.env.PSI_STUDIO_HOST || "127.0.0.1",
	store,
}: { port?: number; host?: string; store: StudioStore }): Promise<StudioHandle> {
	const core = await import(coreModule).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND") return undefined;
		throw error;
	});
	const clients = new Set<ServerResponse>();
	const watchers: FSWatcher[] = [];
	let debounce: ReturnType<typeof setTimeout> | undefined;
	const changed = () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => { for (const client of clients) client.write("event: changed\ndata: {}\n\n"); }, 120);
	};
	const server = createServer(async (req, res) => {
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader("X-Frame-Options", "SAMEORIGIN");
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; "
			+ "img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
		try {
			if (!allowedHost(req.headers.host, host)) throw new HttpError(421, "Unrecognized Host header");
			const p = partsOf(req.url ?? "/");
			if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
				throw new HttpError(405, "Method not allowed");
			}
			if (p[0] === "api") {
				if (req.method === "GET" && p.length === 2 && p[1] === "events") {
					res.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive",
						"X-Accel-Buffering": "no" });
					res.write(": connected\n\n"); clients.add(res);
					// The response closes on client disconnect and on server shutdown alike.
					res.on("close", () => clients.delete(res)); return;
				}
				if (p[1] !== "topics") throw new HttpError(404, "API route not found");
				if (p.length === 2 && req.method === "GET") {
					json(res, store.listTopics().map((topic) => {
						const graph = store.readGraph(topic);
						const mastery = store.readLearner(topic)?.mastery ?? {};
						return { topic, title: graph?.title ?? topic, bigIdea: graph?.bigIdea ?? "",
							concepts: graph?.concepts.length ?? 0,
							mastered: graph?.concepts.filter((c) => (mastery[c.id]?.pKnown ?? 0) >= 0.95).length ?? 0,
							due: store.dueCards(topic).length, artifacts: store.listArtifacts(topic).length };
					})); return;
				}
				const topic = p[2];
				if (!topic || !store.listTopics().includes(topic)) throw new HttpError(404, "Topic not found");
				if (req.method === "GET") {
					if (p.length === 3) {
						const graph = store.readGraph(topic);
						const learner = store.readLearner(topic);
						const mastered = new Set(Object.values(learner?.mastery ?? {})
							.filter((m) => m.pKnown >= 0.95).map((m) => m.conceptId));
						const available = graph ? (core?.frontier ? core.frontier(graph, mastered)
							: graph.concepts.filter((c) => !mastered.has(c.id)
								&& c.prerequisites.every((id) => mastered.has(id)))) : [];
						json(res, { graph: graph ?? null, plan: store.readPlan(topic) ?? null,
							learner: learner ?? null, frontier: available }); return;
					}
					if (p.length === 5 && p[3] === "cards" && p[4] === "due") {
						json(res, store.dueCards(topic)); return;
					}
					if (p.length === 4 && p[3] === "artifacts") {
						json(res, store.listArtifacts(topic).map((file) => {
							const name = basename(file);
							return { name, url: `/artifacts/${encodeURIComponent(topic)}/${encodeURIComponent(name)}`,
								type: mime[extname(name).toLowerCase()] ?? "application/octet-stream" };
						})); return;
					}
					if (p.length === 4 && p[3] === "reviews") {
						let raw = "";
						try { raw = readFileSync(safeFile(store.topicDir(topic), ["reviews.jsonl"]), "utf8"); }
						catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
						const reviews = raw.split("\n").filter(Boolean).flatMap((line) => {
							try {
								const item = JSON.parse(line);
								return item && typeof item.reviewedAt === "string" ? [item] : [];
							} catch { return []; } // Ignore an incomplete last line during a concurrent write.
						});
						json(res, reviews); return;
					}
				}
				if (req.method === "POST" && p.length === 6 && p[3] === "cards" && p[5] === "review") {
					if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
						throw new HttpError(403, "Cross-origin review rejected");
					}
					const rating = await ratingBody(req);
					if (!store.readCards(topic).some((card) => card.id === p[4])) throw new HttpError(404, "Card not found");
					json(res, store.review(topic, p[4], rating)); changed(); return;
				}
				throw new HttpError(404, "API route not found");
			}
			if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
			if (p[0] === "artifacts") {
				if (p.length !== 3 || !store.listTopics().includes(p[1])) throw new HttpError(404, "Artifact not found");
				serveFile(req, res, safeFile(store.artifactsDir(p[1]), [p[2]]), true); return;
			}
			serveFile(req, res, safeFile(publicDir, p.length ? p : ["index.html"]), false);
		} catch (error) {
			if (!res.headersSent) json(res, { error: error instanceof HttpError ? error.message : "Internal server error" },
				error instanceof HttpError ? error.status : 500);
			else res.end();
		}
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => { server.off("error", reject); resolveListen(); });
	});
	const topicsDir = join(store.root, "topics");
	try {
		mkdirSync(topicsDir, { recursive: true });
		watchers.push(watch(topicsDir, { recursive: true }, changed));
	} catch {
		// Older platforms may lack recursive watching: subscribe to every existing directory.
		const seen = new Set<string>();
		const scan = (dir: string) => {
			if (seen.has(dir)) return;
			try {
				seen.add(dir);
				const watcher = watch(dir, () => { changed(); scanChildren(dir); });
				watcher.on("error", () => {});
				watchers.push(watcher);
				scanChildren(dir);
			} catch { /* Read-only or removed directories do not prevent serving. */ }
		};
		const scanChildren = (dir: string) => {
			try {
				for (const ent of readdirSync(dir, { withFileTypes: true })) if (ent.isDirectory()) scan(join(dir, ent.name));
			} catch { /* A concurrent writer may remove the directory. */ }
		};
		scan(topicsDir);
	}
	for (const watcher of watchers) watcher.on("error", () => {});
	const heartbeat = setInterval(() => { for (const client of clients) client.write(": heartbeat\n\n"); }, 25000);
	heartbeat.unref();
	const address = server.address();
	const actualPort = address && typeof address !== "string" ? address.port : port;
	const url = `http://${host.includes(":") ? `[${host}]` : host}:${actualPort}`;
	let closing: Promise<void> | undefined;
	return { url, clients: () => clients.size, close() {
		return closing ??= new Promise<void>((resolveClose, reject) => {
			clearTimeout(debounce); clearInterval(heartbeat);
			for (const watcher of watchers) watcher.close();
			for (const client of clients) client.end();
			clients.clear();
			server.close((error) => error ? reject(error) : resolveClose());
			server.closeIdleConnections();
		});
	} };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		const { PsiStore } = await import(coreModule);
		const studio = await startStudio({ store: new PsiStore() });
		console.log(`ψ Studio: ${studio.url}`);
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			process.once(signal, () => { void studio.close(); });
		}
	} catch (error) {
		console.error("Unable to start ψ Studio:", error);
		process.exitCode = 1;
	}
}
