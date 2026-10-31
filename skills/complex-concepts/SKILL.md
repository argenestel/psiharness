---
name: complex-concepts
description: Make complex concepts approachable through familiar anchors, prerequisite chains, concrete examples, and retrieval. Use when introducing an unfamiliar idea or repairing a fragmented mental model.
---

# Learn a complex concept through small checks

## Teach before checking
Use teach-first for Learn -> Try -> Check and source-grounding for research and citations.
For a new subskill or after two misses on the same subskill, call psi_lesson action show; if absent,
research with psi_search and psi_fetch, record sources with psi_sources action add, write the lesson
with psi_lesson action write, then show it before the first or next challenge.
Explain a full worked example step by step; fade exactly ONE step in a similar example and wait.
Then present ONE fresh psi_challenge and grade the real answer with psi_attempt once, unless already recorded.
Ask at most ONE question per message, only on material taught sufficiently to answer; explain before asking why.
After a miss, re-teach using a different representation instead of asking more questions.
Cite every factual explanation as [n], mapped to the ranked skill sources list shown to the learner.
Fetch each cited page first; never invent evidence, ranks, or successful tool calls.
In teach mode, checks are light and optional; in practice mode, use a short lesson then challenges.
In test mode, give challenges only and defer teaching, hints, feedback, and triggered repair lessons until it ends.
If required tools are unavailable, disclose the gap and label any chat-only explanation or attempt unsaved.

## Find a starting point
Read relevant injected learner context; use psi_memory_recall only for missing context.
Use context for the target and familiar anchor; ask one missing detail only when needed.
If the prerequisite is unfamiliar, teach it before offering a small check.
Build a short prerequisite chain ending in an observable target: identify, predict, compute, or explain.
Check the earliest uncertain link and teach from there; do not lecture through known prerequisites.
Keep the whole chain visible in one line while working on just one link.

## Example before abstraction
Start with a small concrete case whose result can be checked by hand.
Introduce one new distinction at a time; define symbols only when the example needs them.
Connect representations rather than presenting five unrelated explanations:
- Verbal: say what changes and what stays fixed.
- Numeric table: show a few inputs and outputs or counts.
- Picture: sketch the relationship in text, or optionally use an explorable.
- Symbolic: name the same quantities and state assumptions.
- Code: express the same operation in a short traceable algorithm when useful.
Move between these as the learner needs them; using every representation is not a lesson quota.
In the worked example, calculate or execute and explain the result. Save predictions for the later faded
example or fresh challenge after the underlying idea has been taught.
Check the prediction against evidence and explain the precise discrepancy.

## Transfer ownership
Work one example, explaining the purpose of each step.
Fade one step in a similar example and ask the learner to complete it.
Then present one fresh independent psi_challenge and wait.
Keep expected answers and later hints private; do not count copying a worked example as retrieval.
Use a rubric for reasoning or teach-back; narrow exact checking to unambiguous short answers.
Probe a misconception with two cases that competing models predict differently.
After a miss, demonstrate the gap using a different representation before a fresh attempt.
Use analogies to connect to the anchor, explicitly naming where the analogy stops working.
After a success, interleave an earlier idea so the learner must choose the method.
Ask “Explain it back using a new example and one condition where it would fail.”
Return to the idea later; use psi_recap for a concrete next retrieval task.
Use /review only for existing scheduled reviews; challenges do not automatically acquire review dates.

## Optional maps and visuals
psi_concept_graph is defined in extension/src/tools.ts. Use it when branching dependencies obscure
where to start, with its actual topic/title/bigIdea/concepts schema. A one-line chain is often enough.
psi_explorable is defined there too and takes {spec: <complete ExplorableSpec>}.
Use it when changing a parameter or seeing a spatial relationship resolves a specific block.
Choose an existing template; ask for a prediction before changing a slider, then check transfer without it.
Neither a map nor an artifact is required before a quick psi_challenge.
Use a quick challenge when one small prediction can distinguish understanding from a misconception.

Use interactive-challenges for the typed card fields and tool-call envelope. Present one card and
wait for its recorded answer notification before coaching. If a client lacks card support, use a text
prediction or rubric-graded chat task and state any execution or persistence limitation.

## Mini-session: Fourier transform
1. Anchor: explain that a sound can combine multiple frequencies, citing a fetched source.
   Target: identify which trial wave is present. Chain: repeating cycles → sums of waves → correlation
   with a trial wave → frequency coefficients. Repair cycles or dot products first if needed.
2. Concrete worked example: take samples x = [1, 0, -1, 0]. A matching trial wave w has those values.
   A numeric table of x, w, and x·w gives products [1, 0, 1, 0], sum 2. A constant trial [1,1,1,1]
   gives sum 0. Say: “Alignment accumulates; opposite contributions cancel.”
3. Analogy: separating musical ingredients. Limit: Fourier coefficients measure amplitude and phase
   against basis waves, not literal instruments; different instruments can share frequencies.
   Sketch the samples, then name the dot product. Introduce the complex exponential only after
   sine/cosine matching is understood; distinguish finite DFT samples from a continuous transform.
4. Fade: give x = [2,0,-2,0], show products [2,0,2,0], and leave only their sum blank.
5. Challenge: create a text-compatible psi_challenge, kind predict, level 2, asking for the dot product
   of [0,1,0,-1] with [1,0,-1,0]; expected "0", with a hint to multiply corresponding samples.
   Wait before revealing the cancellation. Explain its meaning in feedback; save any misconception probe for a later turn.
6. Transfer: optionally show a supported Fourier explorable for synthesis, clearly distinguishing
   synthesis from analysis. Later interleave a dot-product question and ask the learner to explain
   why a single zero coefficient does not mean every coefficient is zero.

## Mini-session: Recursion
1. Anchor: show a familiar function returning a value. Chain: calls and return values →
   base case → smaller input → unwinding. Target: trace a recursive call and justify termination.
2. Work sum_to(2), where sum_to(0)=0 and sum_to(n)=n+sum_to(n-1) for nonnegative integers.
   Show a trace table: call 2 waits for 1; call 1 waits for 0; then returned values 0, 1, 3.
   Draw nested boxes, name the recurrence, then show the corresponding small function.
3. Analogy: nested requests passed back to the caller. Limit: real calls consume stack space;
   recursion is not simultaneous computation, and an absent base case need not terminate.
4. Fade sum_to(3): leave the final addition blank. Ask for the prediction before showing the result.
5. Challenge: psi_challenge, kind predict, level 1: “With that definition, what does sum_to(4)
   return?” expected "10"; first hint: find the immediately smaller call. Wait for the learner.
6. Probe: “Would replacing n-1 with n+1 reach the base case for input 4?” Use a rubric, not exact prose.
   Interleave a loop trace, then ask the learner to explain the base case and progress measure
   on a fresh recursive example. Do not rewrite their solution for them.

## Mini-session: Bayes' theorem
1. Anchor: show how to count a subgroup in a table. Chain: proportions → conditional denominator →
   joint counts → posterior. Target: find the chance of a condition after a positive test.
2. Work a population of 1,000: 10 have the condition; sensitivity is 80%, false-positive rate 10%.
   Show counts: condition positive 8, condition negative 2; no-condition positive 99, negative 891.
   Circle the positive column: 107 people, of whom 8 have the condition. Posterior is 8/107.
3. Name $P(H\mid E)=P(E\mid H)P(H)/P(E)$ and map every term back to the counts.
   Analogy: zooming into the positive-test bucket. Limit: a bucket's composition depends on
   prevalence and test rates; it is not an inherent property of the test alone.
4. Fade: keep the test rates and increase prevalence to 20 of 1,000. Show true positives = 16,
   no-condition count = 980, and leave only 10% of 980 blank. Wait before revealing 98.
5. Challenge: psi_challenge, kind apply, level 2, asking for the posterior as a decimal given 16 true
   positives and 98 false positives; expected "0.1403508772", tolerance 0.0005. Specify decimal,
   not a percentage number. Wait, then probe confusion between sensitivity and posterior.
6. Interleave a plain conditional-count question. Ask the learner to explain why an accurate test
   can still yield many false positives when the condition is rare. This is a learning example,
   not a diagnosis or an estimate for a real person's test.

## Close
Report what the learner independently demonstrated and which link still needs a check.
If tools fail, keep teaching in chat and state what was not saved.
