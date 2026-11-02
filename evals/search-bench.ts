#!/usr/bin/env node
/**
 * Live benchmark for psi_search: does a learner's goal get on-topic, canonical sources at the top?
 *
 *   node evals/search-bench.ts            # all goals, top-5 table + metrics
 *   node evals/search-bench.ts --json     # machine-readable
 *   node evals/search-bench.ts --goal gpt # goals whose id contains "gpt"
 *   node evals/search-bench.ts --held-out # 8 goals kept out of tuning (looked at during development)
 *   node evals/search-bench.ts --fresh    # 8 goals written after the method was frozen (--all: every set)
 *
 * Metrics per goal: P@5 (share of the top 5 that is on-topic), canon@3 (a canonical learning resource in the top 3),
 * and off-topic count. Hits are judged by each goal's patterns over title + URL + snippet. Uses the network.
 */
import { searchSources } from "../extension/src/practice/search.ts";
import type { SearchResult } from "../extension/src/practice/search.ts";

/** One benchmark goal: what a learner types, and how to recognise relevant and canonical results. */
export interface SearchGoal { id: string; query: string; subject?: string; relevant: RegExp; canonical: RegExp }

export const GOALS: SearchGoal[] = [
	{ id: "gpt", query: "build and train a tiny GPT-style text generator in PyTorch from scratch",
		relevant: /gpt|transformer|attention|language.model|pytorch|nanogpt|mingpt|deep.learning|neural/i,
		canonical: /nanogpt|mingpt|zero-to-hero|d2l\.ai\/chapter_attention|pytorch\.org\/tutorials|1706\.03762/i },
	{ id: "sql-joins", query: "SQL joins for data analysis",
		relevant: /\bjoins?\b/i, canonical: /sqlite\.org\/lang_select|postgresql\.org\/docs|Join_\(SQL\)|inner-join-and-outer-join/i },
	{ id: "derivatives", query: "understand derivatives intuitively",
		relevant: /derivative|calculus|differentia/i, canonical: /openstax\.org.*calculus|3blue1brown|wiki\/Derivative|khanacademy/i },
	{ id: "git-branching", query: "learn git branching and merging",
		relevant: /git|branch|merg/i, canonical: /git-scm\.com\/(book|docs)/i },
	{ id: "python-regex", query: "regular expressions in Python",
		relevant: /regex|regular.expression|\bre\b|re module/i, canonical: /docs\.python\.org\/3\/(howto\/regex|library\/re)/i },
	{ id: "big-o", query: "Big-O notation and algorithm complexity",
		relevant: /big.?o|complexity|asymptotic|algorithm/i, canonical: /Big_O_notation|Time_complexity|ocw\.mit\.edu/i },
	{ id: "bayes", query: "Bayes theorem and conditional probability",
		relevant: /bayes|conditional.probability|probability/i,
		canonical: /Bayes%27_theorem|Bayes'_theorem|seeing-theory|openstax\.org.*statistics/i },
	{ id: "newton", query: "Newton's laws of motion",
		relevant: /newton|motion|force|mechanics|dynamics/i, canonical: /Newton%27s_laws|Newton's_laws|openstax\.org.*physics/i },
	{ id: "js-async", query: "async await in JavaScript",
		relevant: /async|await|promise/i, canonical: /developer\.mozilla\.org.*(async|promise|Asynchronous)/i },
	{ id: "eigen", query: "eigenvalues and eigenvectors",
		relevant: /eigen/i, canonical: /Eigenvalues_and_eigenvectors|3blue1brown|textbooks\.math\.gatech/i },
	{ id: "spanish", query: "Spanish for ordering at a cafe",
		relevant: /spanish|español|espanol|cafe|caf[eé]|food|restaurant/i, canonical: /wikibooks\.org\/wiki\/Spanish|rae\.es/i },
	{ id: "vaccines", query: "how vaccines train the immune system",
		relevant: /vaccin|immun/i, canonical: /wiki\/Vaccine|wiki\/Immune_system|openstax\.org.*biology/i },
	{ id: "photosynthesis", query: "photosynthesis light reactions",
		relevant: /photosynth|light.(dependent|reaction)/i, canonical: /wiki\/(Photosynthesis|Light-dependent_reactions)|openstax\.org.*biology/i },
];

/** Held-out goals: never used while tuning ranking, so their scores show whether the method generalizes. */
export const HELD_OUT: SearchGoal[] = [
	{ id: "ho-recursion", query: "recursion in Python with examples",
		relevant: /recurs/i, canonical: /wiki\/Recursion|docs\.python\.org|wikibooks\.org.*Recursion/i },
	{ id: "ho-css-grid", query: "CSS grid layout for responsive pages",
		relevant: /grid/i, canonical: /developer\.mozilla\.org.*grid/i },
	{ id: "ho-dot-product", query: "dot product geometric meaning",
		relevant: /dot.product|scalar.product|inner.product/i, canonical: /wiki\/Dot_product|3blue1brown|textbooks\.math\.gatech/i },
	{ id: "ho-entropy", query: "entropy in thermodynamics",
		relevant: /entrop/i, canonical: /wiki\/Entropy|openstax\.org.*physics/i },
	{ id: "ho-hash-tables", query: "how hash tables work",
		relevant: /hash/i, canonical: /wiki\/Hash_table|ocw\.mit\.edu/i },
	{ id: "ho-normal", query: "normal distribution and z-scores",
		relevant: /normal.distribution|z.?score|standard.score|gaussian/i,
		canonical: /wiki\/Normal_distribution|wiki\/Standard_score|seeing-theory|openstax\.org.*statistics/i },
	{ id: "ho-git-rebase", query: "git rebase vs merge",
		relevant: /rebas|merg/i, canonical: /git-scm\.com/i },
	{ id: "ho-french", query: "French past tense passé composé",
		relevant: /french|passé|passe|compos/i, canonical: /wikibooks\.org\/wiki\/French|wiki\/Pass%C3%A9_compos%C3%A9|wiki\/Passé_composé/i },
];

/** Second held-out set, written after the ranking method was frozen and scored once; never used for tuning. */
export const FRESH: SearchGoal[] = [
	{ id: "fr-binary-search", query: "binary search on sorted arrays",
		relevant: /binary.search/i, canonical: /wiki\/Binary_search|ocw\.mit\.edu|wikibooks\.org.*Binary_search/i },
	{ id: "fr-ohm", query: "Ohm's law and simple circuits",
		relevant: /ohm|circuit/i, canonical: /wiki\/Ohm(%27|')s_law|openstax\.org.*physics|wikibooks\.org.*(Circuit|Ohm)/i },
	{ id: "fr-list-comp", query: "list comprehensions in Python",
		relevant: /comprehension/i, canonical: /docs\.python\.org|wikibooks\.org\/wiki\/Python|wiki\/List_comprehension/i },
	{ id: "fr-closures", query: "JavaScript closures",
		relevant: /closure/i, canonical: /developer\.mozilla\.org.*Closures|wiki\/Closure_\(computer_programming\)/i },
	{ id: "fr-chain-rule", query: "chain rule in calculus",
		relevant: /chain.rule/i, canonical: /wiki\/Chain_rule|openstax\.org.*calculus|wikibooks\.org.*Chain_Rule/i },
	{ id: "fr-german-gender", query: "German noun genders der die das",
		relevant: /german|gender/i, canonical: /wikibooks\.org\/wiki\/German|wiki\/Grammatical_gender|wiki\/German_nouns/i },
	{ id: "fr-matmul", query: "matrix multiplication intuition",
		relevant: /matri/i, canonical: /wiki\/Matrix_multiplication|3blue1brown|textbooks\.math\.gatech/i },
	{ id: "fr-group-by", query: "SQL GROUP BY and aggregate functions",
		relevant: /group.by|aggregat/i, canonical: /sqlite\.org|postgresql\.org\/docs|wiki\/Aggregate_function|wiki\/Group_by/i },
];

/** Score one goal's ranked results. */
export function scoreGoal(goal: SearchGoal, items: { title: string; url: string; snippet?: string }[]) {
	const hay = (i: { title: string; url: string; snippet?: string }) => `${i.title} ${decodeURIComponent(i.url)} ${i.snippet ?? ""}`;
	const top5 = items.slice(0, 5);
	const relevant = top5.filter((i) => goal.relevant.test(hay(i))).length;
	return {
		p5: top5.length ? relevant / top5.length : 0,
		canon3: items.slice(0, 3).some((i) => goal.canonical.test(hay(i)) || goal.canonical.test(i.url)),
		offTopic: top5.length - relevant,
		count: items.length,
	};
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const filter = args.includes("--goal") ? args[args.indexOf("--goal") + 1] : undefined;
	const pool = args.includes("--held-out") ? HELD_OUT : args.includes("--fresh") ? FRESH
		: args.includes("--all") ? [...GOALS, ...HELD_OUT, ...FRESH] : GOALS;
	const goals = pool.filter((g) => !filter || g.id.includes(filter));
	const rows: { goal: SearchGoal; r: SearchResult; score: ReturnType<typeof scoreGoal> }[] = [];
	for (const goal of goals) {
		const r = await searchSources(goal.query, goal.subject);
		rows.push({ goal, r, score: scoreGoal(goal, r.items) });
	}
	if (args.includes("--json")) {
		console.log(JSON.stringify(rows.map(({ goal, r, score }) => ({ id: goal.id, ...score, providers: r.providers,
			top: r.items.slice(0, 5).map((i) => i.url) })), null, 2));
	} else {
		for (const { goal, r, score } of rows) {
			console.log(`\n## ${goal.id} — "${goal.query}"  P@5 ${(score.p5 * 100).toFixed(0)}%  canon@3 ${score.canon3 ? "yes" : "NO"}`
				+ `  off-topic ${score.offTopic}  [${r.providers.answered.join(", ")}${r.providers.failed.length ? `; failed: ${r.providers.failed.join("; ")}` : ""}]`);
			for (const [n, i] of r.items.slice(0, 5).entries()) {
				const on = goal.relevant.test(`${i.title} ${decodeURIComponent(i.url)} ${i.snippet ?? ""}`) ? " " : "✗";
				console.log(`  ${on} ${n + 1}. ${i.title.slice(0, 58).padEnd(58)} ${i.url}`);
			}
		}
		const n = rows.length;
		const mean = (f: (s: (typeof rows)[number]["score"]) => number) => rows.reduce((a, x) => a + f(x.score), 0) / n;
		console.log(`\nOVERALL  P@5 ${(mean((s) => s.p5) * 100).toFixed(1)}%  canon@3 ${rows.filter((x) => x.score.canon3).length}/${n}`
			+ `  off-topic in top 5: ${rows.reduce((a, x) => a + x.score.offTopic, 0)}`);
	}
}
