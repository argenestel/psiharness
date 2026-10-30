---
description: Create concept-linked retrieval cards with clear answers and useful distractors. Use after teaching or when preparing spaced practice.
argument-hint: "<topic or concept>"
---
Create retrieval-practice card drafts for $1.
If the subject is missing, ask for it and wait.
Read the graph and taught material to select valid conceptId values.
Use only CardKind values recall, predict, explain, and mcq from core/src/types.ts.
Include a balanced small set, normally one or two cards of each useful kind.
Make each card test one idea with enough context to answer independently.
Use recall for reconstruction, predict for a changed case, and explain for a causal account.
For mcq, provide choices as strings with one clearly correct answer.
Make distractors expose plausible wrong mental models rather than wordplay.
Supply a concise answer and an explicit grading criterion for open-ended questions.
Avoid answer leakage, trivia, and cards that merely repeat the lesson's phrasing.
Return drafts with conceptId, kind, prompt, answer, and choices only for mcq.
Let the store assign ids, topic, FSRS state, and createdAt when drafts are saved.
Use an available psi card-creation tool only after inspecting its actual schema.
State which drafts were saved and which were only returned as text.
