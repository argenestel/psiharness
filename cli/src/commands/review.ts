import { createInterface } from "node:readline";
import { arity } from "../args.ts";
import type { ParsedArgs } from "../args.ts";
import type { Rating } from "../../../core/src/types.ts";

/** Drill a snapshot of due cards; EOF or q exits without rating the current card. */
export async function review(args: ParsedArgs): Promise<number> {
	arity(args, 0, 1, "review [topic]");
	const { PsiStore } = await import("../../../core/src/store.ts");
	const store = new PsiStore();
	const cards = store.dueCards(args.positionals[0]);
	if (!cards.length) {
		console.log("No cards due.");
		return 0;
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
	const lines = rl[Symbol.asyncIterator]();
	const read = async (prompt: string) => {
		process.stdout.write(prompt);
		const line = await lines.next();
		return line.done ? undefined : line.value.trim();
	};
	let count = 0;
	try {
		for (const card of cards) {
			console.log(`\n[${count + 1}/${cards.length}] ${card.prompt}`);
			if (card.choices) card.choices.forEach((choice, i) => console.log(`  ${i + 1}. ${choice}`));
			const reveal = await read("Enter to reveal (q to quit): ");
			if (reveal === undefined || reveal.toLowerCase() === "q") break;
			console.log(card.answer);
			let rating = await read("Rate 1 Again / 2 Hard / 3 Good / 4 Easy (q to quit): ");
			while (rating !== undefined && rating.toLowerCase() !== "q" && !/^[1-4]$/.test(rating)) {
				rating = await read("Enter a rating from 1 to 4 (q to quit): ");
			}
			if (rating === undefined || rating.toLowerCase() === "q") break;
			const updated = store.review(card.topic, card.id, Number(rating) as Rating);
			console.log(`Next due: ${updated.fsrs.due}`);
			count++;
		}
	} finally {
		rl.close();
	}
	console.log(`Reviewed ${count} card${count === 1 ? "" : "s"}.`);
	return 0;
}
