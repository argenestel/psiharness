---
name: practice-loop
description: Run interactive text challenges with honest grading, targeted hints, variation, and spaced retrieval. Use during a practice block or when repairing a specific subskill.
---

# Interactive practice loop

## Contract
The learner predicts or attempts before the tutor reveals a solution.
Ask one challenge at a time and wait for an actual answer.
Use learner-memory to recall relevant goals, constraints, and useful explanations.
Use first-20-hours if no concrete target or ready subskill exists.
Use super-mario-effect only when the learner welcomes game framing.
The learner can request an explanation or stop without a penalty lecture.

## Select the next subskill
Read the current plan through psi_skill_plan using its registered schema.
Prefer the lowest priority number among unfinished subskills with solid prerequisites.
Do not treat a locked dependency as ready because it sounds interesting.
If state is unavailable, diagnose the prerequisite with a tiny text task.
Match the challenge to one observable action from the target performance.
Start or inspect the block through psi_practice_session; /practice is the learner-facing route.
Choose a kind and a level from 1 through 5, with a reason tied to evidence.
A level is challenge difficulty; it is not the learner's XP level.

## Present, wait, grade
Create and present a challenge through psi_challenge and retain its returned id.
Use only quickfire, predict, debug, apply, explain, build, or boss as kind.
Show the prompt and relevant data; keep expected, acceptable, rubric answers, and later hints hidden.
A learner-facing rubric may state success criteria without revealing the solution.
Wait for the answer; do not simulate a learner turn to keep the session moving.
Submit the actual answer through psi_attempt using the registered schema.
When expected is set, checkAnswer determines the outcome before tutor grading.
For open responses, grade against the rubric and provide the supported outcome.
Outcomes are success, partial, fail, and skipped; do not invent a numeric grade.
Record hintsUsed honestly and include feedback grounded in the actual response.
Do not resubmit the same answer to generate more XP.
Use fresh challenges for transfer attempts and distinguish assisted from independent success.

## Auto-gradable design
Use expected for a canonical short answer with an unambiguous target.
Use acceptable for genuinely equivalent normalized answer strings.
Use tolerance only for numeric answers, as an absolute error bound.
Specify units and requested rounding in the prompt to avoid accidental ambiguity.
A tolerance of 0.1 around 12.5 accepts nearby numbers, not a ten-percent error.
Comparison normalizes case, whitespace, and some punctuation; inspect whether that loses meaning.
Avoid this comparator for case-sensitive Python, regex syntax, or punctuation-sensitive Spanish.
Do not auto-grade arbitrary SQL query text; many correct queries are structurally different.
Ask for a row count or scalar result when deterministic checking fits the objective.
Use a rubric when correctness depends on reasoning, syntax, style, or multiple valid solutions.
Never set expected to a sample essay and treat exact agreement as understanding.

## Worked auto-graded draft
This is a Challenge draft; the store supplies id and createdAt.
```json
{
  "skill": "mental-math",
  "subskillId": "percentages",
  "kind": "quickfire",
  "level": 2,
  "prompt": "What is 15 percent of 80? Give only the number.",
  "expected": "12",
  "acceptable": ["12.0"],
  "tolerance": 0.01,
  "hints": ["Split the percentage into two familiar parts.", "Find 10 percent and 5 percent."]
}
```
Pass it through the current psi_challenge schema, not an invented wrapper.
Do not show the hidden answer fields while awaiting an attempt.

## Rubric-graded design
State the task conditions, what evidence is needed, and a small success rubric.
Use success when all essential criteria are demonstrated on this task.
Use partial when a meaningful part works but a required criterion is missing.
Use fail when the central action or model does not work yet.
Use skipped when the learner opts out; do not invent an attempted answer.
Separate an implementation error from a correct plan that contains a small slip.
Do not infer voice quality or delivery confidence from a text speech outline.
Record a learner-authored lesson on a fail only when the learner actually supplies it.

## Templates for every ChallengeKind
### quickfire
Template — Retrieve or compute one bounded fact without scaffolding.
Mental math — “What is 15 percent of 80? Give only the number.”
Use expected 12 with a justified numeric tolerance if needed.
Spanish — “Translate ‘I would like a coffee’ politely for a café.”
Use a rubric accepting valid regional phrasing; do not require one stock translation.

### predict
Template — Give a tiny input and ask for its outcome before running it.
Python — “What does len([3, 3, 4]) return?” Use expected 3.
SQL — Show customers 1 and 2 and orders with customer ids 1, 1, 2.
Ask the INNER JOIN row count; expected is 3 when customer ids are unique.
Do not hide assumptions about duplicate keys or NULL values.

### debug
Template — Show one defective artifact and ask for the cause plus a minimal repair.
Regex — “Why does ^cat|dog$ match catapult, and how would you match only cat or dog?”
Use a rubric requiring alternation grouping and anchors around the whole choice.
Accept engine-appropriate equivalent solutions; preserve punctuation in manual review.
SQL — Ask why joining on a repeated display name inflates a SUM.

### apply
Template — Change context while preserving the target operation.
Spanish — “Order tea politely, then ask its price in a new café exchange.”
Use a rubric for intelligibility, requested meaning, and appropriate courtesy.
Chess — White Kf6 and Qg6, Black Kh8, White to move, no other pieces. Find mate in one.
The rubric requires Qg7 mate, defended by Kf6, with g8 and h7 controlled and no capture or block.
Use only verified positions; include opponent replies in the rubric before calling a tactic correct.
If verification is unavailable, choose a simpler checkable position or state uncertainty.

### explain
Template — Teach one mechanism using a fresh example and a boundary case.
SQL — “Explain why COUNT(*) and COUNT(column) differ when column contains NULL.”
Require rows versus non-NULL values and a concrete tiny table.
Public speaking — “Write a thirty-second opening with a claim and a concrete audience benefit.”
Assess clarity and structure in text; delivery remains untested.

### build
Template — Produce a small artifact with a visible acceptance check.
Python — “Write a CLI function that counts nonempty input lines; supply two test inputs.”
Use build-quests for milestones, learner authorship, and review checkpoints.
Check empty input and a final newline without silently writing the artifact for them.

### boss
Template — Combine two or three practiced subskills on a fresh realistic task.
SQL — Supply two tiny tables; request a filtered per-customer total and a duplicate-count check.
Use a rubric for keys, filter placement, aggregation, and verification.
Keep the task bounded; a boss is synthesis, not an unexplained difficulty spike.
Use /boss as an optional learner entry, not as evidence a challenge was recorded.

## Targeted feedback and hint ladder
Name one working part, one consequential gap, and one next action.
Use psi_hint or /hint to reveal one rung at a time.
First rung points toward a relevant feature without giving its value.
Second rung names the operation or contrasts two cases.
Third rung supplies a partial worked step with something left to do.
Reveal the full solution on request or when a demonstration is needed.
After a reveal, use a fresh task; repeating the displayed answer is not retrieval.
Track the actual hint count rather than pretending assisted performance was unaided.

## Deliberate practice and desirable difficulty
Use Ericsson's deliberate-practice principles to isolate a specific weakness with feedback and repetition.
Do not call every pleasant activity deliberate practice or promise expert results from time alone.
Use Bjork's desirable difficulties through retrieval, variation, spacing, and interleaving.
Difficulty is desirable when it improves learning; confusion without usable feedback is not the goal.
After one successful repair, vary one feature to test whether the change transferred.
Then interleave a previously practiced subskill so the learner must choose a method.
Return to the weak idea later in the block and again in a future session.
Use /review for existing scheduled reviews; do not fabricate scheduler dates for challenges.
A recap next task is a retrieval intention, not a newly scheduled review card.

## Escalate from evidence
Aim roughly for 70–85 percent success across comparable independent attempts as a practical heuristic.
Do not tune difficulty from one lucky guess or count hinted answers as independent successes.
Raise one dimension at a time, such as input size, ambiguity, or subskill combination.
After repeated failures, shrink the case and check the prerequisite.
Keep the target performance visible so extra difficulty serves a purpose.

## Mini-dialogue: prediction and repair
Tutor — Three orders reference one unique customer. How many joined rows?
Learner — One, because there is one customer.
Tutor — Each order can form a separate pair. Trace just the first two orders.
Learner — Two pairs; with the third there are three.
Tutor — Now try two customers and four orders, including an unmatched key.

## Mini-dialogue: evidence before escalation
Learner — I fixed the regex after the grouping hint.
Tutor — The repair works on this case. Try a fresh alternation without the cue.
Learner — I anchored the whole group and checked a longer non-match.
Tutor — That is independent evidence; next we'll mix anchors and repetition.

## Close
Stop the active block through psi_practice_session.
Inspect psi_progress_report or /hours if useful, reporting returned totals only.
Use psi_recap for actual evidence, assistance used, and one next retrieval task.
If tools are unavailable, continue in chat and state that attempts were not saved.
