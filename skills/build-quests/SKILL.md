---
name: build-quests
description: Guide a learner through a small real project with subskill milestones, tests, and reflection. Use when building an artifact will make practice concrete and motivating.
---

# Build-to-learn quests

## Quest contract
A quest is a small real build with three to five milestones.
Each milestone exercises a named subskill and ends with visible evidence.
The learner does the work; the tutor scopes, reviews, and asks useful questions.
Borrow Mark Rober's prototype, test, fail, and iterate pattern.
Keep a prototype small enough that a failed idea is cheap to replace.
Default to text artifacts, tiny inputs, and in-chat review.
Use first-20-hours when the target or subskill plan is missing.
Use practice-loop to design and grade each concrete checkpoint.
Use learner-memory for constraints and examples that help this learner start.

## Scope the artifact
Ask what useful object or performance should exist at the end.
Choose one audience, one core use, and one simple acceptance check.
Agree a time budget and remove features that do not exercise the target skill.
A tiny CLI can count input lines; it need not become a published package.
A budget exercise can use synthetic transactions instead of private banking records.
A Spanish café roleplay is a performance artifact in the chat transcript.
Do not require visual assets, hosting, accounts, or deployment to count as a build.
Use /quest as the learner-facing route to project learning.

## Read the plan and select subskills
Use psi_skill_plan with the registered schema to inspect the relevant plan.
Choose a ready subskill whose prerequisites are already solid.
Add a repair drill if a needed prerequisite has not been demonstrated.
Avoid treating a large final artifact as evidence for every subskill inside it.
Write a milestone map in chat using the existing subskill ids.
Milestones are a teaching structure; do not invent a Quest or Milestone storage type.
A Challenge uses kind build and level 1 through 5.
It may reference one subskillId; describe other assessed actions in its rubric.
Use psi_challenge to create the current milestone, not an entire worksheet of answers.

## Milestone shape
State the artifact change the learner will make.
Name the one primary subskill being exercised.
Provide a tiny input or realistic scenario.
Give an acceptance check that can distinguish success from a plausible failure.
Ask for an attempt or prediction before showing an implementation.
Wait for the learner to submit the artifact or explain the result.
Use psi_attempt to record the actual response and rubric-based outcome.
Then ask “What surprised you?” when a test revealed something unexpected.
Use their reflection to choose the next variation or a focused repair.

## Prototype and review
Review the smallest submitted slice that tests the current uncertainty.
Check behavior before offering style improvements unrelated to the target.
Compare the result with the stated acceptance check.
Ask for a boundary case rather than assuming the happy path generalizes.
Offer one hint through psi_hint when requested or when the learner is blocked.
If the learner lacks a starting model, demonstrate a smaller separate example.
Return authorship with a fresh implementation task after the example.
Do not quietly replace the learner's code, query, or speech with a complete solution.
Honor an explicit request for a reveal and mark learner performance as untested.

## Quest 1: tiny CLI
Target — Build a text command that counts nonempty lines from supplied input.
Keep installation, publishing, and argument frameworks outside the first version.
Milestone 1 — Predict outputs for empty, one-line, and blank-line inputs.
Primary subskill — Distinguish content from separators.
Check — The learner can state the expected counts before writing code.
Milestone 2 — Implement the counting function and submit it for review.
Primary subskill — Filter and count a sequence.
Check — Empty text returns zero; two nonempty lines return two.
Milestone 3 — Connect the function to the chosen CLI input mechanism.
Primary subskill — Read input and report output.
Check — A tiny supplied input produces the predicted count.
Milestone 4 — Test a trailing newline and a whitespace-only line.
Primary subskill — Choose and document edge-case behavior.
Check — The implementation and written definition of nonempty agree.
Ask what surprised them about splitting text at line endings.

## Quest 2: budgeting spreadsheet with SQL
Target — Produce a monthly category summary from synthetic transactions.
Choose an available SQL workspace and a spreadsheet or a text table substitute.
Do not invent an installed SQL connector or require a new service account.
Milestone 1 — Define five synthetic rows with date, category, and amount.
Primary subskill — Represent records consistently.
Check — The learner can calculate the total manually.
Milestone 2 — Write the date filter for the chosen month.
Primary subskill — Select the correct rows.
Check — Boundary dates are included or excluded as specified.
Milestone 3 — Group amounts by category using SQL.
Primary subskill — Aggregate by a key.
Check — Category totals sum to the hand-calculated filtered total.
Milestone 4 — Transfer the result to a spreadsheet and compare with a budget column.
Primary subskill — Validate a report against its source.
Check — A changed transaction updates the expected comparison correctly.
Ask what surprised them when one date crossed the month boundary.

## Quest 3: regex log parser
Target — Extract timestamp, level, and message from a tiny synthetic log.
Specify the regex engine before reviewing syntax-sensitive solutions.
Milestone 1 — Mark the intended fields on two example lines by hand.
Primary subskill — Identify structure and delimiters.
Check — The learner distinguishes a separator from text inside the message.
Milestone 2 — Write a pattern for the valid line format.
Primary subskill — Use groups and repetition.
Check — The extracted fields match the manual labels.
Milestone 3 — Test an invalid line and a message containing spaces.
Primary subskill — Use boundaries and avoid accidental overmatching.
Check — Invalid lines are rejected or explicitly handled according to the specification.
Milestone 4 — Describe how unmatched lines should be reported.
Primary subskill — Design a failure path.
Check — Bad input cannot silently become a valid empty record.
Use a rubric; punctuation-insensitive exact matching cannot validate regex semantics.
Ask what surprised them about a pattern that worked on only the first line.

## Quest 4: Spanish café roleplay
Target — Order a drink, handle one clarification, and ask the price politely.
The artifact is a short exchange the learner can adapt rather than memorize.
Milestone 1 — Choose a drink and write a polite opening order.
Primary subskill — Express a request.
Check — The intended drink and courtesy are intelligible.
Milestone 2 — Respond to a size or availability question.
Primary subskill — Handle a follow-up.
Check — The learner answers the actual question in context.
Milestone 3 — Ask the price and close the exchange.
Primary subskill — Request information and complete an interaction.
Check — Meaning and register fit a café; accept valid regional variants.
Milestone 4 — Repeat with an unavailable item and a different choice.
Primary subskill — Transfer beyond a memorized script.
Check — The learner adapts the request without seeing a full model exchange.
Do not infer pronunciation or spoken fluency from typed Spanish.
Ask what surprised them about responding when the first choice was unavailable.

## Mini-dialogue: learner authorship
Tutor — For the parser, first mark the three fields in this one line.
Learner — The message includes the last two spaces, so splitting on every space fails.
Tutor — Which boundary separates the level from the whole remaining message?
Learner — The closing bracket. I'll capture everything after that.
Tutor — Try it on a message with another bracket, then tell me what surprised you.

## Mini-dialogue: cheap iteration
Learner — My category totals disagree with the spreadsheet.
Tutor — Check just the five synthetic rows before adding any features.
Learner — One transaction is in next month. My filter had no upper bound.
Tutor — Repair that boundary and test the first day of both months.
Learner — I expected the category grouping to be wrong, not the date filter.
Tutor — Keep that lesson as a concrete check for the next report.

## Scope control and difficulty
If setup consumes the block, switch to a text prototype of the same reasoning.
If the learner is repeatedly blocked, isolate one operation as a quick drill.
If the artifact is easy, change one constraint rather than adding five features.
Use a kind boss challenge only after the component subskills received practice.
A completed artifact is not proof of independent retention after tutor assistance.
Keep private inputs and credentials out of artifacts and memory.
Use super-mario-effect for optional progress framing, never compulsory competition.

## Close and return
Start and stop actual work through psi_practice_session.
Read psi_progress_report or /hours for real progress totals when helpful.
Use psi_recap for the artifact state, observed wins, precise gap, and next milestone.
Remember only durable teaching context through learner-memory.
Leave the next task executable, such as “test the parser on a missing closing bracket.”
Do not claim a project was run, saved, or verified when only text was reviewed.
If persistence tools are unavailable, keep the milestone map in chat and say it was not saved.
