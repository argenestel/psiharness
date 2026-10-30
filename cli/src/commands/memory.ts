import { table } from "../term.ts";
import type { PracticeContext } from "../practice-commands.ts";
import type { MemoryKind } from "../../../core/src/types.ts";

const kinds: MemoryKind[] = ["goal", "background", "preference", "strength", "struggle",
	"misconception", "insight", "motivation", "constraint"];

/** Inspect and edit the learner's durable memory. */
export async function memory(argv: string[], ctx: PracticeContext): Promise<number> {
	const { MemoryStore } = await import("../../../core/src/memory.ts");
	const store = new MemoryStore(ctx.home ?? process.env.PSI_HOME);
	const out = ctx.stdout ?? process.stdout;
	const [command = "list", ...args] = argv;
	switch (command) {
		case "list": {
			if (args.length) break;
			const data = store.read();
			if (data.name) out.write(`Learner: ${data.name}\n`);
			out.write(data.items.length ? `${table(["ID", "Kind", "Memory"],
				data.items.map((item) => [item.id, item.kind, item.text]))}\n` : "No memories yet.\n");
			return 0;
		}
		case "show":
			if (args.length) break;
			out.write(`${store.summarize() || "No memories yet."}\n`);
			return 0;
		case "add": {
			const [kind, ...words] = args;
			const text = words.join(" ").trim();
			if (!kinds.includes(kind as MemoryKind) || !text) {
				throw new Error(`Usage: psi memory add <kind> <text>; kinds: ${kinds.join(", ")}`);
			}
			const item = store.remember({ kind: kind as MemoryKind, text, source: "learner" });
			out.write(`Remembered ${item.id}: ${item.text}\n`);
			return 0;
		}
		case "forget":
			if (args.length !== 1) break;
			if (!store.forget(args[0])) throw new Error(`Memory not found: ${args[0]}`);
			out.write(`Forgot ${args[0]}.\n`);
			return 0;
		case "name":
			if (!args.join(" ").trim()) break;
			store.setName(args.join(" ").trim());
			out.write(`Learner: ${args.join(" ").trim()}\n`);
			return 0;
	}
	throw new Error("Usage: psi memory [list|add <kind> <text>|forget <id>|name <name>|show]");
}
