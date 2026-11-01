import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { withFileLock } from "./lock.ts";
import type { Source, SourceKind } from "./types.ts";

const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KIND_BASES: Record<SourceKind, number> = {
	"official-docs": 90,
	textbook: 85,
	course: 80,
	paper: 80,
	reference: 65,
	video: 60,
	article: 40,
	forum: 35,
};

const KIND_LABELS: Record<SourceKind, string> = {
	"official-docs": "Official documentation",
	textbook: "Textbook",
	course: "Course material",
	paper: "Research paper",
	reference: "Reference work",
	video: "Educational video",
	article: "Article",
	forum: "Forum discussion",
};

const SOURCE_KINDS = Object.keys(KIND_BASES) as SourceKind[];

/** Subjects with bundled starting points. */
export type TrustedSubject =
	| "python"
	| "javascript"
	| "sql"
	| "git"
	| "regex"
	| "algorithms"
	| "calculus"
	| "linear-algebra"
	| "physics"
	| "probability"
	| "machine-learning"
	| "general";

/** A catalog entry used to seed a skill's source list. */
export type TrustedCatalogSource = Pick<Source, "title" | "url" | "kind"> & { publisher: string; license?: string };

interface TrustedDomain {
	host: string;
	kind: SourceKind;
	publisher: string;
	label: string;
	pathPrefix?: string;
	inferredBase?: number;
}

const TRUSTED_DOMAINS: readonly TrustedDomain[] = [
	{ host: "docs.python.org", kind: "official-docs", publisher: "Python Software Foundation",
		label: "Official Python documentation" },
	{ host: "developer.mozilla.org", kind: "official-docs", publisher: "MDN Web Docs", label: "MDN Web Docs" },
	{ host: "sqlite.org", kind: "official-docs", publisher: "SQLite", label: "Official SQLite documentation" },
	{ host: "postgresql.org", pathPrefix: "/docs", kind: "official-docs",
		publisher: "PostgreSQL Global Development Group", label: "Official PostgreSQL documentation" },
	{ host: "git-scm.com", kind: "official-docs", publisher: "Git", label: "Official Git documentation" },
	{ host: "nodejs.org", kind: "official-docs", publisher: "OpenJS Foundation", label: "Official Node.js documentation" },
	{ host: "openstax.org", kind: "textbook", publisher: "OpenStax", label: "OpenStax open textbook" },
	{ host: "ocw.mit.edu", kind: "course", publisher: "MIT OpenCourseWare", label: "MIT OpenCourseWare course" },
	{ host: "khanacademy.org", kind: "course", publisher: "Khan Academy", label: "Khan Academy course" },
	{ host: "3blue1brown.com", kind: "video", publisher: "3Blue1Brown", label: "3Blue1Brown explainer" },
	{ host: "seeing-theory.brown.edu", kind: "textbook", publisher: "Brown University",
		label: "Seeing Theory interactive textbook" },
	{ host: "en.wikipedia.org", kind: "reference", publisher: "Wikipedia", label: "Wikipedia reference" },
	{ host: "rae.es", kind: "reference", publisher: "Real Academia Española",
		label: "Real Academia Española (official Spanish dictionary)", inferredBase: 85 },
	{ host: "dle.rae.es", kind: "reference", publisher: "Real Academia Española",
		label: "Diccionario de la lengua española (RAE)", inferredBase: 85 },
	{ host: "textbooks.math.gatech.edu", kind: "textbook", publisher: "Georgia Institute of Technology",
		label: "Open university textbook (Georgia Tech)" },
	{ host: "arxiv.org", kind: "paper", publisher: "arXiv", label: "arXiv research paper" },
	{ host: "docs.pytorch.org", kind: "official-docs", publisher: "PyTorch Foundation", label: "Official PyTorch documentation" },
	{ host: "pytorch.org", kind: "official-docs", publisher: "PyTorch Foundation", label: "Official PyTorch documentation" },
	{ host: "d2l.ai", kind: "textbook", publisher: "Dive into Deep Learning",
		label: "Dive into Deep Learning open textbook" },
	{ host: "karpathy.ai", kind: "course", publisher: "Andrej Karpathy", label: "Neural Networks: Zero to Hero course" },
	{ host: "github.com", pathPrefix: "/karpathy/nanoGPT", kind: "reference", publisher: "Andrej Karpathy",
		label: "nanoGPT reference implementation" },
	{ host: "nist.gov", kind: "reference", publisher: "NIST", label: "NIST reference" },
	{ host: "dlmf.nist.gov", kind: "reference", publisher: "NIST",
		label: "NIST Digital Library of Mathematical Functions" },
	{ host: "docs.oracle.com", kind: "official-docs", publisher: "Oracle", label: "Oracle documentation" },
	{ host: "cppreference.com", kind: "reference", publisher: "cppreference.com", label: "cppreference reference" },
	{ host: "realpython.com", kind: "article", publisher: "Real Python", label: "Real Python article", inferredBase: 55 },
	{ host: "stackoverflow.com", kind: "forum", publisher: "Stack Overflow", label: "Stack Overflow discussion" },
	{ host: "medium.com", kind: "article", publisher: "Medium", label: "Medium article", inferredBase: 30 },
];

/** Curated, stable starting points for common learning subjects. */
export const TRUSTED_SOURCES: Record<TrustedSubject, TrustedCatalogSource[]> = {
	python: [
		{ title: "The Python Tutorial",
			url: "https://docs.python.org/3/tutorial/index.html",
			kind: "official-docs", publisher: "Python Software Foundation" },
		{ title: "Regular Expression HOWTO",
			url: "https://docs.python.org/3/howto/regex.html",
			kind: "official-docs", publisher: "Python Software Foundation" },
		{ title: "re — Regular expression operations",
			url: "https://docs.python.org/3/library/re.html",
			kind: "official-docs", publisher: "Python Software Foundation" },
		{ title: "Python Basics: A Practical Introduction to Python 3",
			url: "https://realpython.com/learning-paths/python-basics/",
			kind: "article", publisher: "Real Python" },
	],
	javascript: [
		{ title: "JavaScript | MDN",
			url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
			kind: "official-docs", publisher: "MDN Web Docs" },
		{ title: "JavaScript Guide | MDN",
			url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
			kind: "official-docs", publisher: "MDN Web Docs" },
		{ title: "JavaScript reference | MDN",
			url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference",
			kind: "official-docs", publisher: "MDN Web Docs" },
		{ title: "Node.js Learn", url: "https://nodejs.org/en/learn", kind: "official-docs", publisher: "OpenJS Foundation" },
	],
	sql: [
		{ title: "SQL Language | SQLite", url: "https://sqlite.org/lang.html", kind: "official-docs", publisher: "SQLite" },
		{ title: "SQL Tutorial | PostgreSQL",
			url: "https://www.postgresql.org/docs/current/tutorial.html",
			kind: "official-docs", publisher: "PostgreSQL Global Development Group" },
		{ title: "The SQLite Query Planner",
			url: "https://sqlite.org/queryplanner.html",
			kind: "official-docs", publisher: "SQLite" },
		{ title: "SQL Syntax | PostgreSQL",
			url: "https://www.postgresql.org/docs/current/sql.html",
			kind: "official-docs", publisher: "PostgreSQL Global Development Group" },
	],
	git: [
		{ title: "Pro Git", url: "https://git-scm.com/book/en/v2", kind: "official-docs", publisher: "Git" },
		{ title: "Git Reference", url: "https://git-scm.com/docs", kind: "official-docs", publisher: "Git" },
		{ title: "Git Branching",
			url: "https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows",
			kind: "official-docs", publisher: "Git" },
		{ title: "About Version Control",
			url: "https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control",
			kind: "official-docs", publisher: "Git" },
	],
	regex: [
		{ title: "Regular Expression HOWTO",
			url: "https://docs.python.org/3/howto/regex.html",
			kind: "official-docs", publisher: "Python Software Foundation" },
		{ title: "re — Regular expression operations",
			url: "https://docs.python.org/3/library/re.html",
			kind: "official-docs", publisher: "Python Software Foundation" },
		{ title: "RegExp | MDN",
			url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp",
			kind: "official-docs", publisher: "MDN Web Docs" },
		{ title: "Regular expressions | MDN",
			url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions",
			kind: "official-docs", publisher: "MDN Web Docs" },
	],
	algorithms: [
		{ title: "Big O notation",
			url: "https://en.wikipedia.org/wiki/Big_O_notation",
			kind: "reference", publisher: "Wikipedia" },
		{ title: "Algorithm", url: "https://en.wikipedia.org/wiki/Algorithm", kind: "reference", publisher: "Wikipedia" },
		{ title: "Sorting algorithm",
			url: "https://en.wikipedia.org/wiki/Sorting_algorithm",
			kind: "reference", publisher: "Wikipedia" },
		{ title: "Graph (discrete mathematics)",
			url: "https://en.wikipedia.org/wiki/Graph_(discrete_mathematics)",
			kind: "reference", publisher: "Wikipedia" },
		{ title: "Introduction to Algorithms",
			url: "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/",
			kind: "course", publisher: "MIT OpenCourseWare" },
	],
	calculus: [
		{ title: "Calculus Volume 1",
			url: "https://openstax.org/details/books/calculus-volume-1",
			kind: "textbook", publisher: "OpenStax" },
		{ title: "Calculus Volume 2",
			url: "https://openstax.org/details/books/calculus-volume-2",
			kind: "textbook", publisher: "OpenStax" },
		{ title: "Calculus 1",
			url: "https://www.khanacademy.org/math/calculus-1",
			kind: "course", publisher: "Khan Academy" },
		{ title: "Single Variable Calculus",
			url: "https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/",
			kind: "course", publisher: "MIT OpenCourseWare" },
	],
	"linear-algebra": [
		{ title: "Linear Algebra",
			url: "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/",
			kind: "course", publisher: "MIT OpenCourseWare" },
		{ title: "College Algebra 2e",
			url: "https://openstax.org/details/books/college-algebra-2e",
			kind: "textbook", publisher: "OpenStax" },
		{ title: "Linear algebra",
			url: "https://www.khanacademy.org/math/linear-algebra",
			kind: "course", publisher: "Khan Academy" },
		{ title: "Linear algebra",
			url: "https://en.wikipedia.org/wiki/Linear_algebra",
			kind: "reference", publisher: "Wikipedia" },
	],
	physics: [
		{ title: "Physics", url: "https://openstax.org/details/books/physics", kind: "textbook", publisher: "OpenStax" },
		{ title: "College Physics 2e",
			url: "https://openstax.org/details/books/college-physics-2e",
			kind: "textbook", publisher: "OpenStax" },
		{ title: "University Physics Volume 1",
			url: "https://openstax.org/details/books/university-physics-volume-1",
			kind: "textbook", publisher: "OpenStax" },
		{ title: "Classical Mechanics",
			url: "https://ocw.mit.edu/courses/8-01sc-classical-mechanics-fall-2016/",
			kind: "course", publisher: "MIT OpenCourseWare" },
	],
	probability: [
		{ title: "Probability",
			url: "https://www.khanacademy.org/math/statistics-probability/probability-library",
			kind: "course", publisher: "Khan Academy" },
		{ title: "Basic Probability",
			url: "https://seeing-theory.brown.edu/basic-probability/index.html",
			kind: "textbook", publisher: "Brown University" },
		{ title: "Conditional Probability",
			url: "https://seeing-theory.brown.edu/conditional-probability/index.html",
			kind: "textbook", publisher: "Brown University" },
		{ title: "Introductory Statistics 2e",
			url: "https://openstax.org/details/books/introductory-statistics-2e",
			kind: "textbook", publisher: "OpenStax" },
	],
	"machine-learning": [
		{ title: "Learn the Basics — PyTorch Tutorials",
			url: "https://docs.pytorch.org/tutorials/beginner/basics/intro.html",
			kind: "official-docs", publisher: "PyTorch Foundation" },
		{ title: "Dive into Deep Learning: Attention Mechanisms and Transformers",
			url: "https://d2l.ai/chapter_attention-mechanisms-and-transformers/index.html",
			kind: "textbook", publisher: "Dive into Deep Learning", license: "CC BY-SA 4.0" },
		{ title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", kind: "paper", publisher: "arXiv" },
		{ title: "Neural Networks: Zero to Hero", url: "https://karpathy.ai/zero-to-hero.html",
			kind: "course", publisher: "Andrej Karpathy" },
		{ title: "nanoGPT", url: "https://github.com/karpathy/nanoGPT", kind: "reference", publisher: "Andrej Karpathy",
			license: "MIT" },
	],
	general: [
		{ title: "Knowledge", url: "https://en.wikipedia.org/wiki/Knowledge", kind: "reference", publisher: "Wikipedia" },
		{ title: "National Institute of Standards and Technology",
			url: "https://www.nist.gov/",
			kind: "reference", publisher: "NIST" },
		{ title: "OpenStax Subjects", url: "https://openstax.org/subjects", kind: "textbook", publisher: "OpenStax" },
		{ title: "Khan Academy", url: "https://www.khanacademy.org/", kind: "course", publisher: "Khan Academy" },
	],
};

/** User input accepted by SourceStore.add(). */
export type SourceDraft = {
	url: string;
	title?: string;
	kind?: SourceKind;
	publisher?: string;
	license?: string;
	publishedAt?: string;
	excerpt?: string;
};

function assertSkill(skill: string): void {
	if (typeof skill !== "string" || !SKILL_SLUG.test(skill)) throw new Error(`Invalid skill slug: ${skill}`);
}

function assertKind(kind: string): asserts kind is SourceKind {
	if (!SOURCE_KINDS.includes(kind as SourceKind)) throw new Error(`Invalid source kind: ${kind}`);
}

function canonicalHost(host: string): string {
	return host.toLowerCase().replace(/^www\./, "");
}

function matchingHost(host: string): string {
	return canonicalHost(host).replace(/\.$/, "");
}

function canonicalUrl(input: string): { canonical: string; parsed: URL } {
	if (typeof input !== "string" || !input.trim()) throw new Error("Source URL must not be empty");
	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch (error) {
		throw new Error(`Invalid source URL: ${input}`, { cause: error });
	}
	parsed.hostname = canonicalHost(parsed.hostname);
	parsed.hash = "";
	parsed.pathname = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "") || "/";
	const query = [...parsed.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
		aKey < bKey ? -1 : aKey > bKey ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0);
	parsed.search = query.length ? `?${new URLSearchParams(query).toString()}` : "";
	return { canonical: parsed.toString(), parsed };
}

function trustedDomain(parsed: URL): TrustedDomain | undefined {
	const host = matchingHost(parsed.hostname);
	return TRUSTED_DOMAINS.find((candidate) => candidate.host === host &&
		(candidate.pathPrefix === undefined || parsed.pathname === candidate.pathPrefix ||
			parsed.pathname.startsWith(`${candidate.pathPrefix}/`)));
}

function validDate(value: string | undefined): Date | undefined {
	if (value === undefined) return undefined;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function isOlderThanTenCalendarYears(publishedAt: Date, now: Date): boolean {
	if (!Number.isFinite(publishedAt.getTime()) || !Number.isFinite(now.getTime())) return false;
	const anniversary = new Date(now);
	anniversary.setUTCFullYear(anniversary.getUTCFullYear() - 10);
	return publishedAt.getTime() < anniversary.getTime();
}

function openLicense(license: string | undefined, kind: SourceKind): boolean {
	if (!license) return false;
	return /^cc/i.test(license.trim()) || /public\s+domain/i.test(license) || /\bGNU\s+FDL\b|GNU Free Documentation/i.test(license) ||
		(kind === "official-docs" && /^(?:mit|bsd|psf)\b|Python Software Foundation License/i.test(license.trim()));
}

function hashSourceUrl(canonical: string): string {
	return `src-${createHash("sha1").update(canonical).digest("hex").slice(0, 10)}`;
}

/** Return the stable identifier for a parseable URL after canonical normalization. */
export function sourceId(url: string): string {
	return hashSourceUrl(canonicalUrl(url).canonical);
}

/** Rank a source by kind, domain trust, transport, license, and age. */
export function rankSource(
	input: { url: string; kind?: SourceKind; publisher?: string; license?: string; publishedAt?: string },
	now: Date = new Date(),
): { rank: number; kind: SourceKind; rankReasons: string[] } {
	const { parsed } = canonicalUrl(input.url);
	const trusted = trustedDomain(parsed);
	const explicitKind = input.kind !== undefined;
	if (input.kind !== undefined) assertKind(input.kind);
	const kind = input.kind ?? trusted?.kind ?? "article";
	const base = explicitKind ? KIND_BASES[kind] : trusted?.inferredBase ?? KIND_BASES[kind];
	let score = base;
	const rankReasons = [trusted && !explicitKind ? `${trusted.label} (+${base})` : `${KIND_LABELS[kind]} (+${base})`];
	if (trusted) {
		score += 5;
		rankReasons.push("Trusted domain (+5)");
	}
	if (parsed.protocol !== "https:") {
		score -= 10;
		rankReasons.push("Non-HTTPS URL (-10)");
	}
	if (openLicense(input.license, kind)) {
		score += 3;
		rankReasons.push(`Open license${input.license?.trim() ? ` (${input.license.trim()})` : ""} (+3)`);
	}
	const publishedAt = validDate(input.publishedAt);
	if (kind !== "reference" && publishedAt && isOlderThanTenCalendarYears(publishedAt, now)) {
		score -= 5;
		rankReasons.push("More than 10 years old (-5)");
	}
	const rank = Math.max(0, Math.min(100, score));
	if (rank !== score) rankReasons.push(`Score clamped to ${rank}`);
	return { rank, kind, rankReasons };
}

function readText(root: string, file: string): string | undefined {
	assertNoSymlink(root, file);
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function assertNoSymlink(root: string, target: string): void {
	const base = path.resolve(root);
	const absoluteTarget = path.resolve(target);
	const relative = path.relative(base, absoluteTarget);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path escapes store root: ${target}`);
	}
	let current = base;
	for (const component of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		try {
			if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink inside store: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

function atomicWrite(root: string, file: string, text: string): void {
	assertNoSymlink(root, file);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	assertNoSymlink(root, file);
	const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporary, text, { flag: "wx" });
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function optionalText(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const text = value.trim();
	return text || undefined;
}

function sourceSort(a: Source, b: Source): number {
	return b.rank - a.rank || a.id.localeCompare(b.id);
}

/** Synchronous source storage under `$PSI_HOME/skills/<skill>/sources.json`. */
export class SourceStore {
	readonly root: string;

	/** Resolve the source home without creating it. */
	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.root = path.resolve(home);
	}

	private file(skill: string): string {
		assertSkill(skill);
		const file = path.join(this.root, "skills", skill, "sources.json");
		assertNoSymlink(this.root, file);
		return file;
	}

	private read(skill: string): Source[] {
		const file = this.file(skill);
		const text = readText(this.root, file);
		if (text === undefined) return [];
		const value: unknown = JSON.parse(text);
		if (!Array.isArray(value)) throw new Error(`Invalid source list in ${file}`);
		return value as Source[];
	}

	private write(skill: string, sources: Source[]): void {
		const file = this.file(skill);
		atomicWrite(this.root, file, JSON.stringify([...sources].sort(sourceSort), null, "\t") + "\n");
	}

	/** Return sources in descending rank, then stable id order. */
	list(skill: string): Source[] {
		return this.read(skill).sort(sourceSort);
	}

	/** Add or refresh a source, deduplicating by its canonical URL identifier. */
	add(skill: string, draft: SourceDraft, now: Date = new Date()): Source {
		assertSkill(skill);
		return withFileLock(this.file(skill), () => this.addUnlocked(skill, draft, now));
	}

	private addUnlocked(skill: string, draft: SourceDraft, now: Date): Source {
		const { canonical } = canonicalUrl(draft.url);
		const id = hashSourceUrl(canonical);
		const sources = this.read(skill);
		const existing = sources.find((source) => source.id === id);
		const trusted = trustedDomain(new URL(canonical));
		const publisher = draft.publisher !== undefined ? optionalText(draft.publisher)
			: existing?.publisher ?? trusted?.publisher;
		const license = draft.license !== undefined ? optionalText(draft.license) : existing?.license;
		const publishedAt = draft.publishedAt !== undefined ? optionalText(draft.publishedAt) : existing?.publishedAt;
		const excerpt = draft.excerpt !== undefined ? draft.excerpt.trim().slice(0, 300) : existing?.excerpt;
		const title = optionalText(draft.title) ?? existing?.title ?? canonical;
		const retainedKind = draft.kind ?? (trusted?.inferredBase !== undefined && existing?.kind === trusted.kind
			? undefined : existing?.kind);
		const ranked = rankSource({ url: canonical, kind: retainedKind, publisher, license, publishedAt }, now);
		const source: Source = {
			id, url: canonical, title, kind: ranked.kind, rank: ranked.rank, rankReasons: ranked.rankReasons,
			accessedAt: now.toISOString(),
			...(publisher === undefined ? {} : { publisher }),
			...(license === undefined ? {} : { license }),
			...(publishedAt === undefined ? {} : { publishedAt }),
			...(excerpt === undefined ? {} : { excerpt }),
		};
		const index = sources.findIndex((candidate) => candidate.id === id);
		if (index >= 0) sources[index] = source;
		else sources.push(source);
		this.write(skill, sources);
		return source;
	}

	/** Find a source by id, returning undefined when it is absent. */
	get(skill: string, id: string): Source | undefined {
		return this.read(skill).find((source) => source.id === id);
	}

	/** Remove a source by id and report whether it existed. */
	remove(skill: string, id: string): boolean {
		// A no-op removal must not create the skill directory (the lock file would).
		if (!this.read(skill).some((source) => source.id === id)) return false;
		return withFileLock(this.file(skill), () => {
			const sources = this.read(skill);
			const remaining = sources.filter((source) => source.id !== id);
			if (remaining.length === sources.length) return false;
			this.write(skill, remaining);
			return true;
		});
	}
}
