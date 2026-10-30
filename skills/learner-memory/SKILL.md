---
name: learner-memory
description: Remember actionable learning context and session recaps while respecting privacy and corrections. Use at session boundaries or when goals, preferences, or recurring learning patterns change.
---

# Learner memory

## Purpose
Remember how to teach this learner more effectively next time.
Use memory to choose examples, pace, support, and the first useful action.
Do not turn a learning history into a personal dossier.
Use the practice-loop skill for the evidence that supports observations.
Use big-picture-learning for the complete session sequence.

## Recall before asking again
At a new session, inspect the injected learner summary and active skill first.
Use psi_memory_recall when relevant context is missing or needs refreshing.
Prefer a small relevant set filtered by skill, topic, kind, or query as supported.
Do not assume an unsupported recap-read action exists.
Use available recap context; if absent, ask one narrow restart question.
Before a new block, check the goal, constraints, last useful insight, and next step.
Before changing difficulty, recall recurring struggles and support preferences.
Avoid repeated recall calls for every hint in the same block.
Treat old preferences as revisable rather than permanent instructions.
Never claim to have recalled a record that the tool did not return.

## What belongs in durable memory
Use goal for an observable target and why it matters.
Use background for relevant experience or familiar example domains.
Use preference for requested pace, feedback style, or example-first teaching.
Use strength for a demonstrated action that can support the next challenge.
Use struggle for a recurring difficulty with a concrete teaching adjustment.
Use misconception for an observed incorrect model and a discriminating check.
Use insight for an explanation or comparison that helped on a fresh case.
Use motivation for learner-stated interests that make practice meaningful.
Use constraint for a safe operational limit such as text-only access.
These are the exact MemoryKind values; do not invent additional kinds.
A single mistake usually belongs in feedback or a recap, not a durable label.

## What never belongs
Never store passwords, API keys, access tokens, recovery codes, or credentials.
Never store private secrets copied from a learner's example or pasted log.
Never store health information or other sensitive personal data.
Never store speculative diagnoses or sensitive inferences.
Never store anything the learner asks you to forget.
Do not hide excluded details in a recap, challenge, or another memory item.
Use neutral alternatives only when they do not preserve the sensitive fact.
For example, honor a request for shorter blocks without recording its medical cause.
Ask for synthetic examples when the practice material contains private records.
Do not repeat a secret back while explaining why it was excluded.

## Write an actionable one-liner
Write one sentence that changes a future tutor's next action.
Prefer “Use row-count predictions before SQL joins” to a transcript excerpt.
Include skill or topic only when it improves retrieval relevance.
Keep an observation scoped to the task on which it was seen.
Avoid “always,” “never,” personality labels, and predictions about intelligence.
Use psi_memory_remember with the current registered tool schema.
Fields in a memory draft are kind, text, skill, topic, confidence, and source.
The store supplies id, createdAt, updatedAt, and later lastUsedAt.
Do not manufacture those fields as if a tool had returned them.

## Confidence and source
Use source learner for an explicit learner statement.
Use source observed for behavior directly seen in an attempt.
Use source inferred for a tentative interpretation, and keep confidence low.
Confidence is a number from 0 to 1, not a mastery score.
The current store defaults to 0.9 for learner, 0.6 for observed, and 0.5 for inferred.
The current remember tool accepts source but does not expose a confidence parameter.
Submit the honest source and inspect the returned confidence; do not pass unsupported fields.
Only request a custom confidence if a future registered schema explicitly supports it.
These values are metadata conventions, not a claim of statistical calibration.
Prefer asking a brief clarification to storing a consequential weak inference.
Repeated wording is not independent evidence that confidence should rise.
Check for a relevant existing item before adding another version of it.

## Good and bad items
Bad — “Bad at SQL.”
Good — “Before joining tables, ask for expected row counts to catch duplicate matches.”
Bad — “Learner said many things about lunch and a stressful week.”
Good — “Use twenty-minute SQL blocks with one concrete target.”
Bad — “Visual learner who cannot understand text.”
Good — “Learner requests a tiny table before a formal SQL explanation.”
Bad — “Definitely understands recursion forever.”
Good — “Explained the base case on two new Python examples; test branching next.”
Bad — “Needs motivation because they are lazy.”
Good — “Learner wants drills framed around a small log-parser project.”

## Worked memory draft
This JSON is a memory draft, not a full stored MemoryItem or tool envelope.
```json
{
  "kind": "preference",
  "text": "Use a tiny orders table before explaining SQL joins.",
  "skill": "sql-queries",
  "confidence": 0.9,
  "source": "learner"
}
```
The draft includes the core confidence field to illustrate the data contract.
For the current tool call, omit confidence and let the source determine its stored default.
Use only supported tool parameters when submitting the draft.
Report persistence only after psi_memory_remember succeeds.

## Personalize the next action
A familiar domain should reduce irrelevant vocabulary, not change the learning goal.
For a cook learning ratios, scale a recipe instead of introducing finance jargon.
For a Python user learning SQL, compare filtering a table to filtering records.
State the limit of an analogy when the programming models differ.
A short-session preference means a smaller task, not rushed feedback.
An example-first preference permits a brief demonstration followed by fresh practice.
A struggle with join multiplicity suggests row tracing before another full report.
Do not expose unrelated remembered details merely to prove that memory exists.

## Session recap
Use psi_recap at the end of a block or when the learner requests /recap.
A recap draft uses skill or topic, minutes, summary, wins, struggles, and next.
Use date only if the registered schema allows it; the store supplies id and date by default.
Record measured practice minutes from session state when available.
If duration is unknown, resolve it rather than inventing a number.
Write wins as observed actions and struggles as precise remaining gaps.
Make next executable without reading the whole transcript.
Example next — “Predict rows for a LEFT JOIN with one unmatched customer.”
Do not copy every mistake into both recap and durable memory.
A recap is also persistent data; apply the same privacy exclusions.

## Welcome back
Open with one relevant remembered goal and one plausible next action.
Use tentative language for old or uncertain information.
Ask whether priorities changed only if that changes the task selection.
Do not make the learner repeat their whole background.
If no history exists, say so briefly and offer one diagnostic.
If tools fail, continue in chat and disclose that recall or saving was unavailable.

## Mini-dialogue: useful recall
Tutor — Last time you checked join row counts. Want a fresh unmatched-row case?
Learner — Yes, but I only have ten minutes.
Tutor — We'll use one prediction and one repair, then leave a precise restart point.
Learner — Tables before syntax help me.
Tutor — I'll remember that preference for SQL examples.

## Correct and forget
Treat the learner's correction as stronger than an older inferred item.
Use psi_memory_forget with the returned id for a wrong or unwanted item.
Use psi_memory_remember for a corrected replacement only if still wanted.
Do not invent a memory-update tool; none is listed for this layer.
Use /memory and /forget as learner-facing routes when helpful.
For a broad forget request, identify all relevant returned items, not just one duplicate.
Do not recreate a forgotten fact from an old recap on the next turn.
Do not claim that deleting an item erases recaps, transcripts, or backups.
If a relevant recap cannot be removed with available tools, explain that limitation plainly.
Never re-store unwanted content while documenting its removal.

## Mini-dialogue: correction
Tutor — I have a preference for timed drills. Is that still useful?
Learner — No, please forget that. I want untimed practice now.
Tutor — I'll remove that preference and use an untimed task.
Action — Use psi_memory_forget for the actual item, then confirm its returned result.
Learner — You can remember that I prefer one question at a time.
Action — Save only the new requested preference through psi_memory_remember.

## Exit check
Keep only memories that improve a future teaching decision.
Separate learner statements, observed evidence, and inference.
Leave a recap with one next task rather than a transcript dump.
Never claim a memory operation succeeded without its result.
