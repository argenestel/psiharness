#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	evalHelp,
	loadScenario,
	parseEvalArgs,
	scoreResults,
	selectScenarioFiles,
	runScenario,
} from "./runner.ts";

/** Run selected tutor-contract scenarios in lexical order. */
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
	const startedAt = new Date().toISOString();
	const results = [];
	for (const scenario of loaded) {
		console.log(`starting ${scenario.scenario.id}`);
		const result = await runScenario(scenario, {
			model: options.model,
			outDir: options.out,
			codeExec: options.codeExec,
			keep: options.keep,
			pi: process.env.PSI_EVAL_PI ?? "pi",
			progress: (line) => console.log(line),
		});
		results.push(result);
		console.log(`${result.success ? "passed" : "failed"} ${scenario.scenario.id} turns=${result.completedTurns}/${result.turns} tools=${result.toolCalls}`);
	}
	const score = scoreResults(results);
	const summary = { startedAt, finishedAt: new Date().toISOString(), model: options.model, codeExec: options.codeExec,
		keep: options.keep, out: options.out, scenarios: results, score };
	writeFileSync(resolve(options.out, "summary.json"), JSON.stringify(summary, null, "\t") + "\n");
	console.log(`out: ${options.out}`);
	console.log(`Score: node evals/score.ts ${options.out}`);
	console.log(`health: ${JSON.stringify(score)}`);
	return results.every((result) => result.success) ? 0 : 1;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) process.exitCode = await main();

