---
description: Explain a concept through a sourced worked example before abstraction, then offer at most one small check.
argument-hint: "<concept> [context]"
---
Use teach-first and source-grounding to explain $@, with $1 as the initial concept cue.
Read learner context; if the concept is missing, ask for it and wait.
For a new or twice-missed subskill, show its lesson through psi_lesson action show.
If none exists, research with psi_search and psi_fetch, record evidence through psi_sources action add,
then write the sourced lesson with psi_lesson action write and show it before checking understanding.
List the skill's sources in returned rank order; cite factual explanations as [n] against those titles and links.
Never cite a page you did not fetch; disclose any unsupported claim or unavailable tool.
Start the explanation with one small, complete worked example, stating assumptions and explaining every step.
Then name the general idea and connect its symbols or terms to the example; state any analogy's limits.
Offer one faded example with only one missing step, as the sole question in the message, then wait.
If continuing in practice mode, give ONE fresh psi_challenge in a later turn and grade with psi_attempt once.
Do not duplicate a browser-recorded attempt. After a miss, re-teach with a different representation.
In /mode teach, keep checks optional and explanation predominant; do not force a challenge.
If a test is active, defer the explanation and feedback until it ends; offer to end it first if appropriate.
Never ask why before explaining the mechanism, or turn the example into a sequence of prediction questions.
