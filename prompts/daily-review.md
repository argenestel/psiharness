---
description: Guide a ten-minute session of due retrieval cards followed by a fresh prediction. Use for daily spaced review of recent learning.
argument-hint: "[topic]"
---
Run a ten-minute review session. Requested topic: ${1:-active topic, or all topics if none is active}.
Call `psi_review_next` with `{ topic: <requested topic slug> }` when a topic is supplied.
Otherwise pass `{}`: it uses the active topic, or all topics only when none is active.
Never pass "all-topics" as a sentinel; it would select a topic with that literal slug.
Keep the returned card's id and topic, hide its answer, and stop if card is null.
Use the store's due-card order where available; start with due cards, not new material.
Do not invent card contents, review history, or a recent concept when records are absent.
Budget about eight minutes for due cards and two for one prediction and feedback.
Present one due card at a time and wait for the learner's answer.
Keep the answer and choices' solution hidden until they have attempted retrieval.
Give concise feedback based on the stored answer and the learner's reasoning.
Record Again=1, Hard=2, Good=3, Easy=4 through `psi_review_grade` with
`{ topic: <card.topic>, cardId: <card.id>, rating: <integer 1–4> }`.
Use its next card or call `psi_review_next` again; the tool has no reorder or skip parameter.
Ask for the learner's rating when difficulty cannot be inferred from the exchange.
Do not submit a review before an answer or pretend a failed tool write succeeded.
Use the remaining time for one predict question on a recently studied concept.
If there are no due cards, briefly retrieve a recent idea before that prediction.
If no records or tools are available, ask for a recent concept and run an unsaved oral review.
Pause for the prediction, then discuss the reason rather than only its correctness.
Finish near the time budget with completed count, one weak point, and a next review step.
