import type { IncomingMessage, ServerResponse } from "node:http";
import { ProfileStore } from "../../core/src/profile.ts";
import { SourceStore } from "../../core/src/sources.ts";
import { LessonStore } from "../../core/src/lessons.ts";
import { PracticeStore } from "../../core/src/practice.ts";
import type { GameProfile } from "../../core/src/types.ts";
import { apiError } from "./practice-api.ts";

/** Profile, ranked source and resolved lesson routes, before the legacy path validator. */
export async function handleLearnRoute(req: IncomingMessage, res: ServerResponse, home: string): Promise<boolean> {
	const pathname = (req.url ?? "/").split("?")[0];
	if (!/^\/api\/me(?:\/|$)/.test(pathname) &&
		!/^\/api\/skills\/[^/]+\/(?:sources|lessons)(?:\/|$)/.test(pathname)) return false;
	const send = (value: unknown, status = 200) => {
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(value));
	};
	try {
		const method = req.method ?? "GET";
		if (method !== "GET" && req.headers["x-psi"] !== "1") throw apiError(403, "Expected X-Psi: 1");
		const profile = new ProfileStore(home);
		if (pathname === "/api/me" && method === "GET") send(profile.summarize());
		else if (pathname === "/api/me/profile" && method === "PUT") {
			let raw = "";
			for await (const chunk of req) {
				raw += chunk.toString();
				if (Buffer.byteLength(raw) > 1_000_000) throw apiError(400, "JSON body too large");
			}
			let body;
			try { body = JSON.parse(raw); } catch { throw apiError(400, "Invalid JSON"); }
			if (!body || typeof body !== "object" || Array.isArray(body)) throw apiError(400, "Expected JSON object");
			const patch: Partial<Omit<GameProfile, "updatedAt">> = {};
			if (body.dailyGoal !== undefined) {
				const goal = body.dailyGoal;
				if (!goal || !["challenges", "minutes"].includes(goal.kind) ||
					!Number.isInteger(goal.target) || goal.target < 1 || goal.target > 100) {
					throw apiError(400, "dailyGoal requires challenges or minutes and an integer target from 1 to 100");
				}
				patch.dailyGoal = { kind: goal.kind, target: goal.target };
			}
			if (body.tutorMode !== undefined) {
				if (!["teach", "practice", "test"].includes(body.tutorMode)) throw apiError(400, "Invalid tutorMode");
				patch.tutorMode = body.tutorMode;
			}
			send({ profile: profile.update(patch), summary: profile.summarize() });
		} else {
			const p = pathname.split("/").slice(1).map((part) => decodeURIComponent(part));
			const skill = p[2];
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw apiError(400, "Invalid skill slug");
			if (!new PracticeStore(home).listSkills().includes(skill)) throw apiError(404, "Skill not found");
			const sources = new SourceStore(home), lessons = new LessonStore(home);
			if (method === "GET" && p.length === 4 && p[3] === "sources") send(sources.list(skill));
			else if (method === "GET" && p.length === 4 && p[3] === "lessons") {
				send(lessons.list(skill).map((lesson) => ({ id: lesson.subskillId, title: lesson.title })));
			} else if (method === "GET" && p.length === 5 && p[3] === "lessons") {
				if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p[4])) throw apiError(400, "Invalid subskill slug");
				const lesson = lessons.read(skill, p[4]);
				if (!lesson) throw apiError(404, `no lesson for subskill ${p[4]} in skill ${skill}`);
				send({ ...lesson, citations: lesson.citations.map((citation, index) => {
					const source = sources.get(skill, citation.sourceId);
					if (!source) return { n: index + 1, ...citation, sourceMissing: true };
					const { title, url, kind, rank, rankReasons } = source;
					return { n: index + 1, ...citation, title, url, kind, rank, rankReasons };
				}) });
			} else throw apiError(404, "API route not found");
		}
	} catch (error) {
		const failure = error as Error & { status?: number };
		send({ error: failure.message }, failure.status ?? 400);
	}
	return true;
}
