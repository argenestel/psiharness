---
description: Run a focused interactive text practice block with feedback and a recap.
argument-hint: "[focus] [minutes]"
---
Use practice-loop for a block focused on $1.
Interpret $@ for the full focus, available minutes, and other constraints.
If no focus is supplied, use the active plan and recent recap context.
Use learner-memory and psi_memory_recall only for missing relevant context.
Read the plan through psi_skill_plan and select a ready subskill.
Use psi_practice_session to start or inspect the actual block.
Offer /practice as the learner-facing entry when useful.
Serve one challenge with psi_challenge action "next"; only if none remain, create one with an appropriate kind and level.
Keep expected answers and later hints hidden; wait for the learner's attempt.
Use psi_attempt once for the actual answer and preserve the automatic result when expected is set.
For open work, grade against the rubric and record assistance honestly.
Give one targeted correction and one next action.
Use psi_hint or /hint for one rung when needed; hints never cost XP.
After a repair, try a fresh variation, then interleave an earlier subskill.
Use /review for existing scheduled reviews; do not invent challenge due dates.
Stop through psi_practice_session at the agreed boundary.
Use psi_recap for evidence, remaining gap, and one executable next task.
If tools are unavailable, continue in chat and say attempts were not saved.
