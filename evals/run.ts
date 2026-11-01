#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	evalHelp,
	loadScenario,
	parseEvalArgs,
	scoreResults,
	selectScenarioFiles,
	runFileStem,
	runScenario,
} from "./runner.ts";
import type { LoadedScenario, ScenarioResult } from "./runner.ts";

/** Run `worker` over `items` with at most `limit` in flight, preserving input order in the result. */
export async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const lane = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index], index);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
	return results;
}

/** Run selected tutor-contract scenarios (lexical order, repeats adjacent), up to --concurrency at a time. */
export async function main(argv = process.argv.slice(2)): Promise<number> {
	let options;
	try {
		options = parseEvalArgs(argv);
	} catch (error) {
		if (error instanceof Error && error.message === "help") {
			console.log(evalHelp);
			return 0;
		}
		console.error(`evals: ${error instanceof Error ? error.message : String(error)}\n\n${evalHelp}`);
		return 2;
	}
	let files: string[];
	try {
		files = selectScenarioFiles(options.scenarios);
	} catch (error) {
		console.error(`evals: ${error instanceof Error ? error.message : String(error)}`);
		return 2;
	}
	if (options.list) {
		if (!files.length) {
			console.log("No eval scenarios found.");
			return 0;
		}
		for (const file of files) {
			try {
				const loaded = loadScenario(file);
				console.log(`${loaded.scenario.id}\t${loaded.scenario.title}\t${loaded.slug}\t${loaded.scenario.turns.length} turns`);
			} catch (error) {
				console.log(`${file}\tINVALID\t${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return 0;
	}
	if (!files.length) {
		console.error("evals: no scenario JSON files found under evals/scenarios");
		return 2;
	}
	let loaded;
	try {
		loaded = files.map((file) => loadScenario(file));
		const ids = new Set<string>();
		for (const scenario of loaded) {
			if (ids.has(scenario.scenario.id)) throw new Error(`duplicate scenario id: ${scenario.scenario.id}`);
			ids.add(scenario.scenario.id);
		}
	} catch (error) {
		console.error(`evals: ${error instanceof Error ? error.message : String(error)}`);
		return 2;
	}
	if (options.dryRun) {
		for (const scenario of loaded) console.log(`${scenario.scenario.id}\t${scenario.slug}\t${scenario.scenario.turns.length} turns\t${scenario.packDir}`);
		return 0;
	}
	mkdirSync(options.out, { recursive: true });
	const jobs: { scenario: LoadedScenario; repeat: number }[] = loaded.flatMap((scenario) =>
		Array.from({ length: options.repeat }, (_, index) => ({ scenario, repeat: index + 1 })));
	const results: ScenarioResult[] = await pool(jobs, options.concurrency, async ({ scenario, repeat }) => {
		const label = options.repeat > 1 ? `${scenario.scenario.id} (repeat ${repeat}/${options.repeat})` : scenario.scenario.id;
		console.log(`starting ${label}`);
		const result = await runScenario(scenario, {
			model: options.model,
			outDir: options.out,
			codeExec: options.codeExec,
			keep: options.keep,
			pi: process.env.PSI_EVAL_PI ?? "pi",
			repeat,
			repeats: options.repeat,
			progress: (line) => console.log(line),
		});
		// One summary per scenario run: parallel runs (or invocations sharing --out) never overwrite each other.
		const summaryPath = join(options.out, `${runFileStem(scenario.scenario.id, repeat, options.repeat)}.summary.json`);
		const summary = { ...result, codeExec: options.codeExec, keep: options.keep, out: options.out,
			concurrency: options.concurrency, repeats: options.repeat, score: scoreResults([result]) };
		writeFileSync(summaryPath, JSON.stringify(summary, null, "\t") + "\n");
		console.log(`${result.success ? "passed" : "failed"} ${label} turns=${result.completedTurns}/${result.turns} tools=${result.toolCalls} answers=${result.answers.dynamic} dynamic/${result.answers.fallback} fallback`);
		return result;
	});
	const score = scoreResults(results);
	console.log(`out: ${options.out}`);
	console.log(`Score: node evals/score.ts ${options.out}`);
	console.log(`health: ${JSON.stringify(score)}`);
	return results.every((result) => result.success) ? 0 : 1;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) process.exitCode = await main();

