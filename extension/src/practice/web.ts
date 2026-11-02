import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";

/** Whether an address is publicly routable (fetch targets must be); loopback only with PSI_FETCH_ALLOW_LOOPBACK=1. */
export function publicAddress(ip: string): boolean {
	if (ip.includes(":")) {
		if (ip === "::1") return process.env.PSI_FETCH_ALLOW_LOOPBACK === "1";
		// Only global unicast (2000::/3). Excluded inside it: 2001::/23 IETF special purpose (Teredo, ORCHID, …),
		// 2001:db8::/32 and 3fff::/20 documentation, 2002::/16 6to4. Other 2001: space is ordinary public IPv6.
		if (!/^[23]/i.test(ip) || /^(2002|3fff):/i.test(ip)) return false;
		const [first, second = ""] = ip.toLowerCase().split(":");
		if (first !== "2001") return true;
		const next = second === "" ? 0 : parseInt(second, 16);
		return next >= 0x200 && next !== 0xdb8;
	}
	const [a, b] = ip.split(".").map(Number);
	if (a === 127) return process.env.PSI_FETCH_ALLOW_LOOPBACK === "1";
	return !(a === 0 || a === 10 || a === 100 && b! >= 64 && b! <= 127 || a === 169 && b === 254
		|| a === 172 && b! >= 16 && b! <= 31 || a === 192 && [0, 168].includes(b!)
		|| a === 198 && [18, 19, 51].includes(b!) || a === 203 && b === 0 || a! >= 224);
}

/** Identifies psi with a contact URL, as Wikimedia's and other public APIs' bot policies ask. */
export const USER_AGENT = "psi-harness/1.0 (https://github.com/argenestel/psiharness; learning tutor source research)";

/** safeHttp options: extra request headers, and one host the user configured (a LAN SearXNG) exempt from the IP check. */
export interface HttpOptions { headers?: Record<string, string>; trustHost?: string }

/** Bounded HTTP with DNS pinning. PSI_FETCH_ALLOW_LOOPBACK=1 permits loopback only, for local tests. */
export async function safeHttp(input: string, options: HttpOptions = {}): Promise<{ body: string; url: string; contentType: string }> {
	const deadline = Date.now() + 10000;
	for (let hop = 0; hop <= 3; hop++) {
		const url = new URL(input);
		if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https URLs are allowed");
		if (url.username || url.password) throw new Error("URL credentials are refused");
		const host = url.hostname.replace(/^\[|\]$/g, "");
		const trusted = !!options.trustHost && host === options.trustHost;
		if (url.port && !trusted && !["80", "443", "8080"].includes(url.port)) throw new Error("Non-standard port refused");
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("Fetch timeout");
		let timer: ReturnType<typeof setTimeout> | undefined;
		const addresses = await Promise.race([
			isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : dns.lookup(host, { all: true }),
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), remaining); }),
		]).finally(() => clearTimeout(timer));
		if (!addresses.length || (!trusted && addresses.some((a) => !publicAddress(a.address)))) {
			throw new Error("Non-public IP refused");
		}
		const response = await new Promise<{ body: string; status: number; location?: string; contentType: string }>((resolve, reject) => {
			const request = (url.protocol === "https:" ? https : http).get(url, {
				family: addresses[0]!.family,
				headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "identity",
					...options.headers },
				lookup: (_host, _options, callback) => callback(null, addresses[0]!.address, addresses[0]!.family),
			}, (res) => {
				const chunks: Buffer[] = []; let size = 0;
				res.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > 2 * 1024 * 1024) request.destroy(new Error("Response exceeds 2 MB"));
					else chunks.push(chunk);
				});
				res.on("error", reject);
				res.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), status: res.statusCode ?? 0,
					location: res.headers.location, contentType: res.headers["content-type"] ?? "" }));
			});
			const timeout = setTimeout(() => request.destroy(new Error("Fetch timeout")), Math.max(1, deadline - Date.now()));
			request.on("close", () => clearTimeout(timeout));
			request.on("error", reject);
		});
		if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
			input = new URL(response.location, url).href; continue;
		}
		if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
		return { ...response, url: url.href };
	}
	throw new Error("Redirect limit exceeded (3)");
}

/** Decode common named and numeric HTML entities. */
export function decodeEntities(text: string): string {
	const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
		ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", copy: "©" };
	return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, key: string) => {
		if (!key.startsWith("#")) return named[key.toLowerCase()] ?? whole;
		const n = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
		return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
	});
}

/** Extract readable HTML while discarding executable and peripheral content. */
export function htmlText(html: string): { title: string; text: string } {
	const title = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.replace(/<[^>]*>/g, "") ?? "");
	const text = html.replace(/<(script|style|nav|footer|noscript|template|svg|iframe|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<h([1-6])\b[^>]*>/gi, (_m, n) => "\n" + "#".repeat(Number(n)) + " ")
		.replace(/<\/?(?:p|div|br|li|section|article|h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, "");
	return { title, text: decodeEntities(text).replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim() };
}

/** Read reference text; the internal fullText option preserves pages for caching and quote checks. */
export async function fetchPage(url: string, options: { fullText?: boolean; http?: typeof safeHttp } = {}) {
	const response = await (options.http ?? safeHttp)(url);
	const type = response.contentType.split(";")[0]!.trim().toLowerCase();
	if (!["text/html", "application/xhtml+xml", "text/plain", "text/markdown"].includes(type)) {
		throw new Error(`Unsupported content type: ${type}`);
	}
	const page = type.includes("html") ? htmlText(response.body) : { title: response.url, text: response.body };
	return { ...page, url: response.url, text: options.fullText ? page.text : page.text.slice(0, 20000), truncated: page.text.length > 20000 };
}
