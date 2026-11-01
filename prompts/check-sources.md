---
description: Audit the active skill's sources against fetched pages and report, with evidence, which learning claims the sources likely support, may contradict, or leave unclear.
argument-hint: "[claim]"
---
Use source-grounding to check $@ against the active skill's sources.
If the skill is unknown, use context or ask one focused question and wait.
Call psi_sources action list for that skill; show the returned rank order as numbered titles and links.
Explain rank using the actual rankReasons, not invented weights or a claim that rank guarantees correctness.
Fetch with psi_fetch any source not already read in this session; a stored excerpt is not proof of verification.
Check the supplied claim, or the specific claims in the current lesson or recent explanation.
Map each claim to exact supporting or contradicting passages, with [n] using the displayed list order.
Report likely supported, possibly contradicted, and unclear claims separately, evidence first; distinguish your deductions from quotations.
If pages conflict, show both, explain the higher returned rank and its reasons, and name remaining uncertainty.
If a page cannot be fetched, mark it unread and avoid citing it as support.
If no source supports a claim, say “I couldn't find a source for this” rather than guessing.
If there are no sources, say so and use source-grounding to research and record suitable references first.
Quote only short excerpts, respect known licensing, and link to longer passages.
Offer psi_verify with claim and optional skill for a specific claim; show its evidence passages first, then its verdict
(likely-supported, possibly-contradicted, or unclear) in hedged words: it matches wording, not meaning, so it is not proof.
If a test is active, defer the audit and feedback until the test ends.
If tools are unavailable, state which checks could not run; never fabricate ranks, source contents, or Verification results.
Ask at most one question per message. Finish with “Want me to check that against the sources?”
