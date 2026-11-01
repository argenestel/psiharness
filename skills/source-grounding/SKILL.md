---
name: source-grounding
description: Research, rank, cite, and verify learning claims against pages actually read. Use when writing lessons, explaining factual ideas, or checking the active skill's references.
---

# Make explanations checkable

## Find and read evidence
Start from TRUSTED_SOURCES for the subject in core/src/sources.ts when available. Check whether the
relevant examples/skills/<skill>/sources.json and lessons/<subskillId>.json actually exist before
referring to bundled evidence. A stored URL or excerpt is a lead, not proof that you fetched the page.
List existing references with psi_sources action list for the skill. Use psi_search to find additional
primary, official, textbook, or course sources; use psi_fetch with the exact URL to read each actual page.
Read the relevant section, not just a search snippet. Never cite a page you did not fetch.
If fetching fails, mark that source unread and do not use it as support. If no source supports a claim,
say “I couldn't find a source for this” and identify the uncertainty rather than guessing.

## Record and rank
Use psi_sources action add with skill, url, title, kind, excerpt, and license when known.
The excerpt must quote a short supporting line exactly, at most 300 characters; never turn a paraphrase
into a quotation. Omit an unknown license rather than inventing reuse permission.
SourceKind values are official-docs, textbook, course, paper, reference, video, article, and forum.
Use the returned Source id for citations; the store supplies rank, rankReasons, and accessedAt.
Prefer higher-ranked relevant sources: official documentation and textbooks generally deserve priority
over blogs for their subject. Ranking is a selection aid, not proof that every statement is correct.
Explain the actual returned rankReasons in plain words, preserving what each reason means.
For example, the type comments illustrate “Official Python documentation” and “Open textbook (CC BY)”; these
are examples, not reasons to attach to an unread page. Do not invent numeric weights or a universal order.
AGENTS.md describes trusted-domain, kind, recency, and license factors. If core/src/sources.ts is absent,
its ranking implementation and TRUSTED_SOURCES table cannot be checked. Disclose that gap; use available
official subject references as research leads and do not claim that an automatic rank was calculated.
If the source tools are unavailable, clearly label any reference list as unsaved and unranked.

## Cite the claim, not just the lesson
After adding sources, list again: psi_sources action list returns rank descending.
Show that list with numbered titles and links. Use [1], [2] beside the factual statements they support,
matching the order of the list the learner sees. Fetch a listed page before citing it, even if bundled.
Keep numbering stable within an explanation. If additions reorder the list, show the refreshed mapping
before using new numbers. Persist Citation.sourceId rather than a display number.
A Citation may include quote (exact supporting words, at most 200 characters) and locator (section,
page, or anchor). Each SkillLesson needs at least one citation to an existing source for that skill;
all factual explanations need supporting citations, not a single irrelevant link at the bottom.
Separate source statements, your deductions, and illustrative assumptions. A source must support the
specific mechanism claimed, not merely mention the same topic.

## Handle disagreement and reuse
When sources disagree, show both claims and their citations. State which has the higher returned rank
and why, using its rankReasons, then identify what is still uncertain. Compare scope, version, and date;
a higher score does not resolve a mismatch in applicability. Do not silently choose one.
Quote only short excerpts within the limits above and any source's reuse terms. Link to longer
passages instead of copying them. Unknown licensing does not mean permission for wholesale reuse.

## Verify when reliance matters
psi_verify accepts claim and optional skill. It reads the skill's sources (cached pages from psi_fetch; up to
three uncached pages are fetched, otherwise the stored excerpt is used), ranks sentences against the claim with
BM25, and returns a Verification: claim, evidence (the ranked passages with context), citations, a note, and a
conservative verdict: likely-supported (a top passage closely matches the claim's wording), possibly-contradicted
(a strong passage has negation near the claim's terms), or unclear (everything else). Older sessions may show the
legacy values supported / contradicted.
The verdict is a lexical signal, not semantic proof: matching words do not establish that a claim is true.
Present the evidence first: quote or summarize the passages, cite them as [n], explain them in your own words,
then give the verdict in hedged language ("the sources likely support this", "a source may contradict this",
"I couldn't confirm this from the sources"). State the uncertainty for unclear and possibly-contradicted
results, mention any fetch failures listed in the note, and never claim more certainty than the passages show.
Use it when the learner requests /verify, when references conflict, or before relying on an uncited claim.
When a learner is about to rely on a claim, or a claim lacks a citation, end with:
“Want me to check that against the sources?”
Make that the only question in the message; do not also append a challenge. In test mode, defer this
offer and verification feedback until the test ends. If psi_verify is unavailable, say that clearly;
do not fabricate a Verification or imply a check ran.
