import test from "node:test";
import assert from "node:assert/strict";
import {
	catalogSubject, chooseProviders, diversify, initials, keywords, relevance, searchGitHub, searchSources, splitGoal, stem,
	wikipediaExact,
} from "../src/practice/search.ts";
import type { Http } from "../src/practice/search.ts";

/** Fake provider APIs keyed by host, so search is tested offline and deterministically. */
function fakeHttp(responses: Record<string, unknown>, calls: string[] = []): Http {
	return async (url, options) => {
		calls.push(url + (options?.headers?.["X-Subscription-Token"] ? ` [key ${options.headers["X-Subscription-Token"]}]` : "")
			+ (options?.trustHost ? ` [trust ${options.trustHost}]` : ""));
		const host = new URL(url).host;
		const key = Object.keys(responses).find((k) => url.includes(k)) ?? host;
		if (!(key in responses)) throw new Error(`HTTP 404 (${host})`);
		const body = responses[key];
		return { url, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) };
	};
}
const wiki = (titles: [string, string][]) => ({ query: { search: titles.map(([title, snippet]) => ({ title, snippet })) } });

test("keywords drop filler, keep technical tokens and accented words", () => {
	assert.deepEqual(keywords("build and train a tiny GPT-style text generator in PyTorch from scratch"),
		["gpt", "text", "generator", "pytorch"]);
	assert.deepEqual(keywords("C++ templates"), ["c++", "templates"]);
	assert.deepEqual(keywords("French past tense passé composé"), ["french", "past", "tense", "passé", "composé"]);
	assert.equal(stem("joins"), stem("join")); assert.equal(stem("merging"), stem("merge"));
	assert.equal(stem("derivatives"), stem("derivative")); assert.equal(stem("theories"), "theory");
	assert.equal(stem("merged"), stem("merge")); assert.equal(stem("boxes"), stem("box")); assert.equal(stem("class"), "class");
});

test("a goal splits into topic and purpose; purpose words count less", () => {
	assert.deepEqual(splitGoal("SQL joins for data analysis"), { topic: "SQL joins", purpose: "data analysis" });
	assert.deepEqual(splitGoal("for loops in Python"), { topic: "for loops in Python", purpose: "" });
	const joins = relevance("SQL joins for data analysis", { title: "Join (SQL)", url: "https://en.wikipedia.org/wiki/Join_(SQL)" });
	const azure = relevance("SQL joins for data analysis",
		{ title: "Why is Azure Analysis Services slower than SQL", url: "https://stackoverflow.com/q/1" });
	assert.ok(joins > azure, `${joins} > ${azure}`);
});

test("relevance prefers concise exact titles and discounts a bare language name", () => {
	const q = "Big-O notation and algorithm complexity";
	const article = relevance(q, { title: "Big O notation", url: "https://en.wikipedia.org/wiki/Big_O_notation" });
	const nothing = relevance(q, { title: "Knitting patterns", url: "https://example.org/knit" });
	assert.ok(article > 0.3); assert.equal(nothing, 0);
	const recursion = relevance("recursion in Python", { title: "Recursion", url: "https://en.wikipedia.org/wiki/Recursion" });
	const tutorial = relevance("recursion in Python", { title: "The Python Tutorial", url: "https://docs.python.org/3/tutorial/" });
	assert.ok(recursion > tutorial, `${recursion} > ${tutorial}`);
	// Curated entries match through their covers tags.
	assert.ok(relevance("tiny GPT text generator", { title: "nanoGPT", url: "https://github.com/karpathy/nanoGPT",
		covers: "gpt transformer text generator" }) > 0.9);
});

test("subject inference picks the most specific subject", () => {
	assert.equal(catalogSubject("build a tiny GPT"), "machine-learning");
	assert.equal(catalogSubject("regular expressions in Python"), "regex");
	assert.equal(catalogSubject("SQL joins"), "sql");
	assert.equal(catalogSubject("eigenvalues and eigenvectors"), "linear-algebra");
	assert.equal(catalogSubject("anything", "python"), "python");
	assert.equal(catalogSubject("knitting"), "general");
});

test("providers fit the goal: MDN for web, Stack Overflow for code, GitHub for builds, arXiv only for research", () => {
	const names = (goal: string, env: Record<string, string> = {}) =>
		chooseProviders(goal, catalogSubject(goal), env, fakeHttp({})).map(([n]) => n);
	assert.deepEqual(names("photosynthesis light reactions"), ["Wikipedia", "Wikibooks"]);
	assert.deepEqual(names("async await in JavaScript"), ["Wikipedia", "Wikibooks", "MDN", "Stack Overflow"]);
	assert.deepEqual(names("build a tiny GPT in PyTorch"), ["Wikipedia", "Wikibooks", "Stack Overflow", "GitHub"]);
	assert.ok(names("transformer research papers").includes("arXiv"));
	assert.ok(!names("build a tiny GPT in PyTorch").includes("arXiv"));
	assert.equal(names("x", { BRAVE_API_KEY: "k" })[0], "Brave Search");
	assert.equal(names("x", { PSI_SEARXNG_URL: "http://10.0.0.2:8080" })[0], "SearXNG");
});

test("exact titles: the whole topic and real multi-word concepts, never disambiguation or off-topic redirects", async () => {
	const calls: string[] = [];
	const http = fakeHttp({ "en.wikipedia.org/w/api.php": { query: {
		redirects: [{ from: "Light reaction", to: "Photochemistry" }],
		pages: [
			{ title: "Immune system", description: "Biological system protecting an organism" },
			{ title: "Vaccine", pageprops: { disambiguation: "" } },
			{ title: "Photochemistry" },
			{ title: "Nonexistent", missing: true },
		] } } }, calls);
	const items = await wikipediaExact("how vaccines train the immune system", http);
	assert.deepEqual(items.map((i) => [i.title, i.exact]), [["Immune system", "concept"]]);
	assert.ok(new URL(calls[0]!).searchParams.get("titles")!.split("|").includes("immune system"));
	const light = await wikipediaExact("light reaction", fakeHttp({ "en.wikipedia.org/w/api.php": { query: {
		redirects: [{ from: "Light reaction", to: "Photochemistry" }], normalized: [{ from: "light reaction", to: "Light reaction" }],
		pages: [{ title: "Photochemistry" }] } } }));
	assert.deepEqual(light.map((i) => i.exact), ["topic"], "a redirect from the whole topic is still the topic's article");
});

test("search ranks on-topic sources first, drops off-topic ones, mixes providers and reports each provider", async () => {
	const calls: string[] = [];
	const http = fakeHttp({
		"titles=": { query: { pages: [{ title: "Newton's laws of motion", description: "Laws in classical mechanics" }] } },
		"en.wikipedia.org/w/api.php": wiki([["Isaac Newton", "English physicist"], ["Knitting", "craft"]]),
		"en.wikibooks.org": wiki([["Physics/Newton's Laws of Motion", "laws"], ["A/Newton's Laws of Motion", ""],
			["B/Newton's Laws of Motion", ""], ["C/Newton's Laws of Motion", ""]]),
	}, calls);
	const r = await searchSources("Newton's laws of motion", undefined, { http, env: {} });
	assert.equal(r.subject, "physics");
	assert.equal(r.items[0]!.title, "Newton's laws of motion", "the article titled exactly as the topic leads");
	const isaac = r.items.findIndex((i) => i.title === "Isaac Newton");
	assert.ok(isaac === -1 || isaac > r.items.findIndex((i) => i.title === "Newton's laws of motion"));
	assert.ok(!r.items.some((i) => i.title === "Knitting"), "off-topic dropped");
	// Only one non-Wikibooks source is on-topic here, so Wikibooks may fill the rest (the cap needs alternatives).
	assert.deepEqual(r.providers.answered, ["Wikipedia (3)", "Wikibooks (4)"]);
	assert.match(r.note, /General web search is not configured/);
	assert.ok(calls.every((c) => !c.includes("duckduckgo")));
});

test("configured web search: Brave sends its key, SearXNG may be a trusted LAN host, providers search the topic only", async () => {
	const calls: string[] = [];
	const http = fakeHttp({
		"api.search.brave.com": { web: { results: [{ title: "PyTorch tutorials", url: "https://docs.pytorch.org/tutorials/" },
			{ title: "bad", url: "javascript:alert(1)" }] } },
		"192.168.1.5": { results: [{ title: "SQL joins explained", url: "https://example.org/joins" }] },
		"wikipedia.org": wiki([]), "wikibooks.org": wiki([]), "stackexchange.com": { items: [] }, "github.com": { items: [] },
	}, calls);
	const brave = await searchSources("pytorch tutorials", "machine-learning", { http, env: { BRAVE_API_KEY: "k" } });
	assert.ok(calls.some((c) => c.includes("api.search.brave.com") && c.endsWith("[key k]")));
	assert.ok(!brave.items.some((i) => i.url.startsWith("javascript:")));
	const searx = await searchSources("SQL joins for data analysis", undefined, { http, env: { PSI_SEARXNG_URL: "http://192.168.1.5:8888" } });
	assert.ok(calls.some((c) => c.startsWith("http://192.168.1.5:8888/search?q=SQL+joins+for+data+analysis") && c.endsWith("[trust 192.168.1.5]")));
	assert.ok(calls.some((c) => c.includes("en.wikipedia.org") && /srsearch=sql\+joins&/.test(c)), "providers search the topic");
	assert.ok(searx.items.some((i) => i.url === "https://example.org/joins"));
	// A curated, authoritative joins page outranks an unknown site with the same match.
	assert.equal(searx.items[0]!.url, "https://www.postgresql.org/docs/current/tutorial-join.html");
});

test("a rate-limited provider is retried once; a failing one is reported, not hidden", async () => {
	let wikiCalls = 0;
	const http: Http = async (url) => {
		if (url.includes("wikipedia.org")) {
			wikiCalls++;
			if (wikiCalls === 1) throw new Error("HTTP 429");
			return { url, contentType: "application/json", body: JSON.stringify(url.includes("titles=") ? { query: { pages: [] } }
				: wiki([["Photosynthesis", "process"]])) };
		}
		throw new Error("HTTP 503");
	};
	const r = await searchSources("photosynthesis", undefined, { http, env: {}, pauseMs: 0 });
	assert.ok(r.providers.answered.some((a) => a.startsWith("Wikipedia")));
	assert.deepEqual(r.providers.failed, ["Wikibooks: HTTP 503"]);
	assert.match(r.note, /Failed: Wikibooks: HTTP 503/);
});

test("diversify caps one provider within the head window", () => {
	const ranked = ["a", "a", "a", "b", "a", "c"].map((provider, i) => ({ provider, i }));
	assert.deepEqual(diversify(ranked, 2, 5).map((x) => x.i), [0, 1, 3, 5, 2, 4]);
});

test("joined-up names and acronyms match: minGPT is about GPT; GPT is Generative pre-trained transformer", () => {
	assert.equal(initials("Generative pre-trained transformer"), "gpt");
	assert.equal(initials("Join (SQL)"), "j");
	assert.ok(relevance("tiny GPT", { title: "minGPT", url: "https://github.com/karpathy/minGPT" }) > 0.5);
	assert.ok(relevance("tiny GPT", { title: "Generative pre-trained transformer", url: "https://en.wikipedia.org/wiki/x" }) > 0.5);
});

test("disambiguation pages are dropped (MediaWiki marks them with an empty string); acronyms expand by relevance", async () => {
	const http = fakeHttp({
		"list=search": { query: { search: [{ title: "GUID Partition Table", snippet: "a disk partitioning standard" },
			{ title: "Generative pre-trained transformer", snippet: "a language model that writes text" }] } },
		"titles=": { query: { pages: [{ title: "GPT", pageprops: { disambiguation: "" } }] } },
	});
	const items = await wikipediaExact("GPT text generator", http);
	assert.deepEqual(items.map((i) => [i.title, i.exact]), [["Generative pre-trained transformer", "concept"]]);
	const calls: string[] = [];
	await wikipediaExact("SQL joins", fakeHttp({ "titles=": { query: { pages: [] } } }, calls));
	assert.ok(!new URL(calls[0]!).searchParams.get("titles")!.split("|").includes("SQL"), "a language name is not a concept");
	assert.equal(calls.length, 1, "no acronym expansion search for SQL");
});

test("GitHub items are titled by repo name; a very popular partial match is kept", async () => {
	const http = fakeHttp({ "api.github.com": { items: [
		{ full_name: "karpathy/minGPT", html_url: "https://github.com/karpathy/minGPT",
			description: "A minimal PyTorch re-implementation of the OpenAI GPT", stargazers_count: 25000 },
		{ full_name: "x/unrelated", html_url: "https://github.com/x/unrelated", description: "knitting", stargazers_count: 99000 },
	] } });
	const repos = await searchGitHub("build a tiny GPT in PyTorch", http);
	assert.equal(repos[0]!.title, "minGPT");
	assert.match(repos[0]!.snippet, /\(karpathy\)$/);
	const r = await searchSources("build a tiny GPT text generator in PyTorch", undefined, { http: fakeHttp({
		"api.github.com": { items: [{ full_name: "karpathy/minGPT", html_url: "https://github.com/karpathy/minGPT",
			description: "A minimal PyTorch re-implementation of the OpenAI GPT", stargazers_count: 25000 },
		{ full_name: "x/unrelated", html_url: "https://github.com/x/unrelated", description: "knitting", stargazers_count: 99000 }] },
		"wikipedia.org": wiki([]), "wikibooks.org": wiki([]), "stackexchange.com": { items: [] } }), env: {} });
	assert.ok(r.items.some((i) => i.title === "minGPT"));
	assert.ok(!r.items.some((i) => i.title === "unrelated"), "popularity never rescues an off-topic repo");
});
