import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentHub } from "./agent.ts";
import { apiError } from "./practice-api.ts";
import { listModels } from "./models.ts";

function text(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw apiError(400, `Expected non-empty ${name}`);
	return value.trim();
}

/** New graph/path/model routes, dispatched before the legacy path validator. */
export async function handleGraphRoute(req: IncomingMessage, res: ServerResponse, home: string,
	hub: AgentHub, bin?: string): Promise<boolean> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const path = url.pathname;
	if (!/^\/api\/(?:graph|paths|models)(?:\/|$)/.test(path)
		&& !/^\/api\/chat\/[^/]+\/model$/.test(path)) return false;
	const send = (value: unknown, status = 200) => {
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(value));
	};
	try {
		const method = req.method ?? "GET";
		if (method !== "GET" && req.headers["x-psi"] !== "1") throw apiError(403, "Expected X-Psi: 1");
		let body: Record<string, unknown> = {};
		if (["POST", "PUT", "DELETE"].includes(method)) {
			let raw = "";
			for await (const chunk of req) {
				raw += chunk.toString();
				if (Buffer.byteLength(raw) > 1_000_000) throw apiError(400, "JSON body too large");
			}
			if (raw) {
				try { body = JSON.parse(raw); } catch { throw apiError(400, "Invalid JSON"); }
				if (!body || typeof body !== "object" || Array.isArray(body)) throw apiError(400, "Expected JSON object");
			}
		}
		if (path === "/api/models" && method === "GET") { send(await listModels({ bin })); return true; }
		const switchChat = /^\/api\/chat\/([^/]+)\/model$/.exec(path);
		if (switchChat && method === "POST") {
			const model = text(body.model, "model");
			const list = await listModels({ bin });
			if (!list.models.some((m) => m.id === model) && !/^[^/\s]+\/[^/\s]+$/.test(model)) {
				throw apiError(400, "Model must be listed or use provider/id with exactly one slash");
			}
			await hub.setModel(decodeURIComponent(switchChat[1]), model);
			send({ ok: true, model }); return true;
		}
		// Keep model discovery usable while the independently owned knowledge module is being developed.
		const modulePath = "../../core/src/knowledge.ts";
		const { KnowledgeStore, neighborhood, pathTo } = await import(modulePath);
		const store = new KnowledgeStore(home);
		let result: unknown;
		if (path === "/api/graph" && method === "GET") result = store.build();
		else if (path.startsWith("/api/graph/neighborhood/") && method === "GET") {
			const raw = url.searchParams.get("depth");
			const depth = raw === null ? 1 : Number(raw);
			if (raw === "" || !Number.isSafeInteger(depth) || depth < 0) {
				throw apiError(400, "depth must be a non-negative integer");
			}
			const id = decodeURIComponent(path.slice("/api/graph/neighborhood/".length));
			result = neighborhood(store.build(), text(id, "node id"), depth);
		} else if (path === "/api/graph/links" && ["POST", "DELETE"].includes(method)) {
			const from = text(body.from, "from"), to = text(body.to, "to");
			result = method === "POST" ? store.addLink(from, to) : store.removeLink(from, to);
			if (result === undefined) result = { ok: true };
		} else if (path === "/api/paths" && method === "GET") result = store.listPaths();
		else {
			const match = /^\/api\/paths\/([^/]+)$/.exec(path);
			const id = match ? decodeURIComponent(match[1]) : undefined;
			if (id && ["GET", "PUT", "DELETE"].includes(method) && !store.readPath(id)) {
				throw apiError(404, "Path not found");
			}
			if (id && method === "GET") result = store.readPath(id);
			else if (id && method === "DELETE") { store.deletePath(id); result = { ok: true }; }
			else if ((path === "/api/paths" && method === "POST") || (id && method === "PUT")) {
				const title = text(body.title, "title"), goal = text(body.goal, "goal");
				let steps = body.steps;
				const targetId = body.targetId === undefined ? undefined : text(body.targetId, "targetId");
				if (steps === undefined && targetId) steps = pathTo(store.build(), targetId);
				if (!Array.isArray(steps) || steps.some((s) => typeof s !== "string" || !s.trim())) {
					throw apiError(400, "Expected steps array or targetId");
				}
				result = store.savePath({ ...(id ? { id } : {}), title, goal, steps, targetId, source: "learner" });
			}
		}
		if (result === undefined) throw apiError(404, "API route not found");
		send(result);
	} catch (error) {
		const failure = error as Error & { status?: number };
		send({ error: failure.message }, failure.status ?? 400);
	}
	return true;
}
