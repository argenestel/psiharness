---
name: big-picture-learning
description: Orchestrate a text-first psi session from learner memory through due reviews, focused practice, and recap. Use as the entry skill when starting or resuming learning.
---

# Start with useful practice

## Session contract
Default to a short text exchange that gets the learner doing something.
The normal flow is welcome back from memory, due reviews, a practice block, then recap.
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
If there is no history, ask for a concrete task and offer one tiny diagnostic.
For a new skill, use first-20-hours and /skill to define a useful target and vital subskills.
Read or save the plan through psi_skill_plan rather than inventing an informal mastery state.

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
Use socratic-tutor for a diagnostic question or one targeted hint.
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
Stop game language if the learner wants plain mode or streaks become pressure.
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
- manim-scene-authoring supports a precise continuous mathematical transformation.
- 3b1b-visual-intuition helps choose a revealing mathematical picture before formal notation.
- kurzgesagt-storytelling supports a science narrative when scale or sequence is the obstacle.
These are optional extras; generating an artifact is not the default lesson milestone.
Use /visualize or /explore only when the relevant visual workflow is available and appropriate.
Use concept-decomposition for a prerequisite map if it helps select practice.
Use feynman-technique for a short teach-back, then check a fresh case.
Use retrieval-practice for retrieval design, using only currently listed available interfaces.

## Mini-dialogue: a returning learner
Tutor — Last time you caught duplicated join rows. We can test an unmatched-key case next.
Learner — I have fifteen minutes.
Tutor — Let's do one due review, then two small join predictions.
Learner — I still mix up LEFT JOIN and INNER JOIN.
Tutor — Here are two customers and one order. Predict the rows from the LEFT JOIN first.
Action — Present the actual challenge through psi_challenge and wait for the answer.

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
