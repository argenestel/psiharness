---
name: first-20-hours
description: Deconstruct a practical skill into a focused 20-hour plan with self-correction and low-friction practice. Use when starting a skill or narrowing an unworkable learning goal.
---

# First 20 hours

## Teach before checking
Use teach-first for Learn -> Try -> Check and source-grounding for research and citations.
For a new subskill or after two misses on the same subskill, call psi_lesson action show; if absent,
research with psi_search and psi_fetch, record sources with psi_sources action add, write the lesson
with psi_lesson action write, then show it before the first or next challenge.
Explain a full worked example step by step; fade exactly ONE step in a similar example and wait.
Then present ONE fresh psi_challenge and grade the real answer with psi_attempt once, unless already recorded.
Ask at most ONE question per message, only on material taught sufficiently to answer; explain before asking why.
After a miss, re-teach using a different representation instead of asking more questions.
Cite every factual explanation as [n], mapped to the ranked skill sources list shown to the learner.
Fetch each cited page first; never invent evidence, ranks, or successful tool calls.
In teach mode, checks are light and optional; in practice mode, use a short lesson then challenges.
In test mode, give challenges only and defer teaching, hints, feedback, and triggered repair lessons until it ends.
If required tools are unavailable, disclose the gap and label any chat-only explanation or attempt unsaved.

## Purpose and limits
Use Josh Kaufman's method from The First 20 Hours (2013) and his TEDx talk.
Aim for a concrete useful performance, not expertise in twenty hours.
Twenty hours is a practice commitment, not a guaranteed learning deadline.
Read learner context with the learner-memory skill before proposing a schedule.
Use the practice-loop skill once a first drill is ready.

## Define the target performance
Use context to define the task, conditions, and success criterion; ask only one missing detail at a time.
Replace “learn SQL” with an observable output and a check.
Agree what is out of scope so the target fits the available time.
Use prior evidence for a baseline; for unfamiliar material, teach first before taking a tiny baseline attempt.
Keep a learner's existing target unless evidence shows it needs narrowing.
Use /skill for the learner-facing deconstruction entry.
Use psi_skill_plan with the registered schema to read or save the plan.
Persist the agreed target in targetPerformance, with its purpose in whyItMatters.
Do not invent tool actions or pass the stored object blindly as tool arguments.

## Deconstruct into the vital few
List the component actions needed to perform the target task.
Choose the small subset that unlocks the most useful early performance.
Give core subskills priority 1, useful extensions 2, and later material 3.
Use unique kebab-case ids and prerequisites that reference existing ids.
Avoid prerequisite cycles and do not unlock a dependent skill prematurely.
Each subskill needs a why, selfCorrection, drills, and a status.
Use locked, active, practicing, or solid exactly as defined by the contract.
A status of solid needs performance evidence, not time spent reading.
Save the decomposition through psi_skill_plan; /skill is the conversational route.
Start the first ready core subskill in psi_practice_session.

## Learn enough to self-correct
During skill creation gather and rank 3–6 relevant sources with source-grounding, each with a specific
correction job. Fetch the actual pages, record them through psi_sources action add, and show the
returned ranked list with its real rankReasons. Cite explanations as [n] against that list.
Write the first ready subskill's sourced lesson with psi_lesson action write, then show it before
the first challenge. A plan's resources field does not replace stored sources or lesson citations.
Prefer one reference, one example collection, and one feedback checklist.
A local worksheet may supplement those sources for self-correction; it does not replace fetched evidence.
Stop collecting resources once the learner can identify a likely error.
Read only the section that answers the current practice question.
For SQL, compare expected rows, grouping, and duplicate counts.
Write that comparison method in selfCorrection rather than “read more.”
Save resources through psi_skill_plan and return to psi_practice_session.
Use /hours to distinguish actual practice time from resource browsing.
Do not count a long research detour as progress toward the practice commitment.

## Remove practice barriers
Find one setup barrier, one distraction, and one emotional obstacle if relevant.
Prepare a tiny runnable dataset or a text-only substitute before the block.
Put the required prompt, reference, and test case within reach.
Reduce the first action to something achievable in a few minutes.
Treat “I will look foolish” as a reason for private low-cost attempts.
Do not store sensitive explanations of an emotional barrier.
Record only a safe actionable fix in barriers through psi_skill_plan.
Set done only after the fix has actually been made.
Use psi_practice_session to start when ready, then /hours to inspect logged time.

## Pre-commit without creating pressure
Invite a realistic twenty-hour experiment broken into small blocks.
For example, forty half-hour blocks can fit around other obligations.
The learner may revise or stop the experiment; consent is not a debt.
Store hoursGoal as 20 unless the learner chooses a different goal.
Use psi_practice_session to start, inspect, and stop actual practice.
Use /hours for logged hours against the goal; report returned values only.
Do not fabricate elapsed minutes, reminders, or completion streaks.
Review the target after several blocks, not only after hour twenty.

## Cross the frustration barrier
Warn that early clumsiness is expected when a skill is unfamiliar.
Separate discomfort from evidence that the task is too large.
After two misses on the same subskill, show or repair its sourced lesson before another challenge.
Shrink the task and re-teach with a different representation, not another question chain.
Give a complete demonstration when the learner lacks a starting model.
Follow the demonstration with a fresh case rather than copying it.
Stop for fatigue or a learner request; persistence must remain voluntary.
Record a useful adjustment through psi_recap at the end of the block.

## Worked SkillPlan for SQL queries
This is a complete stored SkillPlan example, not a tool-call envelope.
Dates are illustrative; use actual timestamps for a newly saved plan.
The resources are local learning materials, not claims of fetched content.
```json
{
  "skill": "sql-queries",
  "title": "SQL queries",
  "targetPerformance": "In 10 minutes, write a two-table JOIN with GROUP BY and verify totals on a small dataset.",
  "whyItMatters": "Answer weekly sales questions without copying an existing report.",
  "subskills": [
    {
      "id": "select-filter",
      "title": "Select and filter rows",
      "why": "Choose the correct records before combining or summarizing them.",
      "priority": 1,
      "prerequisites": [],
      "selfCorrection": "List matching row ids by hand and compare them with the query result.",
      "drills": ["Filter five orders by amount and status", "Predict which rows survive WHERE"],
      "status": "active"
    },
    {
      "id": "join-keys",
      "title": "Join orders to customers",
      "why": "Attach a customer to each order without accidental duplication.",
      "priority": 1,
      "prerequisites": ["select-filter"],
      "selfCorrection": "Match keys by hand and compare expected row counts, including unmatched keys.",
      "drills": ["Predict join rows for three orders", "Repair a join on the wrong key"],
      "status": "locked"
    },
    {
      "id": "group-totals",
      "title": "Aggregate by customer",
      "why": "Turn individual orders into the requested report.",
      "priority": 1,
      "prerequisites": ["join-keys"],
      "selfCorrection": "Sum each customer's orders by hand and reconcile the grand total.",
      "drills": ["Compute SUM per customer", "Explain why a duplicated join inflates SUM"],
      "status": "locked"
    }
  ],
  "resources": [
    {"title": "SQL clause reference", "why": "Check SELECT, WHERE, JOIN, and GROUP BY syntax."},
    {"title": "Five-row orders worksheet", "why": "Compare query results against hand calculations."},
    {"title": "Join debugging checklist", "why": "Check keys, unmatched rows, and duplicate multiplication."}
  ],
  "barriers": [
    {"barrier": "No practice database", "fix": "Prepare a disposable five-row dataset or work in text.", "done": false},
    {"barrier": "Notifications interrupt attempts", "fix": "Silence notifications for the chosen block.", "done": false},
    {"barrier": "Waiting to feel ready", "fix": "Start with one private row-count prediction.", "done": false}
  ],
  "hoursGoal": 20,
  "createdAt": "2026-10-30T09:00:00.000Z",
  "updatedAt": "2026-10-30T09:00:00.000Z"
}
```

## Mini-dialogue: narrowing the goal
Learner — I want to master databases in a weekend.
Tutor — Which task would make Monday easier?
Learner — A sales total for each customer.
Tutor — Let's target a checked two-table report; database administration can wait.
Learner — I can do twenty minutes after lunch.
Tutor — We'll first work a filter example, fill one missing step, then predict a fresh result.

## Mini-dialogue: frustration and correction
Learner — My join doubled the total. I am bad at this.
Tutor — The doubled total gives us a testable clue about matching rows.
Tutor — Here is a pair diagram: one order matches two customer rows on the name, so it appears twice.
Action — Ground that mechanism in a fetched SQL source, then offer a faded key-matching example.
Learner — I joined on the name instead of the id.
Tutor — Try the id on a fresh pair of tables, then check the row count.

## Close and return
Stop the session through psi_practice_session and inspect /hours if useful.
Use psi_recap for observed progress, the remaining gap, and one exact next drill.
Use learner-memory for durable preferences rather than copying the whole plan.
If tools are unavailable, provide a draft and state that nothing was saved.
