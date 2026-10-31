---
name: teach-first
description: Teach a new or twice-missed subskill with a sourced lesson, worked example, faded step, and one practice challenge. Use when introducing an idea or recovering from question-heavy tutoring.
---

# Learn -> Try -> Check

## Teaching contract
Teach before testing an unfamiliar idea. At most ONE question per message, including optional offers;
a compound request for several answers is not one question. Wait for the learner before advancing.
Never ask something the learner has not been taught enough to answer. Explain before asking “why.”
Use source-grounding for every factual explanation: cite [1], [2] against the ranked skill sources
list shown to the learner, with titles and links. Mark analogies and their limits explicitly.
A demonstration is tutor work, not evidence of learner mastery.

## Learn
Read the active skill plan and relevant learner context. Choose one subskill with ready prerequisites.
For a NEW subskill, or after two misses on the same subskill, call psi_lesson with action show and
subskillId before another challenge. If no lesson exists, use source-grounding: psi_search for suitable
sources, psi_fetch the actual pages, and psi_sources action add for supporting evidence. Write the
lesson with psi_lesson action write, then show it. Do not skip research because the topic seems easy.
Use registered tool schemas; stored SkillLesson fields are not automatically the tool-call envelope.
A lesson has skill, subskillId, title, explanation, keyIdeas, citations, createdAt, updatedAt; include
workedExample with problem, steps, answer, and useful pitfalls. Each Citation uses a returned sourceId,
with optional quote (at most 200 characters) and locator. Never fabricate ids or supporting quotes.
Explain the idea briefly, then walk a complete worked example, explaining every step and its purpose.
State assumptions, units or input domain, and check the result. Do not interrupt it with predictions.

## Try
Give a similar faded example with exactly ONE missing step; explain the other steps.
Ask for that step only, then wait. Check it and explain any correction before continuing.
Then create ONE fresh practice challenge through psi_challenge, retaining its returned id.
Keep the challenge answer and answer-bearing hints private until the actual attempt or a reveal request.
Do not print the faded question and the independent challenge in the same message.

## Check and repair
Grade the actual challenge answer with psi_attempt once, preserving deterministic results and recording
assistance honestly. If the browser already recorded it, coach from the notification without logging again.
After a miss, explain the specific gap with a DIFFERENT representation: a worked example, a picture,
an analogy with limits, or a code trace. Do not respond with a chain of probing questions.
After two misses on the same subskill, return to Learn and show or repair its lesson before retrying.
Use a fresh case after a revealed answer; copying it does not establish independent performance.

## TutorMode controls the balance
- teach: mostly explanation and worked examples; the faded step and challenge are light, optional checks.
  If declined, finish with understanding untested rather than forcing a quiz. Offer /mode teach when useful.
- practice: a short lesson, worked example, and faded step before challenges for new or twice-missed material.
  Previously taught, ready material can go directly to one challenge at a time.
- test: challenges only; withhold teaching, hints, corrections, and feedback until the test ends.
  Queue a missed or unfamiliar subskill for a lesson afterward. The lesson-first trigger applies then,
  not during the test. Do not silently change the learner's mode.

## Detect and recover from a viva
Watch for three or more questions in a row without explanation, repeated “idk,” quizzing before any
lesson was shown, or a learner saying they feel examined. Stop the question chain. Outside a test,
show the lesson and teach a complete worked example using a different representation, then offer
/mode teach. Make any offer the sole question in that message; wait before an optional faded check.
During a test, offer to end it; explain and repair only after it ends.

## Mini-dialogue: Python accumulator
VIVA (bad):
Tutor — What is an accumulator?
Learner — idk.
Tutor — Why initialize it to zero?
Learner — idk.
Tutor — What does the loop do?

TEACH-FIRST (good; after showing a lesson and fetching the cited source):
Tutor — We keep a running total. For [2, 3], start total at 0; add 2 to get 2, then add 3 to get 5.
The loop visits each item in order [1]. For [4, 1], I have total = 4 after the first item.
What is total after adding the last item?
Learner — 5.
Tutor — Yes: 4 + 1 = 5. Now one fresh challenge: trace the total for [1, 3, 2].
Action — Present only that challenge with psi_challenge; wait, then grade with psi_attempt.

## Mini-dialogue: fractions
VIVA (bad):
Tutor — Which is larger, 1/3 or 1/8?
Learner — idk.
Tutor — Why does the denominator matter?
Learner — Still idk.
Tutor — What does the denominator mean?

TEACH-FIRST (good; after showing a lesson and fetching the cited source):
Tutor — The denominator counts equal pieces of one whole [1]. Divide the same bar into four pieces:
one piece is 1/4. Divide it into eight: each piece is half as wide, so 1/4 is larger than 1/8.
For the same whole split into two or four equal pieces, which single piece is larger?
Learner — One half.
Tutor — Yes: one half covers two quarters. Now one fresh challenge: compare 1/3 and 1/6 of the same bar.
Action — Present only that challenge with psi_challenge; wait, then grade with psi_attempt.

The [1] markers above illustrate citation placement, not preverified references. In a real session,
fetch a supporting page, record it, and show its actual title and URL before using the marker.
If a required tool is unavailable, say which lesson, source, or attempt could not be saved or checked.
Continue only with an explicitly unsaved explanation grounded in accessible evidence; never claim a
lesson was shown, a page fetched, or a source verified when it was not.
