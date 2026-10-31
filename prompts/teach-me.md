---
description: Teach a topic with a sourced lesson, a complete worked example, one faded step, and an optional practice check.
argument-hint: "<topic>"
---
Use teach-first and source-grounding to teach $@, with $1 as the initial topic cue.
Use the active skill and learner context; if no topic is available, ask for it and wait.
Choose one reachable subskill and use psi_lesson action show with subskillId.
If no lesson exists, use psi_search to find suitable sources and psi_fetch to read the actual pages.
Record supporting sources through psi_sources action add, then list them in returned rank order.
Use actual source ids in lesson citations; explain factual claims with [n] mapped to the displayed titles and links.
Write the sourced lesson through psi_lesson action write, then show it before any challenge.
Walk a complete worked example, explaining every step and checking its result without interruptions.
Give a similar faded example with exactly one missing step; ask only for that step and wait.
After feedback, present ONE fresh psi_challenge, keep its answer private, and wait for the actual attempt.
Grade it with psi_attempt once; coach an already-recorded browser answer without resubmitting it.
After a miss, re-teach with a different representation; after two misses, return to the lesson first.
Ask at most one question per message, only about sufficiently taught material; explain before asking why.
With /mode teach, spend most of the exchange explaining; the faded step and challenge are optional.
With /mode practice, use the short lesson followed by checks. If a test is active, offer to end it first;
defer this teaching sequence and all feedback until it ends rather than silently changing modes.
If a required tool is unavailable, disclose what could not be read, checked, shown, or saved.
Never claim a sourced lesson exists or a verification ran without evidence.
