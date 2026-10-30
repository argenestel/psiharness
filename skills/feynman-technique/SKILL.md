---
name: feynman-technique
description: Test understanding through learner teach-backs, novice questions, and focused rewrites that expose missing mechanisms. Use when a learner has finished a lesson, sounds fluent without explaining why, or needs an elaboration and retrieval checkpoint.
---
# Feynman technique

## Use a teach-back, not a performance
- Ask the learner to explain one concept to a curious novice in ordinary language.
- Use self-explanation to expose missing causal links (Chi et al. 1994).
- Frame teaching someone else as a reason to organize understanding, not as proof of mastery (Chase et al. 2009).
- Treat the “Feynman technique” as a practical routine, not a guarantee attributed to a single experiment.
- Place it after instruction or at a retrieval checkpoint in the `socratic-tutor` loop.
- Use `big-picture-learning` to explain why this concept matters before asking for a teach-back.
- Use `concept-decomposition` if the explanation exposes a missing prerequisite.
- Use `retrieval-practice` for cards, ratings, and scheduling after the learner supplies evidence.

## Set the novice role
- State the target and what the novice already knows so the learner can choose an appropriate explanation.
- Default to an attentive novice who can follow a concrete example but lacks the target terminology.
- Be curious, not deliberately obtuse; do not pretend to misunderstand an explanation that is clear.
- Ask “Wait, why does that follow?” at one specific transition, not after every sentence.
- Never supply the missing answer while playing the novice because that destroys the teach-back evidence.
- If instruction is needed, explicitly leave the role: “Tutor demonstration,” then give the example.
- Return to novice role only for a fresh, faded follow-up; label the demonstration as tutor work.
- Accept a sketch, short verbal explanation, or concise outline; never request hidden chain-of-thought.
- Allow technical terms after the learner grounds them in plain language and a concrete case.

## Opening prompt
Use one bounded invitation rather than demanding a polished lecture.
“Teach me why [mechanism] happens in four sentences or a sketch.
I know [prerequisites], but not [target term].
Give one example, then I will ask about one step I cannot yet predict.”
Example: “I know arrows and multiplication, but not eigenvectors; explain a direction a matrix preserves.”
Do not show an ideal explanation first when the goal is retrieval; it becomes a model to imitate.
If the learner has never encountered the idea, teach a small lesson before using this skill.

## Detect jargon
| Signal | What to ask next |
| --- | --- |
| Undefined term: “It is orthogonal.” | “What would I observe about the two arrows?” |
| Symbol without meaning: “Av = lambda v.” | “What does each symbol stand for in one example?” |
| “Obviously” or “clearly” | “Which fact makes that step follow?” |
| “It's just a change of basis.” | “What stays fixed, and what changes?” |
| “So basically, entropy.” | “What quantity are you describing in this particular system?” |
| Replacing one term with another | “Can you explain that without either term?” |
- Treat these signals as prompts to inspect meaning, not automatic evidence of misunderstanding.
- Ask for a plain-language definition and one concrete example, one at a time.
- Permit “scalar” if the learner can explain it as a number multiplying all vector components.
- Reject “a vector is an element of a vector space” as a novice explanation unless the space is grounded.
- Do not ban useful notation; ask the learner to connect it to observable consequences.

## Detect hand-waving
- “It converges”: ask what approaches what, under which conditions.
- “The rest follows”: ask for the single missing link between the last claim and the conclusion.
- “By magic”: ask which operation changes the input and what it preserves.
- Circular definition: “Fitness is survival of the fittest”; ask for reproductive outcomes without that word.
- “It works because it works”: ask for a prediction that could turn out false.
- “This always happens”: ask for a case near the boundary of the assumptions.
- Keep the question local because the learner can repair one gap more readily than a vague explanation.

## Gap-hunting question bank
Choose one question whose answer distinguishes two plausible models.
- “What would happen if X were zero?” checks boundary behavior.
- “Why not Y instead?” checks the direction of the mechanism.
- “Can you give a case where this breaks?” checks scope.
- “What changes if we double the input?” checks scaling.
- “Which assumption would make your explanation fail if removed?” checks dependence.
- “What stays the same when this changes?” checks invariants.
- “Can you predict this nearby case before calculating?” checks transfer beyond wording.
Do not ask a boundary question with a false premise; eigenvectors cannot themselves be the zero vector.
Distinguish the zero eigenvalue, which is allowed, from a zero eigenvector, which is not.

## Rewrite cycle
1. Read the learner's whole first explanation before choosing a gap; interruptions can destroy coherence.
2. Mark the 1–2 weakest links using the learner's words and the missing relationship.
3. Ask about the most important link first; save the second until the first is resolved.
4. Ask the learner to rewrite the explanation after that round, not merely append a slogan.
5. Compare the rewrite to the prior gap and request one new-case prediction.
6. Repeat only if the prediction exposes a specific remaining issue.
- Cap the routine at three rewrite cycles per concept because repeated struggle can stop being productive.
- Switch sooner if the learner requests a demonstration or lacks a necessary prerequisite.
- After three unsuccessful cycles, leave novice role, show a short worked example, then fade one step.
- Record that the example was assisted; do not upgrade the preceding retrieval rating.
- If the concept remains unclear, return to its prerequisite through `concept-decomposition`.

## Transcript 1: eigenvectors, eight turns
Learner — An eigenvector is when Av equals lambda v, so the direction stays the same.
Novice — I know arrows but not those symbols. What do A and lambda do to one arrow?
Learner — A is a matrix transformation; lambda is a number. If A doubles horizontal coordinates and triples vertical ones, (1, 0) becomes (2, 0).
Novice — That example helps me picture the line. What would a negative lambda do to your “same direction” claim?
Learner — It reverses the arrow. Rewrite: an eigenvector is a nonzero arrow whose output stays on the same line; it can stretch, shrink, reverse, or collapse to zero.
Novice — For your diagonal transformation, predict whether (1, 1) is an eigenvector, and state the condition you used.
Learner — It becomes (2, 3), which is not a scalar multiple of (1, 1), so it is a counterexample. The condition is that the output is one scalar times the original nonzero vector.
Novice — I can now predict that (0, 1) becomes (0, 3) and stays on its line. Your line condition explains both examples.
Tutor assessment: the learner repaired the direction/line gap after a targeted cue, so the full attempt is at most 2.
The novice's final prediction illustrates comprehension of the explanation; it is not additional learner evidence.
On a later unassisted card, test a different matrix before assigning 3 or 4.

## Transcript 2: compound interest, eight turns
Learner — Compound interest means money grows exponentially, so basically it earns more and more.
Novice — I can calculate a percentage but don't know “exponentially.” Why would the same rate give more money later?
Learner — With 100 units and 10% per period, interest is 10, so the balance becomes 110. Next period 10% of 110 is 11.
Novice — What assumption lets you include the earlier 10 when calculating that 11?
Learner — It stays in the account and earns interest too. Rewrite: each period we multiply the retained balance by 1 plus the rate; there are no withdrawals and the rate stays fixed.
Novice — Predict the next interest payment, then give a case where your “more each period” claim breaks.
Learner — The balance is now 121, so the next interest is 12.1. If I withdraw each interest payment, the principal stays 100 and interest stays 10; a zero rate also gives no growth.
Novice — I can predict the next payment by applying the rate to the new balance. Your retained-interest assumption distinguishes this from simple interest.
Tutor assessment: the numerical prediction is correct, but the mechanism was elicited with a cue; rate the full attempt at most 2.
A fresh delayed explain card can establish independent retrieval; do not average the tutor's help away.

## Exit criteria
Require all three kinds of evidence, using a fresh case rather than a repeated sentence.
- Prediction: the explanation enables a new-case prediction, and the learner justifies or checks it correctly.
- Contrast: the learner supplies one valid example and one counterexample to the relevant claim.
- Assumption: the learner identifies the one assumption that matters most for the stated mechanism.
Keep other necessary assumptions available; “one that matters most” does not mean there is only one.
If the novice can predict but the learner cannot handle a variant, the checkpoint remains incomplete.
If a prediction is correct by luck and conflicts with the explanation, ask for a second discriminating case.
Do not require a textbook speech when a short explanation meets these criteria.

## Rate and persist evidence
- For an existing card, apply the `retrieval-practice` rubric to the learner's response and help received.
- 4: complete independent mechanism in own words, with no unresolved substantive uncertainty.
- 3: correct core with one minor gap repaired independently, without a conceptual prompt.
- 2: success needs a conceptual cue or retains a significant gap.
- 1: wrong, blank, or unable to answer after an offered cue; a revealed answer does not repair the grade.
- Call `psi_review_grade` only for the actual answered card, using `{ topic: <card.topic>, cardId: <card.id>, rating }`.
  rating must be an integer from 1 through 4.
- A conversational teach-back without a card is formative evidence, not a fabricated review event.
- If worth retesting, call `psi_cards_add` with `{ topic, cards: [{ conceptId, kind: "explain", prompt, answer }] }`.
  Store the 2–4 point rubric as the answer string.
- Retain returned ids; do not create an invented prior card just to grade the current conversation.
- Use `psi_note` only for a durable observation, such as “distinguishes growth rate from absolute gain using balances.”
- Do not store the full transcript or turn a single vocabulary slip into a permanent learner label.
- Read `psi_mastery` when needed for the next target; never infer pKnown from teach-back fluency.

## Close the checkpoint
Use the `socratic-tutor` response shape when leaving the novice role.
- `Evidence:` state what the learner demonstrated and whether it was assisted.
- `Next checkpoint:` name one later unassisted prediction or explanation.
Example: “You explained retained interest after a cue; next time predict a balance with a different rate.”
Let the scheduler determine any stored card's next due date; do not manufacture a calendar promise.

## Avoid
- Rescuing the learner early: supplying a missing mechanism removes the evidence you were seeking.
- Expert jargon to appear smart: it raises the explanation burden without revealing the learner's model.
- Praising filler: acknowledge a concrete valid relationship instead of confident delivery.
- Playing a novice who cannot learn: coherent explanations should change what the persona can predict.
- Endless rewrites: switch to a worked example after three cycles and track the assistance honestly.
- Pretending all knowledge can be explained without terminology: ground terms rather than prohibit precision.
- Claiming independent mastery from a polished rewrite: editing with cues is different evidence from retrieval.
