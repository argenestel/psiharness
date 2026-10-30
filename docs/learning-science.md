# Learning science

Why psi is built the way it is. Each section gives the finding, the evidence, and where psi applies it — in code
(enforced) or in prompts and skills (requested of the model). Prompt-level behavior depends on the model following
instructions; only the code-level parts are guaranteed.

## Josh Kaufman: the first 20 hours

Josh Kaufman's *The First 20 Hours: How to Learn Anything… Fast!* was published in 2013
([publisher](https://www.penguin.co.uk/books/186843/the-first-20-hours-by-kaufman-josh/9780670921935)).
His [TEDxCSU talk](https://www.youtube.com/watch?v=5MgBikgcWnY), published in March 2013, presents a practical
approach: choose a concrete performance target, deconstruct the skill, learn enough to self-correct, remove practice
barriers, and commit focused time. Twenty hours is a starting commitment toward useful competence, not a universal
threshold or a claim of expert performance.

**In psi.** Skill plans record a target performance, personal motivation, prioritized subskills, self-correction
drills, resources, barriers and fixes, and an hour goal. `/skill` asks about the learner's target, current level, and
time per day, then requests at most three resources. `PracticeStore` selects an unfinished subskill with solid
prerequisites and tracks time toward the goal (default 20 hours). Stored learner memory and recaps help the tutor
resume from previous struggles and insights.

## Mark Rober: the Super Mario effect

In his April 2018 [TEDxPenn talk, “The Super Mario Effect: Tricking Your Brain into Learning More”](https://www.ted.com/talks/mark_rober_the_super_mario_effect_tricking_your_brain_into_learning_more),
Mark Rober describes a coding challenge and argues for treating failures as part of reaching a goal, rather than as
judgments of ability. The game framing is psi's inspiration. Any dopamine-based explanation is an interpretation,
not something psi measures or a demonstrated mechanism of its XP system. This talk is not a controlled validation
of psi or a universal learning law.

**In psi.** `core/src/gamify.ts` assigns outcome bases of success 10, partial 6, fail 4, skipped 0. Multipliers are
quickfire 0.5, predict 1, debug/apply 1.2, explain 1.3, build 2, and boss 3. For a non-skipped attempt, XP is:

```text
max(1, round(outcome base × kind multiplier) + 2 × (learner level − 1) − 2 × max(0, hints used))
```

A failed attempt with a nonblank recorded lesson gets another 5 XP after that calculation. The level is the learner's
current progress level, not the challenge's difficulty. Skips always earn 0. Thus a level-1, no-hint quickfire failure
earns 2 XP; with a lesson it earns 7. Failure does not always earn exactly 4 XP.
`PracticeStore.recordAttempt()` applies the calculation and updates streaks and badges. The practice contract asks
for constructive feedback and what the learner will try differently. A lesson must accompany the recorded attempt;
there is no tool operation to retroactively award its bonus without recording another attempt.

## Deliberate practice

Ericsson, Krampe & Tesch-Römer (1993), “The Role of Deliberate Practice in the Acquisition of Expert Performance,”
*Psychological Review*, 100(3), 363–406, describes effortful activity designed to improve performance, with tasks,
feedback, and repetition rather than mere time spent. Its subject is expert performance; it does not establish
20 hours as an expertise threshold. [Original paper](https://review.firstround.com/content/files/images/blogs/freakonomics/pdf/deliberatepractice-psychologicalreview.pdf).

**In psi.** Plans name observable outcomes and self-correction methods; the tutor presents a challenge, waits for an
attempt, uses deterministic checking where possible, and grades open answers against a rubric. Build quests apply
subskills to a small project. These are deliberate-practice-inspired workflows, not a guarantee of expert coaching.

The host skills in `skills/practice-loop/SKILL.md` and `skills/super-mario-effect/SKILL.md` suggest roughly
**70–85% success over comparable independent attempts** as a practical difficulty heuristic. Neither
`core/src/practice.ts` nor `core/src/gamify.ts` implements that target, an adaptive difficulty controller, or a
scientifically established optimum. Hint-assisted retries should not be mistaken for independent successes.

## Limits of gamification

Rewards can sometimes reduce later intrinsic interest in an already enjoyable activity. Relevant early studies are
Deci (1971), “Effects of Externally Mediated Rewards on Intrinsic Motivation,” *Journal of Personality and Social
Psychology*, 18(1), 105–115 ([paper](https://selfdeterminationtheory.org/SDT/documents/1971_Deci.pdf)), and Lepper,
Greene & Nisbett (1973), “Undermining Children's Intrinsic Interest with Extrinsic Reward: A Test of the
‘Overjustification’ Hypothesis,” *Journal of Personality and Social Psychology*, 28(1), 129–137
([author's publication record](https://web.stanford.edu/~lepper/cv.html)). Effects depend on the reward and context;
these studies do not directly test psi's digital XP.

psi's existing safeguards are modest: plans retain the learner's own reason and performance target, build quests
focus on doing something useful, failures still earn XP, and a reflection bonus rewards a stated lesson. The practice
contract requests honest grading and forbids shaming mistakes. These design choices aim to keep attention on
learning; their effectiveness against overjustification has not been evaluated. XP, badges, streaks, and hours are
participation signals, not proof of competence. There is no implemented gamification-off setting.

## Optional concept and visual layer

The remainder describes spaced cards, concept mastery, and optional visual explanations.

The broad ranking that shaped psi: in Dunlosky et al.'s review of ten study techniques, **practice testing** and
**distributed practice** earned the only "high utility" ratings, interleaving and self-explanation "moderate", and
rereading and highlighting "low" (Dunlosky, Rawson, Marsh, Nathan & Willingham, 2013, *Psychological Science in the
Public Interest*, 14(1), 4–58).

## At a glance

| Principle | Key source | psi mechanism | Level |
| --- | --- | --- | --- |
| Retrieval practice | Roediger & Karpicke 2006 | Cards, `/review`, `/quiz`, `psi review`; mastery comes only from graded retrieval | code + prompt |
| Spacing | Cepeda et al. 2006 | FSRS-5 schedules every card | code |
| Memory model | FSRS (Ye et al. 2022) | `core/src/fsrs.ts`, default FSRS-5 weights | code |
| Knowledge tracing | Corbett & Anderson 1995 | `core/src/bkt.ts`, mastery at `pKnown ≥ 0.95`, frontier | code |
| Prerequisite order | Knowledge space theory | Concept DAG, `frontier()`, `pathTo()` | code |
| Interleaving | Rohrer & Taylor 2007 | Due queue mixes concepts; skills ask for mixed decks | partial |
| Dual coding | Paivio 1971; Mayer 2009 | Storyboards, explorables, Manim with narration | prompt + renderer |
| Worked examples, cognitive load | Sweller 1988 | One idea at a time, hint ladder, fading, `/tutor explain` | prompt |
| Predict before reveal | Slamecka & Graf 1978; Kornell et al. 2009 | `predict` cards, every lesson command, explorable prompts | prompt |
| Desirable difficulties | Bjork 1994 | Effortful recall, spacing, honest self-rating | code + prompt |

## Retrieval practice

**Finding.** Recalling information strengthens long-term memory more than restudying it, even though restudying feels
more effective. Students who took recall tests on prose forgot far less after a week than students who reread the
same text, while predicting the opposite (Roediger & Karpicke, 2006, "Test-enhanced learning", *Psychological Science*,
17(3), 249–255). Learners rarely choose retrieval on their own (Karpicke, Butler & Roediger, 2009, *Memory*, 17(4),
471–479).

**In psi.**

- In the optional concept layer, cards are the unit of BKT evidence: `recall`, `predict`, `explain`, and `mcq` kinds (`core/src/types.ts`).
- `/review` and `psi review` show the prompt first and reveal the answer only after an attempt; `/quiz` asks one
  question at a time.
- **Concept BKT mastery only moves through `PsiStore.review()` in the normal review flow.** Lessons, explanations, renders, and notes never mark a concept
  as known (`psi_note` explicitly "does not grant mastery").
- Free recall and explanation are favored over recognition; MCQs need plausible distractors
  (`skills/retrieval-practice/`).

## Spacing

**Finding.** Spreading practice over time beats massing it, and the best gap grows with how long you need to remember.
A meta-analysis of 317 experiments found robust spacing benefits and that the optimal gap is a fraction of the target
retention interval (Cepeda, Pashler, Vul, Wixted & Rohrer, 2006, *Psychological Bulletin*, 132(3), 354–380).

**In psi.** Each card carries its own schedule. A grade sets the next due date; `dueCards()` only returns cards whose
time has come. The `/daily-review` prompt frames a short daily session, and the concept widget shows the due count when tutoring is active.

## FSRS (when to review)

**Model.** FSRS describes each memory with three variables — difficulty, stability (days until recall probability
falls to 90%), and retrievability — and updates them after each rating (Ye, Su & Cao, 2022, "A stochastic shortest
path algorithm for optimizing spaced repetition scheduling", *KDD '22*). It descends from Woźniak's two-component model
of memory. FSRS-5 is maintained by the Open Spaced Repetition project and ships as an optional scheduler in Anki. Its advantage over
SM-2 style schedulers comes from the project's public benchmark on large review logs, not from controlled learning
trials.

**In psi.** `core/src/fsrs.ts` implements FSRS-5 with the 19 default weights, Anki-style ratings (1 Again, 2 Hard,
3 Good, 4 Easy), short learning steps (1/5/10 minutes for new cards), and intervals targeting 90% retention, capped at
100 years. Every review is appended to `reviews.jsonl`, so weights could be fitted later.

## Bayesian Knowledge Tracing (what is known)

**Model.** BKT treats each skill as a hidden known/unknown state, updated after each observed answer using four
probabilities: initial knowledge, learning per opportunity, slip (wrong despite knowing), and guess (right without
knowing). It drove mastery learning in the ACT Programming Tutor (Corbett & Anderson, 1995, "Knowledge tracing",
*User Modeling and User-Adapted Interaction*, 4(4), 253–278).

**In psi.** `core/src/bkt.ts` uses `pInit 0.2, pTransit 0.15, pSlip 0.1, pGuess 0.2`. A rating ≥ 3 is a correct
observation for the card's concept. A concept is mastered at `pKnown ≥ 0.95` — with these defaults, three
consecutive correct recalls from scratch (0.60 → 0.89 → 0.98). FSRS and BKT answer different questions: FSRS decides *when to return to a
card*, BKT decides *whether a concept unlocks what depends on it*.

## Prerequisite structure

**Idea.** Knowledge in a domain has a prerequisite structure; you are ready for exactly the items whose prerequisites
you know — the "outer fringe" (Doignon & Falmagne, 1985, "Spaces for the assessment of knowledge", *International
Journal of Man-Machine Studies*, 23(2), 175–196). Mastery learning likewise holds back new material until its
foundation is secure (Bloom, 1968, "Learning for mastery", *Evaluation Comment*, 1(2)).

**In psi.** The concept graph is a validated DAG. `frontier()` returns unmastered concepts whose prerequisites are all
mastered; `/lesson` teaches from it; `pathTo()` lists the unmastered ancestors of a target so the tutor can bridge gaps
first. Diagnosis comes before the graph so prior knowledge shapes the plan.

## Interleaving

**Finding.** Mixing problem types within practice improves the ability to choose the right method, even though
blocked practice feels smoother (Rohrer & Taylor, 2007, "The shuffling of mathematics problems improves learning",
*Instructional Science*, 35, 481–498; Kornell & Bjork, 2008, *Psychological Science*, 19(6), 585–592). The benefit is
largest for easily confused categories and is not universal (Brunmair & Richter, 2019, *Psychological Bulletin*,
145(11), 1029–1052).

**In psi.** Partial. The due queue is ordered by due time, not by concept, so reviews naturally mix concepts;
`psi review` with no topic mixes topics too. `skills/retrieval-practice/` asks for decks that contrast confusable ideas.
There is no explicit interleaving scheduler.

## Dual coding and multimedia

**Finding.** Information encoded both verbally and visually is remembered better than either alone (Paivio, 1971,
*Imagery and Verbal Processes*, Holt, Rinehart & Winston). Mayer's multimedia principles refine this: words plus
pictures beat words alone; cut decorative extras (coherence); put words next to what they describe (contiguity); let
the learner control pace (segmenting); avoid narrating text that is also printed on screen (redundancy) (Mayer, 2009,
*Multimedia Learning*, 2nd ed., Cambridge University Press).

**In psi.**

- Storyboards pair each scene's narration (as captions) with animated elements on screen.
- The player has scene-by-scene navigation, scrubbing, and pause (segmenting). Spoken narration is off by default, so
  captions are not doubled by speech.
- Skills ask that every visual have a `goal` ("what it must make obvious") and that 3b1b-style visuals *be* the math
  rather than decorate it (`skills/3b1b-visual-intuition/`).
- Explorables let the learner manipulate the relationship directly.
- Dual coding is not a license for "learning styles" — see below.

## Worked examples and cognitive load

**Finding.** Working memory is small. Novices learn more from studying worked examples than from solving the
equivalent problems, because unguided search consumes the capacity needed to form schemas (Sweller & Cooper, 1985,
*Cognition and Instruction*, 2(1), 59–89; Sweller, 1988, "Cognitive load during problem solving", *Cognitive Science*,
12(2), 257–285). Guidance that helps novices can hinder experts (expertise reversal: Kalyuga, Ayres, Chandler &
Sweller, 2003, *Educational Psychologist*, 38(1), 23–31), so support should fade (Renkl & Atkinson, 2003,
*Educational Psychologist*, 38(1), 15–22).

**In psi.**

- The teaching contract says "one idea at a time"; lessons are one concept each.
- `/lesson` asks for a fixed arc: hook → intuition → visual → formalism → check, so notation arrives after a mental
  model exists.
- `skills/socratic-tutor/` uses a hint ladder (smallest useful hint first), a short worked example for novices, and
  fading ("now predict the slope at π without repeating the formula").
- `/tutor explain` (more guidance) and `/tutor socratic` (less) let the learner pick the level of support.
- The intuition crew role must produce a concrete worked example in its brief.

## Predict before reveal (generation)

**Finding.** Information you generate is remembered better than information you read (Slamecka & Graf, 1978, "The
generation effect", *Journal of Experimental Psychology: Human Learning and Memory*, 4(6), 592–604). Even failed
attempts help if feedback follows (Kornell, Hays & Bjork, 2009, *Journal of Experimental Psychology: Learning, Memory,
and Cognition*, 35(4), 989–998; Richland, Kornell & Kao, 2009, *Journal of Experimental Psychology: Applied*, 15(3),
243–257). Committing to a prediction makes the surprise of being wrong informative (Brod, Hasselhorn & Bunge, 2018,
*Learning and Instruction*, 55, 22–31).

**In psi.**

- The teaching contract: "Ask the learner to predict before revealing."
- `/lesson`, `/visualize`, and `/learn` all request a prediction or diagnosis before content.
- `predict` is a first-class card kind.
- Explorable `prompts` tell the learner what to try *before* moving the slider.
- The intuition role structures discovery as observation → prediction pause → reveal ("you could have invented this").

## Desirable difficulties

**Finding.** Conditions that slow apparent progress — spacing, retrieval, interleaving, generation — often improve
long-term retention and transfer, while conditions that feel fluent can mislead learners about what they know (Bjork,
1994, "Memory and metamemory considerations in the training of human beings", in Metcalfe & Shimamura (Eds.),
*Metacognition: Knowing about Knowing*, MIT Press, 185–205; Bjork & Bjork, 2011, "Making things hard on yourself, but
in a good way", in *Psychology and the Real World*, Worth).

**In psi.** psi deliberately keeps the effort: answers stay hidden until you attempt them; reviews come back just as
recall is about to fail; `explain` cards and the `/feynman-check` prompt ask for self-explanation (Chi, de Leeuw, Chiu &
LaVancher, 1994, *Cognitive Science*, 18(3), 439–477) instead of re-reading. Ratings ask how recall *felt*
(Again/Hard/Good/Easy), and the tutor is told to grade only real attempts.

## What psi deliberately does not do

- **No mastery from exposure.** Finishing a lesson, watching a video, or giving a fluent explanation never marks a
  concept as known. Only graded retrieval does.
- **No learning styles.** psi does not tailor format to "visual" or "verbal" learners; matching instruction to
  self-reported styles lacks support (Pashler, McDaniel, Rohrer & Bjork, 2008, *Psychological Science in the Public
  Interest*, 9(3), 105–119). Visuals are used when the *content* is spatial or dynamic.
- **XP is not mastery.** Practice shows points, levels, streaks, hours, and badges; these do not update concept BKT mastery.
- **No hidden answer enforcement.** The model sees card answers; hiding them is an instruction, not a sandbox.
- **No personalized parameters yet.** FSRS weights and BKT probabilities are defaults, not fitted to you.
- **No forgetting in BKT, no transfer between concepts.** A mastered concept stays mastered until a wrong answer
  lowers it; mastering one concept does not raise its neighbors. FSRS handles forgetting at the card level.
- **Grading has limits.** Practice challenges with explicit expected answers are graded deterministically; open
  challenges need tutor judgment. Optional flashcard ratings remain self-reports or tutor judgments, not proof.
