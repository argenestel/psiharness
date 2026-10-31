import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SourceStore, TRUSTED_SOURCES, rankSource, sourceId } from "../src/sources.ts";
import type { SourceKind } from "../src/types.ts";

function fixture(t: { after: (fn: () => void) => void }) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "psi-sources-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return { home, store: new SourceStore(home) };
}

test("sourceId canonicalizes scheme/host, www, fragments, trailing slashes, and sorted duplicate query values", () => {
	const first = sourceId("HTTPS://WWW.Example.com/lessons///?z=2&a=2&a=1#fragment");
	const second = sourceId("https://example.com/lessons?a=1&a=2&z=2");
	assert.equal(first, second);
	assert.match(first, /^src-[0-9a-f]{10}$/);
	assert.equal(sourceId("https://example.com"), sourceId("https://www.example.com/"));
	assert.notEqual(sourceId("https://example.com/?a=1"), sourceId("https://example.com/?a=2"));
	assert.notEqual(sourceId("http://example.com/path"), sourceId("https://example.com/path"));
	assert.notEqual(sourceId("https://example.com/a"), sourceId("https://example.com/b"));
	assert.match(sourceId("ftp://example.com/file"), /^src-[0-9a-f]{10}$/);
	assert.match(sourceId("mailto:a@example.com"), /^src-[0-9a-f]{10}$/);
	for (const invalid of ["", "not a URL"]) {
		assert.throws(() => sourceId(invalid), /URL/);
	}

	const canonical = "https://example.com/lessons?a=1&a=2&z=2";
	const expected = `src-${crypto.createHash("sha1").update(canonical).digest("hex").slice(0, 10)}`;
	assert.equal(first, expected);
});

test("rankSource applies kind bases, trusted inference, transport, license, and calendar age", () => {
	const now = new Date("2026-11-01T00:00:00.000Z");
	const cases: [SourceKind, number][] = [
		["official-docs", 90], ["textbook", 85], ["course", 80], ["paper", 80],
		["reference", 65], ["video", 60], ["article", 40], ["forum", 35],
	];
	for (const [kind, base] of cases) {
		const ranked = rankSource({ url: "https://example.com/source", kind }, now);
		assert.equal(ranked.kind, kind);
		assert.equal(ranked.rank, base);
		assert.ok(ranked.rankReasons[0]?.includes(String(base)));
	}

	assert.deepEqual(rankSource({ url: "https://docs.python.org/3/tutorial/index.html" }, now), {
		rank: 95, kind: "official-docs",
		rankReasons: ["Official Python documentation (+90)", "Trusted domain (+5)"],
	});
	assert.equal(rankSource({ url: "https://realpython.com/" }, now).rank, 60);
	assert.equal(rankSource({ url: "https://medium.com/@x/post" }, now).rank, 35);
	assert.equal(rankSource({ url: "https://stackoverflow.com/questions/1" }, now).rank, 40);
	assert.equal(rankSource({ url: "https://postgresql.org/docs/current/tutorial.html" }, now).rank, 95);
	assert.equal(rankSource({ url: "https://postgresql.org/documentation" }, now).rank, 40);
	assert.equal(rankSource({ url: "https://evilpostgresql.org/docs/current/tutorial.html" }, now).rank, 40);
	assert.equal(rankSource({ url: "http://example.com/source", kind: "article" }, now).rank, 30);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "article", license: "CC BY 4.0" }, now).rank, 43);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "article", license: "MIT" }, now).rank, 40);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "official-docs", license: "MIT" }, now).rank, 93);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "official-docs", license: "BSD-3-Clause" },
		now).rank, 93);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "article", license: "CC0" }, now).rank, 43);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "article", license: "public domain" },
		now).rank, 43);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "article", publishedAt: "2016-10-31" },
		now).rank, 35);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "article", publishedAt: "2016-11-01" },
		now).rank, 40);
	assert.equal(rankSource({ url: "https://example.com/source", kind: "reference", publishedAt: "1900-01-01" },
		now).rank, 65);
	assert.ok(rankSource({ url: "https://example.com/source", kind: "article", publishedAt: "2016-10-31" }, now)
		.rankReasons.includes("More than 10 years old (-5)"));
	assert.throws(() => rankSource({ url: "https://example.com/source", kind: "nope" as SourceKind }), /kind/);
});

test("SourceStore persists, deduplicates, infers publisher, refreshes metadata, and sorts", (t) => {
	const { home, store } = fixture(t);
	const firstAt = new Date("2026-01-01T00:00:00.000Z");
	const first = store.add("python", {
		url: "HTTPS://WWW.DOCS.PYTHON.ORG/3/tutorial/index.html?z=2&a=1#old",
		title: " Python tutorial ", license: " CC BY 4.0 ", publishedAt: "2025-01-01", excerpt: " excerpt ",
	}, firstAt);
	assert.equal(first.url, "https://docs.python.org/3/tutorial/index.html?a=1&z=2");
	assert.equal(first.title, "Python tutorial");
	assert.equal(first.publisher, "Python Software Foundation");
	assert.equal(first.kind, "official-docs");
	assert.equal(first.excerpt, "excerpt");
	assert.equal(first.accessedAt, firstAt.toISOString());

	const refreshed = store.add("python", {
		url: "https://docs.python.org/3/tutorial/index.html?a=1&z=2",
		excerpt: ` ${"new excerpt ".repeat(40)} `,
	}, new Date("2026-01-02T00:00:00.000Z"));
	assert.equal(refreshed.id, first.id);
	assert.equal(refreshed.title, first.title);
	assert.equal(refreshed.publisher, first.publisher);
	assert.equal(refreshed.license, first.license);
	assert.equal(refreshed.publishedAt, first.publishedAt);
	assert.equal(refreshed.excerpt?.length, 300);
	assert.equal(refreshed.accessedAt, "2026-01-02T00:00:00.000Z");
	assert.equal(store.list("python").length, 1);
	assert.deepEqual(store.get("python", first.id), refreshed);

	const low = store.add("python", { url: "https://example.com/low", kind: "article", title: "low" }, firstAt);
	const sorted = store.list("python");
	assert.deepEqual(sorted.map((source) => source.id), [refreshed.id, low.id]);
	assert.deepEqual(new SourceStore(home).get("python", low.id), low);
	assert.equal(store.remove("python", "missing"), false);
	assert.equal(store.remove("python", low.id), true);
	assert.equal(store.get("python", low.id), undefined);
	assert.equal(fs.readdirSync(path.join(home, "skills", "python")).some((name) => name.endsWith(".tmp")), false);
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "skills", "python", "sources.json"), "utf8")).length, 1);

	const realPython = store.add("python", { url: "https://realpython.com/", title: "Real Python" }, firstAt);
	assert.equal(realPython.rank, 60);
	assert.equal(store.add("python", { url: "https://realpython.com/" }, firstAt).rank, 60);
	assert.equal(store.add("python", { url: "https://realpython.com/", kind: "official-docs" }, firstAt).rank, 95);
	const medium = store.add("python", { url: "https://medium.com/@x/post", title: "Medium" }, firstAt);
	assert.equal(medium.rank, 35);
	assert.equal(store.add("python", { url: "https://medium.com/@x/post" }, firstAt).rank, 35);
});

test("SourceStore validates strict kebab skill slugs and refuses descendant symlinks", (t) => {
	const { home, store } = fixture(t);
	for (const invalid of ["", "Python", "python_3", "python/../other", "../python", "a--b"]) {
		assert.throws(() => store.list(invalid), /skill slug/);
	}
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "psi-sources-outside-"));
	t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
	fs.mkdirSync(path.join(home, "skills"), { recursive: true });
	fs.symlinkSync(outside, path.join(home, "skills", "linked"), "dir");
	assert.throws(() => store.list("linked"), /symlink/);
});

test("TRUSTED_SOURCES exposes exactly the requested subjects with four to eight real HTTPS entries", () => {
	const subjects = ["python", "javascript", "sql", "git", "regex", "algorithms", "calculus", "linear-algebra",
		"physics", "probability", "general"];
	assert.deepEqual(Object.keys(TRUSTED_SOURCES).sort(), [...subjects].sort());
	for (const subject of subjects) {
		const entries = TRUSTED_SOURCES[subject as keyof typeof TRUSTED_SOURCES];
		assert.ok(entries.length >= 4 && entries.length <= 8);
		for (const entry of entries) {
			assert.match(entry.url, /^https:\/\//);
			assert.ok(entry.title.length > 0);
			assert.ok(entry.publisher.length > 0);
			assert.ok(entry.kind.length > 0);
			assert.equal(rankSource({ url: entry.url }).kind, entry.kind);
		}
	}
});

test("every trusted domain infers its kind and publisher without matching lookalike hosts", (t) => {
	const { store } = fixture(t);
	const entries: [string, SourceKind, string][] = [
		["docs.python.org/3/", "official-docs", "Python Software Foundation"],
		["developer.mozilla.org/", "official-docs", "MDN Web Docs"],
		["sqlite.org/", "official-docs", "SQLite"],
		["postgresql.org/docs/", "official-docs", "PostgreSQL Global Development Group"],
		["git-scm.com/", "official-docs", "Git"],
		["nodejs.org/", "official-docs", "OpenJS Foundation"],
		["openstax.org/", "textbook", "OpenStax"],
		["ocw.mit.edu/", "course", "MIT OpenCourseWare"],
		["khanacademy.org/", "course", "Khan Academy"],
		["3blue1brown.com/", "video", "3Blue1Brown"],
		["seeing-theory.brown.edu/", "textbook", "Brown University"],
		["en.wikipedia.org/", "reference", "Wikipedia"],
		["arxiv.org/", "paper", "arXiv"],
		["nist.gov/", "reference", "NIST"],
		["dlmf.nist.gov/", "reference", "NIST"],
		["docs.oracle.com/", "official-docs", "Oracle"],
		["cppreference.com/", "reference", "cppreference.com"],
		["realpython.com/", "article", "Real Python"],
		["stackoverflow.com/", "forum", "Stack Overflow"],
		["medium.com/", "article", "Medium"],
	];
	for (const [host, kind, publisher] of entries) {
		const url = `https://${host}`, ranked = rankSource({ url });
		assert.equal(ranked.kind, kind);
		assert.ok(ranked.rankReasons.includes("Trusted domain (+5)"));
		assert.equal(store.add("domains", { url }).publisher, publisher);
	}
	assert.equal(rankSource({ url: "https://unknown.example/" }).kind, "article");
	assert.equal(rankSource({ url: "https://docs.python.org.evil.example/" }).rank, 40);
	assert.equal(rankSource({ url: "https://realpython.com/", kind: "article" }).rank, 45);
	assert.equal(rankSource({ url: "https://medium.com/", kind: "article" }).rank, 45);
});

test("ranking modifiers compose in stable order and scores remain within the clamped range", () => {
	const now = new Date("2026-11-01T12:00:00Z");
	assert.deepEqual(rankSource({ url: "http://docs.python.org/3/", license: "CC BY 4.0",
		publishedAt: "2010-01-01" }, now), { rank: 83, kind: "official-docs", rankReasons: [
		"Official Python documentation (+90)", "Trusted domain (+5)", "Non-HTTPS URL (-10)",
		"Open license (CC BY 4.0) (+3)", "More than 10 years old (-5)",
	] });
	assert.equal(rankSource({ url: "https://docs.python.org/3/", license: "CC BY 4.0" }, now).rank, 98);
	assert.equal(rankSource({ url: "http://example.com", kind: "forum", publishedAt: "1900-01-01" }, now).rank, 20);
	const kinds: SourceKind[] = ["official-docs", "textbook", "paper", "course", "reference", "video", "article", "forum"];
	for (const kind of kinds) for (const protocol of ["https", "http"]) for (const license of [undefined, "CC0"]) {
		const result = rankSource({ url: `${protocol}://example.com/`, kind, license, publishedAt: "1900-01-01" }, now);
		assert.ok(result.rank >= 0 && result.rank <= 100);
	}
	assert.equal(rankSource({ url: "https://example.com", publishedAt: "2016-11-01T11:59:59Z" }, now).rank, 35);
	assert.equal(rankSource({ url: "https://example.com", publishedAt: "2016-11-01T12:00:00Z" }, now).rank, 40);
	assert.equal(rankSource({ url: "https://example.com", license: "Proprietary", publishedAt: "invalid" }, now).rank, 40);
	assert.equal(rankSource({ url: "ftp://example.com/file" }, now).rank, 30);
	assert.notEqual(sourceId("https://example.com./a"), sourceId("https://example.com/a"));
});

test("source ties use ids; refreshes retain excerpts, replace supplied titles, and support PSI_HOME", (t) => {
	const { home, store } = fixture(t);
	assert.deepEqual(store.list("empty"), []);
	assert.equal(store.get("empty", "missing"), undefined);
	assert.equal(store.remove("empty", "missing"), false);
	assert.deepEqual(fs.readdirSync(home), []);
	const a = store.add("ties", { url: "https://example.com/b", title: "Old", excerpt: " kept " });
	const b = store.add("ties", { url: "https://example.com/a" });
	assert.deepEqual(store.list("ties").map((s) => s.id), [a.id, b.id].sort());
	const updated = store.add("ties", { url: a.url, title: "New", publisher: "Learner" });
	assert.equal(updated.title, "New");
	assert.equal(updated.excerpt, "kept");
	assert.equal(updated.publisher, "Learner");
	const previous = process.env.PSI_HOME;
	process.env.PSI_HOME = home;
	try {
		assert.deepEqual(new SourceStore().list("ties"), store.list("ties"));
	} finally {
		if (previous === undefined) delete process.env.PSI_HOME;
		else process.env.PSI_HOME = previous;
	}
	for (const invalid of ["../bad", "Bad", "a--b"]) {
		assert.throws(() => store.add(invalid, { url: a.url }), /slug/);
		assert.throws(() => store.get(invalid, a.id), /slug/);
		assert.throws(() => store.remove(invalid, a.id), /slug/);
	}
});
