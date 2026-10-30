---
name: super-mario-effect
description: Frame low-stakes practice as safe attempts, feedback, and project progress. Use when game framing helps persistence, and switch to plain practice when it adds pressure.
---

# Super Mario effect

## Source and scope
Use Mark Rober's 2018 TEDx talk on the Super Mario Effect as the framing.
His coding-challenge account illustrates how framing failure can affect persistence and success.
Do not turn that example into a universal effect size or a promise for every learner.
The useful move is to make another informative attempt feel affordable.
His engineering projects suggest a related loop of prototype, test, fail, and iterate.
Use the learner's curiosity rather than manufacturing a competitive atmosphere.
Use practice-loop for challenge design and learner-memory for current preferences.

## Agree the frame
Ask whether game language helps when the preference is unknown and relevant.
A learner who asks for plain mode should receive plain tasks and feedback immediately.
Use a goal such as “make the report reconcile” even when no game words are wanted.
Keep practice outcomes honest; encouragement must not alter a grade.
Do not make XP into a measure of intelligence or personal worth.
Do not compare the learner to a leaderboard or other learners.

## Build a small playable loop
Pick one useful subskill from the plan through psi_skill_plan.
Choose a quick challenge with a visible success condition.
Create it through psi_challenge and wait for the learner's attempt.
Record the actual answer through psi_attempt.
Give immediate feedback about one observable result.
Offer a single hint through psi_hint if the learner wants it.
Retry with a small variation so progress depends on learning rather than copying.
Use /challenge as the learner-facing route to another challenge.
Stop or change format when the frame no longer helps.

## Levels with meaning
A level should correspond to a clear increase in task demand.
Level 1 might ask for a single row-count prediction on a tiny table.
Level 2 might add a filter and require a short check.
Level 3 might combine two familiar actions with fewer cues.
Level 4 might add an edge case such as an unmatched key.
Level 5 might require independent synthesis and verification.
These are design examples, not a fixed cross-domain scale.
Challenge level remains a number from 1 through 5.
The progress level computed from XP is a separate quantity.
Read psi_progress_report before reporting actual level changes.

## XP rewards attempts, not inflated correctness
The harness awards XP for recorded attempts, including failures.
A learner-written lesson on a fail can earn a lesson bonus.
Let psi_attempt compute and return XP; do not invent a custom reward table.
Use outcome success, partial, fail, or skipped based on the evidence.
HintsUsed must reflect assistance even when the final answer is correct.
Do not record several copies of one attempt to create a reward burst.
Do not claim that a badge was earned until returned state shows it.
Effort can earn progress while the attempted answer remains incorrect.

## Failure costs little
Use disposable inputs, small datasets, text drafts, and reversible prototypes.
A failed SQL prediction must not run against a production database.
A prototype should reveal one design uncertainty cheaply.
Avoid real money, public embarrassment, or irreversible side effects as practice stakes.
Let the learner pause, skip, or request a reveal without moral judgment.
For repeated errors, shrink the task rather than doubling the penalty.
Do not deduct imaginary lives or punish missed sessions.

## Celebrate a fail without performing enthusiasm
Name what the failed attempt revealed and why that clue is useful.
Say “The duplicate total exposed a key mismatch; now we can test the join.”
Avoid “Amazing failure!” or praise that sounds detached from the actual work.
Invite a one-sentence lesson only after the learner has useful evidence.
Ask what they will change on the next attempt.
Keep their wording when recording lesson; do not fabricate a reflection for bonus XP.
A lesson should identify an action rather than a self-judgment.
Good lesson — “Check unique join keys before summing.”
Weak lesson — “Try harder next time.”
Do not withhold feedback until the learner writes a reflection.

## Immediate feedback
Contrast expected behavior with the observed output after the attempt.
Keep the correction narrower than the whole topic.
When the issue is conceptual, ask for a prediction on a smaller case.
When the issue is a slip, ask for a focused repair without reteaching everything.
After a hint, distinguish assisted completion from independent transfer.
Use a fresh check before advancing to mixed tasks.
Do not confuse a high XP total with retention or mastery.

## Calibrate the next challenge
Aim roughly for 70–85 percent success over comparable independent attempts.
Treat that range as a working heuristic, not a scientific threshold or quota.
If nearly every task is effortless, add one meaningful constraint.
If misses dominate, reduce one dimension or repair a prerequisite.
Count hints separately so assisted answers do not hide excessive difficulty.
Do not adapt from a single lucky answer.
Ask whether the pace feels productive when performance and frustration disagree.
For a novice with no starting model, show one short example before fresh practice.

## Boss fights
Use /boss or create kind boss through psi_challenge.
Combine two or three subskills that have already received practice.
Announce the acceptance criteria and keep the attempt bounded.
A SQL boss might require a join, grouped totals, and a duplicate check.
A Spanish boss might combine ordering, a clarification, and asking the price.
Give a hint if requested; the task remains useful with honest assistance tracking.
A failed boss sends the learner to one repair drill, not back to the beginning.
Use a fresh boss later rather than asking for a memorized solution.

## Streaks without pressure
Use /streak or psi_progress_report for recorded streak information.
Treat a streak as a reminder of repeated contact, not a binding obligation.
Do not imply that missed days erase learning or earned progress.
Prefer a sustainable next block to keeping a streak at midnight.
Never encourage sacrificing sleep, health, relationships, or necessary work for a streak.
Stop displaying streak language if the learner experiences it as pressure.
Plain mode can still use honest practice records without game commentary.

## Curiosity hooks
Begin with a surprising result the learner can investigate through a tiny attempt.
SQL hook — “Why did adding a customer name double the sales total?”
Regex hook — “Why does this pattern accept a word it should reject?”
Math hook — “Can you compute this discount without multiplying the whole amount?”
Keep the hook answer hidden until a prediction or a requested reveal.
Do not introduce an unrelated spectacle before the learner can act.

## Build-to-learn quests
Use build-quests and /quest for a small real artifact with three to five milestones.
Each milestone should exercise a subskill and expose a testable result.
Borrow the prototype-test-iterate pattern from Rober's engineering projects.
The learner writes the artifact; the tutor reviews and narrows the next experiment.
Ask “What surprised you?” after a test changes the learner's expectation.
Reduce scope when a build requires more setup than the planned practice block.
Keep optional visual explanations separate from the default text workflow.

## When to stop gamifying
Switch to plain mode when the learner asks, without arguing for the game frame.
Use calm task language if anxiety or repeated comparison makes the frame unhelpful.
For high-stakes exams, prioritize exam criteria, realistic conditions, and accurate feedback.
Do not replace formal scoring with XP or present game scores as exam readiness.
Remove timers if they obstruct the skill currently being practiced.
When streak pressure affects sleep or wellbeing, stop emphasizing streaks.
Honor the requested adjustment without storing health or sensitive details.
Use learner-memory only for a safe preference such as “prefers untimed practice.”

## Mini-dialogue: useful failure
Learner — I got the total wrong again.
Tutor — This time the mismatch appears only after the join. That narrows the test.
Tutor — What will you check before the next SUM?
Learner — Whether every order matches exactly one customer id.
Action — Record the actual failed answer and learner's lesson through psi_attempt once.
Tutor — Try this three-row version and predict the number of matches first.

## Mini-dialogue: plain mode
Learner — The points and streak are making this stressful.
Tutor — We'll use plain practice. Here is one untimed row-count problem.
Learner — Please keep feedback brief too.
Tutor — I'll give one correction and one next step.
Action — Use learner-memory only for the requested safe teaching preferences.

## Close
Inspect returned progress rather than announcing invented rewards.
Stop the active practice session through psi_practice_session.
Use psi_recap to record the tested adjustment and a concrete next challenge.
If tools are unavailable, say the practice happened in chat without saved XP.
