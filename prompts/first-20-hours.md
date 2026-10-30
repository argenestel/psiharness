---
description: Create a focused twenty-hour skill plan and begin a small diagnostic.
argument-hint: "<skill> [target and constraints]"
---
Use the first-20-hours skill for the skill named by $1.
Use the full request $@ to interpret the target and constraints.
If the skill is missing, ask for a concrete task the learner wants to perform.
Use learner-memory and psi_memory_recall for relevant context before repeating questions.
Define a testable good-enough performance and its purpose.
Deconstruct it into the vital few subskills with self-correction checks.
Choose three to five resources with distinct correction jobs.
Identify practice barriers and one immediate fix for each.
Offer a voluntary twenty-hour commitment in realistic short blocks.
Use psi_skill_plan with its registered schema to read or save the agreed plan.
Use /skill as the learner-facing planning route when helpful.
Start actual practice through psi_practice_session only when beginning a block.
Use practice-loop and psi_challenge for one diagnostic; wait for the answer.
Use psi_attempt to record the real response, not a simulated example.
Use /hours for returned logged time, not an invented completion estimate.
Close with psi_recap after the block and one exact next action.
If tools are unavailable, label the plan a draft and disclose that it was not saved.
