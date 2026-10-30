---
description: Guide a tests-first programming micro kata with learner-owned code and edge-case feedback. Use for Python, JavaScript, or SQL practice.
argument-hint: "<language> <subskill> [constraints]"
---
Use programming-tutor and interactive-challenges for a micro kata about $@.
If language or target behavior is missing from both arguments and context, ask one focused question and wait.
Choose one small behavior and state its input/output contract before implementation.
Ask for an output prediction on a tiny case before showing a result.
Design setup, a documented starterCode stub, and tests with a normal and relevant edge case.
Use clear throwing assertion messages for Python/JavaScript; do not use console.assert alone.
For SQL use SQLite syntax, in-memory seed rows, an explicit result-column contract, a reference tests query,
and expected JSON rows with deterministic ordering.
Use format code only when the actual psi_challenge schema and browser runtime support it.
Otherwise use supported prompt/rubric fields for chat practice and say tests were not executed.
Never compare learner source text with a canonical source solution.
Wait for the learner's implementation; never write or rewrite it for them.
On failure, inspect one error or counterexample and give one hint before they repair it.
On an already-recorded card notification, coach rather than repeat the card or submit a duplicate attempt.
After a pass, ask the learner to explain one edge case and reason about time/space cost with n defined.
End with one fresh variation or a concrete return task, not an unearned mastery claim.
