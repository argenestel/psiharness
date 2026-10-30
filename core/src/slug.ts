import { randomInt } from "node:crypto";

/** Convert text to an ASCII kebab-case slug of at most 64 characters. */
export function slugify(s: string): string {
	return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
		.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
}

/** Format a date as an ISO timestamp. */
export function nowIso(date: Date = new Date()): string {
	return date.toISOString();
}

/** Generate an identifier with eight uniformly random base36 characters. */
export function newId(prefix: string): string {
	return `${prefix}-${Array.from({ length: 8 }, () => randomInt(36).toString(36)).join("")}`;
}
