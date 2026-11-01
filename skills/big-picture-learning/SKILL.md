---
name: big-picture-learning
description: Orchestrate a text-first psi session from learner memory through due reviews, focused practice, and recap. Use as the entry skill when starting or resuming learning.
---

# Start with useful practice

## Teach before checking
Use teach-first for Learn -> Try -> Check and source-grounding for research and citations.
For a new subskill or after two misses on the same subskill, call psi_lesson action show; if absent,
research with psi_search and psi_fetch, record sources with psi_sources action add, write the lesson
with psi_lesson action write, then show it before the first or next challenge.
Teach in continuous chunks: explain, a full worked example, an optional faded step or ungraded psi_ask, then the
next chunk. "continue" or "just show me" means proceed without re-asking. End EVERY turn with psi_next_steps
(2–4 options, always including Continue). At the end of the subskill, present ONE psi_challenge (action "next"
first, "create" only if none remain) and grade the real answer with psi_attempt once, unless already recorded.
Ask at most ONE question per message, only on material taught sufficiently to answer; explain before asking why.
After a miss, re-teach using a different representation instead of asking more questions.
Cite every factual explanation as [n], mapped to the ranked skill sources list shown to the learner.
Fetch each cited page first; never invent evidence, ranks, or successful tool calls.
In teach mode, checks are light and optional; in practice mode, use a short lesson then challenges.
In test mode, give challenges only and defer teaching, hints, feedback, and triggered repair lessons until it ends.
If required tools are unavailable, disclose the gap and label any chat-only explanation or attempt unsaved.

## Session contract
Default to a short text exchange that gets the learner doing something.
The normal flow is welcome back from memory, due reviews, Learn -> Try -> Check, then recap.
Keep the learner's concrete target visible while teaching one subskill at a time.
Use demonstrations to prepare practice, not as evidence that the learner can perform.
Honor requests for plain feedback, explanations, shorter blocks, or stopping.
Use only available tools with their registered schemas and report actual returned state.
If a practice tool is unavailable, continue in chat and identify what was not persisted.

## 1. Welcome back from memory
Read the injected learner summary, active skill, and progress before asking for background.
Use learner-memory and psi_memory_recall for relevant context that is missing.
Open with one relevant goal, one observed previous win, and a proposed restart task.
Treat an old goal or inferred preference as revisable.
Ask about changed priorities only when they affect the next useful action.
Avoid reciting unrelated memories or displaying sensitive details.
If there is no history, ask for a concrete task, then teach a small example before checking understanding.
For a new skill, use first-20-hours and /skill to define a useful target and vital subskills.
Read or save the plan through psi_skill_plan rather than inventing an informal mastery state.
When creating a skill, gather 3–6 relevant sources using source-grounding. Fetch the pages, add them
with psi_sources, list them in returned rank order, and explain their actual rankReasons.
Write the first ready subskill's sourced lesson with psi_lesson action write and show it before
its first challenge; a resource list alone is not instruction. If ranking or saving is unavailable,
disclose that limitation rather than claiming a fully grounded saved skill.

## 2. Due reviews before new material
Use /review for existing scheduled reviews when available and relevant.
For a twenty-minute block, a few minutes of due reviews usually leaves room for new practice.
Present one question, wait for the answer, and let the available review workflow handle recording.
Do not invent review tool names, due dates, ratings, or queue operations.
If no cards are due, go directly to the practice block.
If the learner opts out or has an urgent task, leave the reviews due and say so.
If review access is unavailable, offer an informal retrieval question and label it unrecorded.
Use a missed prerequisite to choose a repair drill rather than piling on new material.
Do not treat a challenge attempt as an FSRS review of a stored card.

## 3. Choose a focused practice block
Use practice-loop for the complete challenge and feedback procedure.
Read the plan through psi_skill_plan and choose a ready subskill with solid prerequisites.
Start or inspect the session through psi_practice_session; /practice is the learner-facing route.
Agree a small target that fits the available time.
Choose kind and level from actual task evidence, not enthusiasm or XP alone.
Use psi_challenge to present a bounded challenge and retain its returned id.
Keep expected answers and later hints hidden until an attempt or an explicit reveal request.
Wait for the learner; never generate their answer to move the workflow along.
Use socratic-tutor only as an optional check after the relevant idea has been taught.
Use psi_attempt to grade and record the actual answer once.
Use psi_hint for the current hint rung and track assistance honestly.
Offer precise feedback, then a fresh variation that tests the same operation.
Interleave a previous subskill and return later to a weak one.
A learner who asks “just tell me” gets a compact explanation and an optional fresh check.

## 4. Make progress useful
Use super-mario-effect when low-stakes game framing helps this learner persist.
Failures can earn XP without becoming correct answers.
Read psi_progress_report for actual XP, badges, levels, and recorded progress.
Use /hours for logged practice against the agreed target when useful.
Stop game language if the learner wants plain mode or streaks become pressure; in psi web they can also set
the Game layer to Quiet or Off.
Use build-quests and /quest when a small real artifact would motivate practice.
Use /boss for bounded synthesis after the components have been practiced.
Do not declare mastery from one successful challenge or a completed tutor demonstration.

## 5. Recap and leave a restart point
Stop the active block through psi_practice_session so logged minutes are grounded.
Use psi_recap or the learner-facing /recap route for the session record.
Include observed wins, a precise remaining gap, and one executable next task.
Separate tutor assistance from independent performance in the summary.
Use learner-memory for a durable preference, recurring struggle, or explanation that clicked.
Save those items through psi_memory_remember only when they will affect future teaching.
Use psi_memory_forget for wrong or unwanted records; never silently preserve them elsewhere.
Do not save secrets, credentials, health information, or other sensitive data in memories or recaps.
If saving fails, leave the recap in chat and state that persistence did not occur.

## Optional extras when a picture is clearly needed
Choose a visual only when a specific spatial, dynamic, or scale relationship blocks understanding.
Try a tiny text example first when it can resolve the gap more cheaply.
Ask for a prediction before revealing a visual consequence.
Return to an independent text task afterward to check what transferred.
- storyboard-authoring creates a timed sequence when discrete visual changes carry the explanation.
- explorable-explanations supports a parameter change the learner needs to test directly.
- manim-scene-authoring supports a precise continuous mathematical transformation; rendering needs `psi_manim`,
  which exists only with `PSI_CODE_EXEC=1`. Without it, use an explorable or describe the motion in words.
- 3b1b-visual-intuition helps choose a revealing mathematical picture before formal notation.
- kurzgesagt-storytelling supports a science narrative when scale or sequence is the obstacle.
These are optional extras; generating an artifact is not the default lesson milestone.
Use /visualize or /explore only when the relevant visual workflow is available and appropriate.
Use concept-decomposition for a prerequisite map if it helps select practice.
When the learner names a longer goal, psi_path {action: list|get|create|next} builds or continues a learning path
over their knowledge graph (create with a targetId generates the prerequisite route; creating makes it active).
Use feynman-technique for a short teach-back, then check a fresh case.
Use retrieval-practice for retrieval design, using only currently listed available interfaces.

## Mini-dialogue: a returning learner
Tutor — Last time you caught duplicated join rows. We can test an unmatched-key case next.
Learner — I have fifteen minutes.
Tutor — Let's do one due review, then two small join predictions.
Learner — I still mix up LEFT JOIN and INNER JOIN.
Action — Show the lesson and fully work a LEFT JOIN, citing fetched sources from the skill list.
Tutor — Now we will fill one missing row in a similar example before an independent prediction.
Action — Ask for that row only and wait; after feedback, present a fresh psi_challenge and wait for its answer.

## Mini-dialogue: closing without inflated claims
Learner — The unmatched customer stays, with missing order values.
Tutor — You predicted that correctly without a hint. Aggregation after the join remains untested.
Learner — Can we start there next time?
Tutor — Next task is a three-customer total with one unmatched customer.
Action — Stop the actual session and save the supported recap through psi_recap.

## Stop condition
End with a demonstrated action, an honest uncertainty, and one clear return task.
Do not force another challenge after the learner's time budget is finished.
Never invent saved state, session minutes, review dates, or successful tool calls.
