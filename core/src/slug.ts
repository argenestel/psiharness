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

/** The first `max` UTF-16 units of `s`, never splitting a surrogate pair (an emoji is kept whole or dropped). */
export function clipText(s: string, max: number): string {
	if (s.length <= max) return s;
	const n = Math.max(0, max);
	const code = s.charCodeAt(n - 1);
	return s.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}
