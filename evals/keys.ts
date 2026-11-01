#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PracticeStore } from "../core/src/practice.ts";
import type { Challenge, Outcome } from "../core/src/types.ts";

type Dict = Record<string, unknown>;

/** Verdict for one answer of one key: graded by the pack's own rules, or skipped with a reason. */
export type KeyVerdict = Outcome | "skip";

/** Verification of one challenge's correct/wrong pair. */
export interface KeyCheck {
	challengeId: string;
	format: string;
	method: "checkAnswer" | "python-tests" | "sql-rows" | "skip";
	correct: KeyVerdict;
	wrong: KeyVerdict;
	/** True when correct grades success and wrong does not, or the key is an explicitly marked skip. */
	ok: boolean;
	reason?: string;
	/** The key file's own `skip` marker (required for every key the pack cannot grade deterministically). */
	marked?: string;
}

/** Result of verifying one answer-key file against its pack. */
export interface KeyFileCheck {
	slug: string;
	keyFile: string;
	packDir: string;
	checks: KeyCheck[];
	missing: string[];
	unknown: string[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const answerKeysDir = join(ROOT, "evals", "answer-keys");

// One Python process grades every code job: python challenges run setup + code + tests in fresh globals (the
// browser python-worker contract); SQL challenges run setup + code in a fresh in-memory SQLite and return the
// last statement's rows (the sql-runner contract) for comparison in JS.
const PYTHON_RUNNER = String.raw`
import json, sqlite3, sys, traceback
jobs = json.load(sys.stdin)
out = []
for job in jobs:
    try:
        if job["language"] == "python":
            env = {"__name__": "__main__"}
            for source in (job.get("setup") or "", job["code"], job.get("tests") or ""):
                if source:
                    exec(compile(source, "<key>", "exec"), env)
            out.append({"ok": True})
        else:
            db = sqlite3.connect(":memory:")
            if job.get("setup"):
                db.executescript(job["setup"])
            rows = []
            for statement in [s for s in job["code"].split(";") if s.strip()]:
                cursor = db.execute(statement)
                if cursor.description is not None:
                    rows = [list(row) for row in cursor.fetchall()]
            db.close()
            out.append({"ok": True, "rows": rows})
    except BaseException as error:
        out.append({"ok": False, "error": "".join(traceback.format_exception_only(type(error), error)).strip()[:500]})
json.dump(out, sys.stdout)
`;

function isObject(value: unknown): value is Dict {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function slugify(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Mirror studio/public/js/codelab.js compareRows: unordered unless the tests say `-- ordered`. */
export function compareRows(actual: unknown, expected: unknown, ordered = false): boolean {
	if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
	const a = actual.map((row) => JSON.stringify(row)), b = expected.map((row) => JSON.stringify(row));
	if (!ordered) { a.sort(); b.sort(); }
	return a.every((row, index) => row === b[index]);
}

/** Flatten the accepted key-file shapes into {challengeId: {correct, wrong}}. */
export function keyEntries(keys: unknown): Map<string, Dict> {
	const entries = new Map<string, Dict>();
	if (Array.isArray(keys)) {
		for (const item of keys) if (isObject(item) && typeof (item.challengeId ?? item.id) === "string") entries.set(String(item.challengeId ?? item.id), item);
	} else if (isObject(keys)) {
		const source = isObject(keys.challenges) ? keys.challenges : keys;
		for (const [id, pair] of Object.entries(source)) if (id !== "kind" && id !== "skill" && isObject(pair)) entries.set(id, pair);
	}
	return entries;
}

interface CodeJob { challengeId: string; which: "correct" | "wrong"; language: string; setup?: string; code: string; tests?: string }

function runCodeJobs(jobs: CodeJob[]): { ok: boolean; rows?: unknown[]; error?: string }[] {
	if (!jobs.length) return [];
	const cwd = mkdtempSync(join(tmpdir(), "psi-eval-keys-"));
	try {
		const child = spawnSync("python3", ["-I", "-c", PYTHON_RUNNER], { cwd, input: JSON.stringify(jobs), encoding: "utf8",
			timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
		if (child.error || child.status !== 0) {
			const error = child.error?.message ?? child.stderr.slice(-500) ?? `python3 exited ${child.status}`;
			return jobs.map(() => ({ ok: false, error: `runner unavailable: ${error}` }));
		}
		const parsed = JSON.parse(child.stdout) as { ok: boolean; rows?: unknown[]; error?: string }[];
		return parsed;
	} finally { rmSync(cwd, { recursive: true, force: true }); }
}

/** True when python3 can run the code-key checks. */
export function pythonAvailable(): boolean {
	const child = spawnSync("python3", ["-c", "import sqlite3"], { encoding: "utf8", timeout: 10_000 });
	return !child.error && child.status === 0;
}

/** Verify every key against its pack challenge: checkAnswer for scalar formats, the pack's runner contract for code. */
export function verifyKeys(packDir: string, keys: unknown, options: { slug?: string; keyFile?: string } = {}): KeyFileCheck {
	const plan = JSON.parse(readFileSync(join(packDir, "plan.json"), "utf8")) as Dict;
	const slug = options.slug ?? slugify(String(plan.skill ?? basename(packDir)));
	const challenges = (JSON.parse(readFileSync(join(packDir, "challenges.json"), "utf8")) as Dict[])
		.map((challenge) => ({ ...challenge, skill: slug, hints: Array.isArray(challenge.hints) ? challenge.hints : [] }) as unknown as Challenge);
	const byId = new Map(challenges.map((challenge) => [challenge.id, challenge]));
	const entries = keyEntries(keys);
	const store = new PracticeStore(join(tmpdir(), "psi-eval-keys-unused"));
	const checks: KeyCheck[] = [];
	const jobs: CodeJob[] = [];
	const pending: { check: KeyCheck; challenge: Challenge }[] = [];
	for (const [id, pair] of entries) {
		const challenge = byId.get(id);
		if (!challenge) continue;
		const format = challenge.format ?? "text";
		const correct = typeof pair.correct === "string" ? pair.correct : undefined;
		const wrong = typeof pair.wrong === "string" ? pair.wrong : undefined;
		const marked = typeof pair.skip === "string" ? pair.skip : pair.skip === true ? "skip" : undefined;
		const check: KeyCheck = { challengeId: id, format, method: "skip", correct: "skip", wrong: "skip", ok: true,
			...(marked ? { marked } : {}) };
		checks.push(check);
		if (format === "code") {
			const language = challenge.language ?? "";
			const reference = language === "python" ? !!challenge.tests?.trim()
				: language === "sql" ? challenge.expected !== undefined && challenge.expected !== "" : false;
			if (!reference) { check.reason = `no pack reference behaviour for ${language || "unknown"} code`; continue; }
			check.method = language === "python" ? "python-tests" : "sql-rows";
			for (const [which, code] of [["correct", correct], ["wrong", wrong]] as const) {
				if (code !== undefined) jobs.push({ challengeId: id, which, language, setup: challenge.setup, code, tests: challenge.tests });
			}
			pending.push({ check, challenge });
			continue;
		}
		const grade = (answer: string | undefined): KeyVerdict => answer === undefined ? "skip" : store.checkAnswer(challenge, answer) ?? "skip";
		check.correct = grade(correct);
		check.wrong = grade(wrong);
		if (check.correct === "skip" && check.wrong === "skip") {
			check.reason = "no deterministic grader (rubric/tutor-graded)";
			continue;
		}
		check.method = "checkAnswer";
	}
	const results = runCodeJobs(jobs);
	for (const [index, job] of jobs.entries()) {
		const item = pending.find((entry) => entry.check.challengeId === job.challengeId)!;
		const result = results[index] ?? { ok: false, error: "no result" };
		let verdict: KeyVerdict = result.ok ? "success" : "fail";
		if (result.ok && job.language === "sql") {
			const expected = typeof item.challenge.expected === "string" ? JSON.parse(item.challenge.expected) : item.challenge.expected;
			verdict = compareRows(result.rows, expected, (item.challenge.tests ?? "").includes("-- ordered")) ? "success" : "fail";
		}
		if (result.error?.startsWith("runner unavailable")) { verdict = "skip"; item.check.reason = result.error; }
		item.check[job.which] = verdict;
		if (verdict === "fail" && job.which === "correct" && result.error) item.check.reason = result.error;
	}
	for (const check of checks) {
		if (check.method === "skip") {
			// Unverifiable keys must say so in the key file; a silent skip would read as a machine-checked key.
			check.ok = !!check.marked;
			if (!check.marked) check.reason = `${check.reason ?? "unverifiable"}; key is not marked "skip"`;
			continue;
		}
		if (check.marked) { check.ok = false; check.reason = "key is marked skip but the pack grades it deterministically"; continue; }
		const correctOk = check.correct === "success" || check.correct === "skip";
		const wrongOk = check.wrong !== "success";
		check.ok = correctOk && wrongOk && !(check.correct === "skip" && !check.reason);
		if (!correctOk && !check.reason) check.reason = "correct key does not grade success";
		if (!wrongOk) check.reason = [check.reason, "wrong key grades success"].filter(Boolean).join("; ");
	}
	const missing = challenges.map((challenge) => challenge.id).filter((id) => !entries.has(id));
	const unknown = [...entries.keys()].filter((id) => !byId.has(id));
	return { slug, keyFile: options.keyFile ?? "", packDir, checks, missing, unknown };
}

/** Verify every evals/answer-keys/<slug>.json against examples/skills/<slug>. */
export function verifyAllKeys(directory = answerKeysDir): KeyFileCheck[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => {
		const slug = basename(name, ".json"), keyFile = join(directory, name);
		const packDir = join(ROOT, "examples", "skills", slug);
		return verifyKeys(packDir, JSON.parse(readFileSync(keyFile, "utf8")), { slug, keyFile });
	});
}

function main(): number {
	const results = verifyAllKeys();
	let bad = 0;
	for (const file of results) {
		const counts = { checked: 0, skipped: 0, bad: 0 };
		for (const check of file.checks) {
			if (check.method === "skip") counts.skipped++;
			else counts.checked++;
			if (!check.ok) { counts.bad++; bad++; console.log(`BAD  ${file.slug}/${check.challengeId} [${check.method}] correct=${check.correct} wrong=${check.wrong}: ${check.reason ?? ""}`); }
			else if (check.method === "skip") console.log(`SKIP ${file.slug}/${check.challengeId} [${check.format}]: ${check.reason ?? ""}`);
		}
		for (const id of file.missing) console.log(`MISS ${file.slug}/${id}: no key`);
		for (const id of file.unknown) { bad++; console.log(`UNKN ${file.slug}/${id}: key has no pack challenge`); }
		console.log(`${file.slug}: ${counts.checked} machine-checked, ${counts.skipped} skipped, ${counts.bad} bad, ${file.missing.length} missing`);
	}
	return bad ? 1 : 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) process.exitCode = main();
