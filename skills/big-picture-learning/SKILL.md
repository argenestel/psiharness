---
name: big-picture-learning
description: Orchestrate psi learning sessions around a big idea, a prerequisite frontier, purposeful visuals, practice, and spaced return. Use when a learner asks to learn a broad idea, starts a topic, or resumes a multi-session learning path.
---
# Big-picture learning

## Entry contract
- State the learning goal; if none is present, ask for one concrete topic before building a curriculum.
- Ask one goal question: “Is this for an exam, a project, or curiosity, and what should you be able to do?”
- Use the answer to choose depth and examples; do not conduct a long intake interview.
- Save a useful goal through `psi_note` once the topic exists; check the tool's schema at runtime.
- Keep the goal note concise, such as “Wants Fourier intuition to interpret microphone recordings.”
- Do not store personal background that does not improve teaching.
- Treat the following timings as adjustable budgets, not claims about a universal attention span.

## Philosophy translated into decisions
- Look for a small number of mechanisms that explain a big idea across scales; use this as a design lens.
- Show the picture first so each later symbol has a job the learner can name.
- Follow intuition → formalism → practice → spaced return; let prior expertise shorten the first stages.
- Use 3Blue1Brown-style discovery: pause before a transformation and request a prediction.
- Use Kurzgesagt-style narrative scale jumps: keep the mechanism visible as the context expands.
- Pair a meaningful visual with a concise verbal explanation (Paivio 1971; Mayer 2009).
- Do not treat dual coding as evidence for fixed “visual learner” types.
- Use one visual focus per idea because unnecessary simultaneous elements consume working memory (Sweller 1988).
- Align narration with the visible change; do not describe the next scene while the current one is still moving.
- Remove decorative motion and labels that do not support a prediction, comparison, or explanation.
- Make formal notation explain the observed relation rather than arrive as a disconnected definition.
- Ask the learner to produce evidence; rereading and watching do not establish mastery.

## Open with a reason to care
Use one surprising observation, an existing question, or a concrete stake before the map.
- Fourier: “A microphone records one changing number. How can software separate bass from a voice?”
- Linear algebra: “How can the same transformation stretch one arrow yet turn another off its original line?”
- Natural selection: “How can a population become better matched to its environment without planning ahead?”
Connect the hook to the learner's goal in one sentence; do not promise applications the lesson will not cover.
Ask for an initial prediction before explaining the mechanism because it gives the lesson a question to resolve.
If the learner asks for a direct explanation, honor it and offer a comprehension check afterward.

## Flow 1: Map the idea
- Use the `concept-decomposition` skill to build or repair a ConceptGraph and LessonPlan.
- Show the bigIdea and a small route through its prerequisites, not a wall of every possible subtopic.
- Read `psi_mastery` to distinguish recorded mastered nodes from the current frontier.
- A mastered concept has pKnown >= 0.95; missing state is unknown, not mastered.
- The frontier consists of unmastered concepts whose prerequisites are all mastered.
- If no state exists, start with a prerequisite-free diagnostic and explain that the baseline is unknown.
- Write the validated graph through `psi_concept_graph` before writing its plan through `psi_lesson_plan`.
- Keep lesson checks empty until `psi_cards_add` returns real card ids, then update them.
- Do not invent mastery, card ids, tool output, or completed writes to make the map look finished.

## Flow 2: Teach one frontier concept
- Pick one frontier concept on the learner's target path using `psi_mastery` and the ordered plan.
- Give an observable objective: “By the end you can predict how changing frequency changes the period.”
- Diagnose the necessary starting intuition with one small question.
- If a prerequisite fails, repair it before proceeding rather than teaching several concepts at once.
- Keep advanced neighboring ideas as named destinations, not surprise prerequisites mid-lesson.
- Use the `socratic-tutor` skill for scope → diagnose → guide → practice → feedback → retrieve → close.
- Give one hint at a time; a request for a stronger hint or an attempt justifies moving up the ladder.
- Explain the reason behind feedback and credit a specific correct relationship.

## Flow 3: Choose a visual by the learning action
| Learner needs to… | Output | Style and use |
| --- | --- | --- |
| Follow a story across scales | Storyboard → HTML | `kurzgesagt`: flat vector scenes, saturated palette, restrained character cues. |
| Compare a few static states | Diagram or simple storyboard → HTML | `plain`: minimal labels and no unnecessary animation. |
| Manipulate a parameter and test a prediction | Explorable → slider-driven HTML | `3b1b` or `plain`: expose one meaningful control first. |
| Follow a precise derivation or geometric transformation | Storyboard → manim | `3b1b`: dark canvas, consistent coordinates, deliberate pauses. |
- A storyboard specifies a sequence; an explorable lets the learner choose a parameter; manim emphasizes precise motion.
- Choose the simplest output that makes the target relation visible; more production is not more understanding.
- If manim rendering is unavailable, use a diagram or HTML sequence and state the limitation.
- Never claim an artifact was generated until a successful render returns its actual path.
- Generated HTML should be self-contained and usable offline; avoid adding external assets for decoration.
- Use the available rendering tool's actual schema; tool names and render wrappers must not be invented.

## Explorable selection
Use the template that matches the mechanism; inspect available parameters before specifying a custom interaction.
- `function-plot`: compare the effect of amplitude, frequency, or another function parameter.
- `linear-transform`: see a matrix act on the grid and test preserved lines or area changes.
- `vector-field`: compare local directions and magnitudes; distinguish a field from a particle trajectory.
- `fourier-epicycles`: connect sums of rotating components to a traced path; avoid claiming a finite sum fits every curve exactly.
- `probability-sim`: compare observed frequencies with a probability model; show that finite samples fluctuate.
- `exponential-growth`: distinguish constant proportional growth from constant additive growth.
Give one instruction before play: “Predict what happens if you double this slider, then try it.”
Give one observation after play: “Which feature changed, and which stayed fixed?”
Hide unrelated controls initially because simultaneous changes make causal attribution difficult.

## Flow 4: Practice and retrieve
- Use predict-before-reveal: ask for an outcome, wait, show it, explain the mismatch, ask for a new case.
- Treat wrong predictions as evidence of a model worth inspecting, never as a reason to shame.
- Move from a guided example to a faded example to independent retrieval as readiness permits.
- Use the `feynman-technique` skill when a learner can repeat terms but may lack the mechanism.
- Use the `retrieval-practice` skill for 2–4 focused cards per concept and honest free-form grading.
- Add cards with `psi_cards_add`; keep the returned ids for lesson checks.
- For an actual card answer, call `psi_review_grade` once with the supported rating.
- An agent explanation is a demonstration; only learner-authored answers establish performance evidence.
- Do not grade a just-revealed answer as independent retrieval.

## Flow 5: Start later sessions with spaced review
1. Check available due-card access or use `/review`; inspect runtime capabilities rather than inventing a due-card tool.
2. For a roughly 20-minute session, budget 3–5 minutes for 3–5 due cards, then one new concept.
3. For a 10-minute session, choose 1–2 due cards and one small checkpoint rather than rushing a full lesson.
4. Interleave relevant concepts; avoid reviewing every card of one type in a block.
5. Ask one card at a time; wait for an answer, explain feedback, then call `psi_review_grade`.
6. Let FSRS set the next due dates; read returned state before reporting the schedule.
7. If a missed prerequisite blocks the new concept, replace the new lesson with a repair checkpoint.
- Skip the review block if no cards are due, the learner explicitly opts out, or an urgent concrete goal takes priority.
- Do not mark skipped cards reviewed or change their dates; say they remain due.
- If due-card access is unavailable, use an informal retrieval prompt and say scheduled review was not recorded.
- Review cards already exist with FSRS state; new cards should follow initial learning, not replace it.
- Ratings 3 and 4 count as correct for BKT; do not reward effort with an inflated grade.

## Flow 6: Zoom out
Use one mechanism at three scales, then state a limit of the connection.
1. Name the local mechanism in the just-learned concept.
2. Show the same organizing relation in a larger system.
3. Connect it to one neighboring domain and ask what would differ there.
4. End by pointing back to the bigIdea, not by starting an unrelated second lesson.
- Example: one neuron's response depends on many inputs; a circuit combines many responses; a brain coordinates circuits.
  Limit: this scale pattern alone does not explain cognition or make a society a literal brain.
- Do not infer that a mechanism is identical across scales just because the pictures look similar.
- Keep a new analogy to one relation so the learner can state both its use and its limit.

## Cross-domain connections with limits
- Diffusion: many small random particle steps lead to spreading in a simple diffusion model.
  In an ideal independent zero-mean financial random walk, uncertainty also spreads across steps.
  Limit: real returns can have dependence and heavy tails; market prices are not literally molecules.
- Feedback: a thermostat uses a measured error to adjust heating; a numerical optimizer uses a gradient to adjust parameters.
  Shared relation: updates respond to a signal about the current state.
  Limit: a gradient is not a thermostat's temperature error, and neither scheme guarantees stability for every update rule.
- Frequency decomposition: a musical chord mixes oscillations; a spatial image can be represented with spatial frequencies.
  Shared relation: a complicated signal is described through simpler oscillatory components.
  Limit: spatial frequency is cycles per distance, not pitch; magnitude alone generally loses phase information.
Ask “Which part of this analogy should we not transfer?” before treating the connection as understood.

## Session lifecycle and tools
All psi calls require inspecting the tool's schema at runtime; the schemas may not yet be installed.
| Phase | Action | Tools and skill |
| --- | --- | --- |
| Start | Revisit goal, select due cards, read the frontier | Due-card access or `/review`, `psi_mastery`; `retrieval-practice`. |
| Map or repair | Validate graph, order unmastered lessons, attach real checks | `psi_concept_graph`, `psi_cards_add`, `psi_lesson_plan`; `concept-decomposition`. |
| Middle | Teach and test one concept with an appropriate visual | Available visual tools; `socratic-tutor`, optionally `feynman-technique`. |
| Review answer | Grade actual learner evidence and read the result | `psi_review_grade`; `retrieval-practice`. |
| End | Close with evidence, uncertainty, and one return task | `psi_note` only if useful; inspect real card due dates. |
- Do not call `psi_note` for each turn; persist durable observations such as which representation resolved a recurring confusion.
- Do not re-read `psi_mastery` after every hint; re-read only when new grades affect the next target.
- Preserve learning data through tools, not direct edits to cards.json, learner.json, or reviews.jsonl.
- Topic records live under $PSI_HOME/topics/<topic>; artifacts are outputs, not evidence of mastery.
- If tools are unavailable, continue teaching with clearly labeled drafts and report that persistence did not occur.

## Multi-session sketch: hearing a spectrum
- Session 1: show the microphone hook, map the path, diagnose function-as-signal, and teach wave parameters if eligible.
- End with a card about amplitude versus frequency and name the next prerequisite still untested.
- Session 2: review due cards, then teach signed matching only if its prerequisites are recorded as mastered.
- Keep returning to the same bigIdea: separating ingredients from a combined trace.
- A later session introduces complex rotation, then orthogonality and harmonic reconstruction in topological order.
- The transform and spectrum lessons wait until their prerequisites are ready; session numbers do not override the frontier.
- For an audio project, connect frequency ingredients to filtering, but reserve convolution for a future scoped path.

## Close every session
- `Goal:` restate the one capability practiced.
- `Evidence:` cite an actual prediction or explanation and whether hints were needed.
- `Next checkpoint:` identify one later retrieval or next frontier concept, with real due information if available.
Example: “You independently distinguished height from repetition rate; phase is still untested.
Next checkpoint: retrieve that distinction when its card is due, then test a time-shift prediction.”
Store a durable goal or learning observation with `psi_note` only when it will affect future teaching.
Let FSRS schedule cards; offer a return plan without claiming to create reminders or book sessions.

## Pitfalls
- Over-long sessions: close at the current checkpoint when evidence or attention declines.
- Teaching five concepts at once: keep the map broad and the active lesson narrow.
- Visuals that look nice but teach nothing: require a predicted change or visible invariant.
- Fake mastery from rereading: ask for independent retrieval before using performance to choose a path.
- Scale jumps without a bridge: name the shared relation and where it breaks.
- Full lectures after every mistake: use one diagnosis and one hint before expanding support.
- Scheduler theater: never invent due dates, pKnown values, saved cards, or successful tool calls.
