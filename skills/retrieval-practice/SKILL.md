---
name: retrieval-practice
description: Write focused retrieval cards, interleave due reviews, and grade learner answers honestly for FSRS and BKT. Use when preparing lesson checks, reviewing a topic, or converting an explanation into a test of later recall and transfer.
---
# Retrieval practice

## Purpose and boundaries
- Make the learner retrieve before showing the answer because retrieval strengthens later access.
- Retrieval can outperform repeated study for delayed retention (Roediger & Karpicke 2006).
- Continue retrieving after initial success rather than treating one correct recall as sufficient (Karpicke & Roediger 2008).
- Space returns across time because distributed practice supports retention (Cepeda et al. 2006).
- Interleave related problem types so learners must choose a method (Rohrer & Taylor 2007).
- Do not generalize that mathematics result into a promise that all mixing improves all learning.
- Seek useful effort, not confusion; difficulty is desirable only when learning remains possible (Bjork 1994).
- Use the `socratic-tutor` skill for feedback and hints and `feynman-technique` for longer teach-backs.
- Use the `concept-decomposition` skill to ensure every card links to a real concept.

## Minimum information
- Follow SuperMemo's minimum-information rule: test one fact or coherent mechanism per card.
- Give only enough context to make the requested answer unique; excess cues can replace recall.
- Keep assumptions that affect the answer, such as fixed temperature or independent trials.
- Split a card if its parts could be graded independently; keep a mechanism's essential steps together.
- Avoid yes/no unless identifying the distinction itself is the skill; require a brief reason then.
- Write standalone prompts because review order will differ from teaching order.
- Prefer a new case to a sentence lifted from the lesson because wording memory can hide weak understanding.
- Keep answer keys concise enough to grade consistently without demanding exact phrasing.
- Start with 2–4 cards per concept; add more only for a distinct error or transfer need.

## Four kinds of card
### recall
- Use for one fact, relationship, symbol meaning, or necessary definition.
- Template: “In [specific context], what does [term or symbol] denote?”
- Good prompt: “For a time signal, what does frequency measure?”
- Good answer: “The number of repeating cycles per unit time.”
- Bad prompt: “Define waves.”
- Bad answer: a paragraph containing speed, frequency, amplitude, phase, and examples.
- Reject the bad version because a partial answer cannot receive one interpretable grade.

### predict
- Use when a learner should apply a model to a changed condition before observing the result.
- Template: “Holding [conditions] fixed, what happens to [outcome] if [one change]?”
- Good prompt: “For y = 3 sin(2*pi*f*t), f is doubled. What happens to the period?”
- Good answer: “It halves because the period is 1/f.”
- Bad prompt: “Frequency doubles, so the period halves. What happens to the period?”
- Reject the bad version because it supplies the result instead of testing the model.
- State the held-fixed variables so different legitimate interpretations do not cause unfair grades.

### explain
- Use for a mechanism, a causal link, or a meaningful “why.”
- Template: “Why does [outcome] follow under [assumption]?”
- Good prompt: “Why can binary search discard the left half after finding the target exceeds the middle item?”
- Good answer rubric: “1. The list is sorted. 2. Every left-side value is no larger than the middle item.”
- Bad prompt: “Explain computer science.”
- Bad answer: a polished essay expected word for word.
- Write 2–4 must-have rubric points; accept equivalent words because the mechanism is the target.
- Keep those points parts of one explanation, not unrelated facts packed into a card.

### mcq
- Use to discriminate plausible competing models, especially a documented misconception.
- Template: “[Concrete case]. Which outcome and reason fit?”
- Good prompt: “For perpendicular nonzero vectors, what is their dot product?”
- Good choices: [“Zero”, “The product of their lengths”, “Always negative”].
- Good answer: “Zero: their projection on each other is zero; the length product fits parallel same-direction vectors; negativity requires an obtuse angle.”
- Bad prompt: “What is 2 + 2?” with choices [“4”, “a whale”, “Tuesday”].
- Reject the bad version because implausible distractors permit recognition without the intended knowledge.
- Use distractors that reveal misconceptions; explain why each distractor fails in the answer.
- Avoid “all of the above,” unequal answer detail, grammatical clues, and trick wording.
- Vary correct positions across the deck without a predictable cycle; keep answer and choices consistent.
- Follow recognition success with a prediction or explanation when the goal is a usable skill.

## Creating cards with psi
- Call `psi_cards_add` only for a known topic and graph concept; check the tool's schema at runtime.
- Card drafts contain conceptId, kind, prompt, answer, and choices only for mcq.
- Do not manufacture id, topic wrappers, FSRS state, or creation times; use the actual schema and returned ids.
- Keep the answer hidden from the learner until their attempt or explicit request for a reveal.
- Reuse an existing card when it already tests the target; duplicates bias review toward one idea.
- Save a good learner explanation as a new question and rubric, not as a transcript quotation.
- Supply returned ids to lesson `checks` through the lesson-planning workflow.
- Do not claim saved cards if the call failed; an unsaved draft can still support an informal check.

## Review selection and interleaving
1. Inspect available due-card access; check the runtime tools or `/review` command rather than inventing a tool name.
2. Select a handful of due cards across relevant concepts, prioritizing overdue and goal-relevant items.
3. Alternate concepts or problem types when possible; avoid exhausting one concept before switching.
4. Keep enough context to distinguish tasks, while avoiding headings that announce the solution method.
5. Ask one card, wait for the learner's answer, give feedback, and record one rating.
6. If a prerequisite fails repeatedly, pause the queue for a small repair lesson.
7. Return later to an unassisted case; do not inflate a grade because the repair went smoothly.
- Example order: projection recall → sine-wave prediction → projection application → phase explanation.
- Do not introduce arbitrary unrelated facts just to create variety; mixing should serve retention or discrimination.
- Start new learners with enough initial instruction to retrieve something meaningful before interleaving.
- See `big-picture-learning` for the session time budget and when review yields to a new concept.

## FSRS and due dates
- Existing cards carry `fsrs.due`; new cards begin with scheduler-managed learning state.
- FSRS-5 distinguishes new, learning, review, and relearning; do not hand-edit those states.
- Stability is the approximate interval where modeled retrievability reaches 90%, not a guarantee for this learner.
- Let the scheduler determine intervals after grading; do not invent tomorrow's due date or force a spacing formula.
- Prefer due cards at session start; add new cards sparingly after the learner has encountered the concept.
- An early informal explanation is evidence, but it is not automatically a scheduled card review.
- Do not create a review event for a card whose prompt was never answered.
- Keep a failed attempt's grade even if the learner can repeat the answer immediately after feedback.

## Rating rubric
Use these meanings consistently; explain the judgment briefly before recording it.
| Rating | Meaning | Evidence required |
| --- | --- | --- |
| 4 Easy | Correct, complete, independent, in own words | Mechanism is present where asked; no unresolved substantive uncertainty. |
| 3 Good | Correct core, with at most one minor gap repaired without prompting | No conceptual cue was needed; independent self-correction is allowed. |
| 2 Hard | Correct only after a conceptual cue, or significant gap remains | Some target knowledge is present, but the core is not independently secure. |
| 1 Again | Wrong, blank, or “I don't know” after a permitted cue | The learner has not produced a correct usable answer. |
- For simple recall, “mechanism” means the relationship actually requested, not an unasked essay.
- Do not penalize ordinary cautious wording or language fluency; “no hedging” means no unresolved claim ambiguity.
- A neutral request to repeat an inaudible answer is not a conceptual cue.
- A hint pointing to the needed concept is a cue; do not relabel it neutral clarification.
- If a learner initially cannot answer, offer one cue only if they want it, then assess the resulting evidence.
- If they decline a cue or request the answer, rate the failed retrieval 1 rather than manufacturing a response.
- After the correct answer has been revealed, repetition cannot upgrade that attempt.
- Ratings 3 and 4 count as correct for BKT; ratings 1 and 2 do not.
- Do not inflate a 2 to a 3 for encouragement because it changes mastery and the learning frontier.
- If grading is ambiguous, identify the missing rubric point with a neutral prompt; count substantive help as a cue.

## Borderline grading examples
Card: “Why does doubling a circle's radius multiply its area by four?”
Rubric: area scales with the square of radius; doubling gives a factor of 2 squared.
- Learner: “Area is pi*r squared, so twice r gives twice the area—wait, four times.”
  Grade 3: the learner independently repairs one algebra slip and supplies the core relationship.
- Learner: “It gets bigger because the edge is longer.” Tutor cue: “How does area depend on radius?”
  Learner: “On r squared, so it becomes four times as large.”
  Grade 2: correct only after a cue supplied the missing relationship.
- Learner: “Circumference doubles, so area doubles.” Tutor cue: “Consider the square on r.”
  Learner: “I still think it doubles.”
  Grade 1: the mechanism remains wrong after the cue; explain and return later to a new case.
Do not upgrade any of these because the learner agrees with the feedback.

## Recording a review
1. Retain the actual stored card id and the learner's response until grading is complete.
2. Apply the rubric to the response and assistance received, not the quality of the tutor's explanation.
3. Call `psi_review_grade` with the card identifier, rating, and any topic field required by its runtime schema.
4. Read the result before reporting success; FSRS scheduling and BKT updates happen through this call.
5. If the call reports failure, say the review is unrecorded; check status before retrying an uncertain write.
6. Read `psi_mastery` if the next lesson depends on whether a threshold was crossed.
Do not write learner.json or reviews.jsonl directly, and never report an invented pKnown.

## Example deck reference
Read [references/card-examples.md](references/card-examples.md) when you need domain patterns or distractor examples.
It contains exactly 30 standalone draft cards across all four kinds, not a ready-to-import topic graph.
Create or confirm their graph concepts before adding a selected card; do not import unrelated cards as one lesson.
Adapt assumptions and examples to the learner's goal while preserving a single testable target.

## Card anti-patterns
- A prompt that leaks the answer measures reading rather than retrieval.
- “Define X” with a long answer makes partial knowledge impossible to grade consistently.
- Cards copied from lesson text can reward phrase completion instead of understanding.
- Multiple independent facts make one rating hide which component failed.
- Ambiguous prompts punish a valid interpretation rather than reveal a learning gap.
- Recognition-only cards cannot establish a procedural or explanatory skill.
- A card without a valid concept link cannot update the intended mastery estimate.
- Predictable choice positions let a learner pass without evaluating the alternatives.
- Grading speed, confidence, or compliance instead of content distorts the schedule.
- Repeatedly drilling the same just-revealed answer manufactures fluency, not delayed retrieval.
