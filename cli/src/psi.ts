#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.ts";
import { repoRoot } from "./host.ts";
import { PRACTICE_COMMANDS } from "./practice-commands.ts";

const HELP = `ψ — a practice-first learning agent for pi or oh-my-pi

Usage: psi [command] [options] [-- host arguments]

Practice (first 20 hours, no model needed):
${PRACTICE_COMMANDS.map((c) => c.usage.length < 28
	? `  ${c.usage.padEnd(28)}${c.summary}`
	: `  ${c.usage}\n  ${"".padEnd(28)}${c.summary}`).join("\n")}

Web:
  web [--port N] [--open]      psi web: chat with the tutor, interactive challenges, code lab (alias: studio)

Tutor:
  learn [what to learn...]     Launch the interactive tutor (default command)
  ask "<question>"            Ask the tutor once and exit
  topics                      List topics with mastery and due counts
  map <topic> [--mermaid]      Show the concept prerequisite tree
  review [topic]              Drill due flashcards in the terminal
  render <file.json> [-o path] Render storyboard or explorable HTML
    [--speech] [--autoplay]    Storyboards: read narration aloud / start playing
  render --manim <file>        Render Python or storyboard JSON with manim
    [-q l|m|h] [--docker]      Select quality and Docker runner (-o directory;
                               PSI_MANIM_RUNNER=auto|local|docker sets the default)
  crew <topic> <conceptId>    Build a lesson with the role crew
  studio [--port N] [--host H] [--open]
                              Start the local web studio (PSI_STUDIO_PORT/HOST)
  import <dir>                Copy a topic pack into PSI_HOME
  doctor                      Check runtimes, tools, and writable storage

Options:
  --host pi|omp               Host (default: PSI_HOST or pi)
  --topic <slug>              Start the tutor on a topic (also --psi-topic)
  --model <model>             Forward a model selection to the host
  --thinking <level>          Forward a thinking level to the host
  --                         Forward all remaining arguments to the host
  -h, --help                  Show help
  -v, --version               Show package version

Environment: PSI_HOME (default ~/.psi), PSI_HOST, PSI_BIN (host binary override)
`;

/** Dispatch CLI commands and return an exit code without exiting the process. */
export async function main(argv: string[]): Promise<number> {
	try {
		// Practice commands parse their own arguments.
		const practice = PRACTICE_COMMANDS.find((c) => c.name === argv[0]);
		if (practice) return await practice.run(argv.slice(1), {});
		const args = parseArgs(argv);
		if (args.options.help) {
			console.log(HELP);
			return 0;
		}
		if (args.options.version) {
			const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
			console.log(pkg.version);
			return 0;
		}
		const command = args.positionals.shift() ?? "learn";
		switch (command) {
			case "learn": return await (await import("./commands/learn.ts")).learn(args);
			case "ask": return await (await import("./commands/ask.ts")).ask(args);
			case "topics": return await (await import("./commands/topics.ts")).topics(args);
			case "map": return await (await import("./commands/map.ts")).map(args);
			case "review": return await (await import("./commands/review.ts")).review(args);
			case "render": return await (await import("./commands/render.ts")).render(args);
			case "crew": return await (await import("./commands/crew.ts")).crew(args);
			case "web":
			case "studio": return await (await import("./commands/studio.ts")).studio(args);
			case "import": return await (await import("./commands/import.ts")).importPack(args);
			case "doctor": return await (await import("./commands/doctor.ts")).doctor(args);
			default: throw new Error(`Unknown command: ${command}. Run psi --help.`);
		}
	} catch (error) {
		console.error(`psi: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

// realpath supports package-manager bin symlinks while keeping imports side-effect free.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(2));
}
