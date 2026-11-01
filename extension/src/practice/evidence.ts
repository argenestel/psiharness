import type { Source } from "../../../core/src/types.ts";

// Legacy supported -> likely-supported; contradicted -> possibly-contradicted; unclear stays unclear.
export type EvidenceVerdict = "likely-supported" | "possibly-contradicted" | "unclear";
export interface EvidencePassage {
	sourceId: string; title: string; rank: number; url: string;
	sentenceIndex: number; text: string; context: string; bm25: number; score: number;
}
const stop = new Set("a an the is are was were be been to of in on for from and or it as by with does do can".split(" "));
const special = (token: string) => /[\d_^().]|[a-z][A-Z]/.test(token);

/** Tokenize prose while preserving decimal numbers, identifiers and Big-O expressions. */
export function tokenize(text: string): string[] {
	return (text.toLowerCase().match(/o\([^)]*\)|[a-z0-9]+(?:[_.^][a-z0-9]+)*/g) ?? [])
		.filter((token) => !stop.has(token));
}

/** Convert the legacy verifier labels to evidence signal labels. */
export function mapVerdict(verdict: "supported" | "contradicted" | "unclear"): EvidenceVerdict {
	return verdict === "supported" ? "likely-supported" : verdict === "contradicted" ? "possibly-contradicted" : "unclear";
}

/** Score each document with BM25 (k1=1.2, b=0.75), using corpus sentence frequencies. */
export function bm25(query: string, documents: string[]): number[] {
	const corpus = documents.map(tokenize), terms = [...new Set(tokenize(query))];
	const average = corpus.reduce((n, tokens) => n + tokens.length, 0) / Math.max(1, corpus.length) || 1;
	const frequencies = new Map(terms.map((term) => [term, corpus.filter((tokens) => tokens.includes(term)).length]));
	return corpus.map((tokens) => terms.reduce((score, term) => {
		const frequency = tokens.filter((token) => token === term).length;
		const df = frequencies.get(term)!;
		const idf = Math.log(1 + (corpus.length - df + 0.5) / (df + 0.5));
		return score + idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * tokens.length / average));
	}, 0));
}

/** Rank sentences and include immediate neighbours; return up to six available passages. */
export function rankEvidence(claim: string, documents: { source: Source; text: string }[], limit = 6): EvidencePassage[] {
	const rows = documents.flatMap(({ source, text }) => {
		// A period inside 3.14 or an identifier is not a sentence boundary.
		const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
		return sentences.map((text, sentenceIndex) => ({ source, text, sentenceIndex,
			context: sentences.slice(Math.max(0, sentenceIndex - 1), sentenceIndex + 2).join(" ") }));
	});
	const scores = bm25(claim, rows.map((r) => r.text));
	const identifiers = [...new Set(tokenize(claim).filter(special))];
	return rows.map((row, index) => {
		const tokens = new Set(tokenize(row.text)), bm25 = scores[index]!;
		const boost = identifiers.filter((term) => tokens.has(term)).length * 0.35;
		return { sourceId: row.source.id, title: row.source.title, rank: row.source.rank, url: row.source.url,
			text: row.text, context: row.context, sentenceIndex: row.sentenceIndex, bm25, score: bm25 + boost };
	}).sort((a, b) => b.score - a.score || b.rank - a.rank || a.sentenceIndex - b.sentenceIndex)
		.slice(0, Math.max(3, Math.min(6, limit)));
}

function negationNear(text: string, keys: Set<string>): boolean {
	const tokens = text.toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9_]+(?:'[a-z]+)?/g) ?? [];
	return tokens.some((token, i) => /^(not|never|no|cannot|without)$|n't$/.test(token)
		&& tokens.slice(Math.max(0, i - 3), i + 4).some((t) => keys.has(t)));
}

/** Conservative lexical signals, never semantic proof; compare only the top three passages. */
export function evidenceVerdict(claim: string, evidence: EvidencePassage[]): EvidenceVerdict {
	const keys = new Set(tokenize(claim)), identifiers = [...keys].filter(special);
	if (keys.size < 2) return "unclear";
	const claimNegative = negationNear(claim, keys);
	let supported = false, contradicted = false;
	for (const passage of evidence.slice(0, 3)) {
		const tokens = new Set(tokenize(passage.text));
		const coverage = [...keys].filter((key) => tokens.has(key)).length / keys.size;
		// Strong = BM25 >= 0.8 and >= 80% key-term coverage. Support additionally requires
		// >= 95%, all numeric/code tokens, and the full ordered claim token sequence.
		if (passage.bm25 < 0.8 || coverage < 0.8) continue;
		const negative = negationNear(passage.text, keys);
		if (negative && !claimNegative) contradicted = true;
		const ordered = tokenize(passage.text).join(" ").includes([...tokenize(claim)].join(" "));
		const uncertain = /\?|\b(may|might|perhaps|if|whether|claims?|believes?)\b/i.test(passage.text);
		if (coverage >= 0.95 && identifiers.every((id) => tokens.has(id)) && ordered
			&& negative === claimNegative && !uncertain) supported = true;
	}
	return supported && contradicted ? "unclear" : contradicted ? "possibly-contradicted"
		: supported ? "likely-supported" : "unclear";
}
