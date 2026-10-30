---
name: concept-decomposition
description: Turn a big idea into a testable prerequisite graph and an ordered lesson plan with visual goals and card checks. Use when starting a topic, finding missing prerequisites, or repairing a learning path that skips necessary ideas.
---
# Concept decomposition

## Build a learning path, not a table of contents
- Start with the learner's desired capability; make it the graph's `bigIdea`.
- Treat that big idea as the conceptual destination or root of the explanation.
- Stored edges point prerequisite → dependent, so destination nodes are graph sinks, not sources.
- Treat prerequisite-free source nodes as conceptual leaves: prior capabilities or first intuitions.
- Do not mark those leaves mastered merely because they have no prerequisites.
- Make each node a single idea that can be tested independently.
- Add an edge only when the later idea cannot be understood at the chosen depth without the earlier one.
- Keep “related to,” historical order, and shared vocabulary out of prerequisite edges.
- An optional connection belongs in a zoom-out beat, not in a mandatory dependency.
- Use the `big-picture-learning` skill to establish motivation before expanding the graph.

## Granularity and difficulty
- Target roughly 6–14 concepts for a big idea because a small map remains inspectable.
- Expect one lesson and 2–4 focused cards per concept; use this as a split test.
- Split a summary that joins independent skills with “and”; grammar alone is not the criterion.
- Merge two nodes if no meaningful task can distinguish their understanding.
- Keep a learner's assumed background explicit; advanced background need not become dozens of nodes.
- Add a background node when a diagnostic exposes that assumption as false.
- Keep difficulty mostly non-decreasing along edges; investigate downward jumps for hidden compound nodes.
- Difficulty describes conceptual demand at this depth, not learner mastery or perceived prestige.
- Do not expand a practical introduction into a complete mathematical foundations course.

## Concept fields
| Field | Instruction and reason |
| --- | --- |
| `id` | Use a stable, unique kebab-case idea name so cards remain linked after title edits. |
| `title` | Use a readable noun phrase naming one idea so the map can be scanned. |
| `summary` | Write 1–2 plain-language sentences describing what the idea does. |
| `prerequisites` | List existing ids that must be understood first; use [] for sources. |
| `difficulty` | Use integer 1–5: introductory through research-level, relative to the chosen scope. |
| `intuition` | Give one concrete mental image or mechanism before notation. |
| `misconceptions` | List plausible wrong models that can become diagnostic questions. |
| `visualHooks` | Name drawable objects plus a meaningful change, comparison, or invariant. |
| `tags` | Optionally add a few reusable domain labels; avoid a second taxonomy. |

## Field contrasts
- id good: `dot-product-projection`; bad: `Chapter 3!!!`, which is neither stable nor kebab-case.
- summary good: “Projection measures the signed component of a vector along a chosen unit direction.”
- summary bad: “Vectors and all their applications,” which cannot support one lesson objective.
- intuition good: “A projection is the signed shadow a vector casts along a chosen direction.”
- intuition bad: “It is just a dot product,” which replaces an explanation with another term.
- misconceptions good: “Perpendicular vectors have the largest dot product.”
- misconceptions bad: “Learners find it hard,” which identifies no claim to probe.
- visualHooks good: “Rotate one arrow while its signed shadow shrinks to zero and reverses.”
- visualHooks bad: “A beautiful animation,” which specifies no learning-relevant relation.
- Use a misconception as a hypothesis to test, never a claim about this learner without evidence.

## Graph fields
- `topic`: stable kebab-case storage slug, such as `fourier-transform`.
- `title`: human-readable topic name, such as “Fourier transform.”
- `bigIdea`: a capability, such as identifying frequency structure in a time signal.
- `concepts`: the complete scoped node list; array order alone does not encode dependencies.
- `createdAt`: ISO-8601 creation time; preserve it when updating an existing graph.
- `updatedAt`: ISO-8601 time of the actual update; do not copy example timestamps into live records.
- Preserve existing ids where their meaning survives so cards and mastery stay attached.
- If semantics change enough to require a new id, reconcile affected plans and card links explicitly.

## Diagnose the starting point
1. Read `psi_mastery` for the topic; check the tool's schema at runtime.
2. Ask one sentence: “What does frequency describe in a signal?”
3. Ask one small prediction: “If a sinusoid repeats twice as often, what happens to frequency?”
4. Ask one context question: “Where have you seen a spectrum before?”
5. Use answers to identify candidate gaps and familiar examples, not to assign probabilities yourself.
6. If a stored card tests this capability, grade an actual answer through `psi_review_grade`.
7. Re-read state only when the target selection depends on the resulting update.
- Recorded `pKnown >= 0.95` means mastered; absent or lower state means unmastered for graph algorithms.
- A fluent diagnostic answer is provisional teaching evidence, not an invented mastery update.
- `frontier(g, mastered)` gives unmastered nodes whose prerequisites are all mastered.
- `pathTo(g, targetId, mastered)` gives unmastered ancestors plus the target in topological order.
- Choose one frontier node on the requested path; if state is missing, begin at a source diagnostic.
- If a recorded mastered prerequisite fails a fresh check, address the gap and record actual evidence.

## Worked graph: Fourier transform
This introductory path treats real, integrable time signals; rigorous function spaces are a later extension.
Sinusoids, signed matching, and accumulation prepare a finite-interval series before a continuous spectrum.
For a nonperiodic signal, the transform coefficient is generally complex; magnitude alone discards phase.
The following is a full valid ConceptGraph; timestamps are illustrative.
```json
{
  "topic": "fourier-transform",
  "title": "Fourier transform",
  "bigIdea": "Read which frequencies a time signal contains and explain how signed matching reveals them.",
  "createdAt": "2026-10-30T00:00:00.000Z",
  "updatedAt": "2026-10-30T00:00:00.000Z",
  "concepts": [
    {
      "id": "function-as-signal", "title": "A function as a signal",
      "summary": "A time signal assigns a value to each time in its domain.",
      "prerequisites": [], "difficulty": 1,
      "intuition": "A moving pen turns a changing measurement into a trace.",
      "misconceptions": ["The graph is the physical path the source travels."],
      "visualHooks": ["A microphone value draws a trace beside a moving time cursor."],
      "tags": ["signals"]
    },
    {
      "id": "sine-wave-parameters", "title": "Amplitude, frequency, and phase",
      "summary": "A sinusoid has a size, a repetition rate, and a position within its cycle.",
      "prerequisites": ["function-as-signal"], "difficulty": 2,
      "intuition": "One smooth repeating motion can be made taller, faster, or shifted in time.",
      "misconceptions": ["A louder pure tone must have a higher frequency."],
      "visualHooks": ["Change one sinusoid slider while freezing the other two parameters."],
      "tags": ["waves"]
    },
    {
      "id": "complex-rotation", "title": "Complex numbers as rotation",
      "summary": "A unit complex number represents a point rotating around a circle.",
      "prerequisites": ["sine-wave-parameters"], "difficulty": 2,
      "intuition": "Cosine and sine are the two shadows of one rotating pointer.",
      "misconceptions": ["An imaginary component cannot carry measurable phase information."],
      "visualHooks": ["Project a rotating pointer onto horizontal and vertical axes."],
      "tags": ["complex-numbers"]
    },
    {
      "id": "dot-product-matching", "title": "Dot product as signed matching",
      "summary": "The dot product adds coordinatewise products to measure signed alignment.",
      "prerequisites": [], "difficulty": 2,
      "intuition": "Matching signs add support while opposite signs subtract it.",
      "misconceptions": ["A dot product is always positive."],
      "visualHooks": ["Multiply two short bar arrays and stack positive and negative products."],
      "tags": ["linear-algebra"]
    },
    {
      "id": "integral-matching", "title": "Integral as accumulated matching",
      "summary": "Integrating a product accumulates signed matching continuously across time.",
      "prerequisites": ["function-as-signal", "dot-product-matching"], "difficulty": 3,
      "intuition": "Thin signed product slices replace a finite row of matching bars.",
      "misconceptions": ["Negative product areas should be made positive before integration."],
      "visualHooks": ["Refine product rectangles into a signed area under a product curve."],
      "tags": ["calculus"]
    },
    {
      "id": "sinusoid-orthogonality", "title": "Orthogonality of harmonics",
      "summary": "Distinct integer harmonics have zero integrated product over a common full period.",
      "prerequisites": ["sine-wave-parameters", "integral-matching"], "difficulty": 3,
      "intuition": "Mismatched harmonics cancel their positive and negative matches over a full cycle window.",
      "misconceptions": ["Different frequencies cancel exactly over every possible time window."],
      "visualHooks": ["Shade product lobes over a shared period and pair equal opposite areas."],
      "tags": ["waves"]
    },
    {
      "id": "change-of-basis", "title": "Describing a vector in another basis",
      "summary": "A basis changes the coordinates used to describe an object while preserving the object.",
      "prerequisites": ["dot-product-matching"], "difficulty": 3,
      "intuition": "The same arrow can be described using a different pair of measuring directions.",
      "misconceptions": ["Changing coordinates must physically rotate the represented object."],
      "visualHooks": ["Keep one arrow fixed while rotating the coordinate axes and updating coordinates."],
      "tags": ["linear-algebra"]
    },
    {
      "id": "fourier-series", "title": "Periodic signals as harmonic sums",
      "summary": "Suitable periodic signals can be represented by weighted integer harmonics.",
      "prerequisites": ["sinusoid-orthogonality", "change-of-basis", "complex-rotation"], "difficulty": 4,
      "intuition": "A complicated repeating trace can be assembled from simple synchronized rotations.",
      "misconceptions": ["Every waveform is reproduced exactly by a finite number of harmonics."],
      "visualHooks": ["Add harmonics one by one beside the changing partial sum of a periodic trace."],
      "tags": ["fourier"]
    },
    {
      "id": "continuous-fourier-transform", "title": "A continuous frequency description",
      "summary": "The Fourier transform matches an integrable time signal against complex rotations at each frequency.",
      "prerequisites": ["fourier-series", "integral-matching"], "difficulty": 4,
      "intuition": "Sweep a rotating test pattern through frequencies and record how strongly each one matches.",
      "misconceptions": ["A nonperiodic signal can contain only integer frequencies."],
      "visualHooks": ["Lengthen the observation window while harmonic frequency spacing narrows."],
      "tags": ["fourier"]
    },
    {
      "id": "reading-spectrum", "title": "Reading magnitude and phase",
      "summary": "A complex spectrum reports frequency-dependent magnitude and phase for a signal.",
      "prerequisites": ["continuous-fourier-transform"], "difficulty": 4,
      "intuition": "A spectrum is an inventory of rotating ingredients, including their timing.",
      "misconceptions": ["The magnitude spectrum alone uniquely determines the original signal."],
      "visualHooks": ["Shift a signal in time and compare unchanged magnitude with changed phase."],
      "tags": ["signals", "fourier"]
    }
  ]
}
```
For the transform lesson, state a convention before writing a formula:
`F(f) = integral x(t) exp(-2*pi*i*f*t) dt`, with integration over all real time.
Here f is cycles per time unit; angular frequency would use a different notation and normalization.
Do not promise convergence for every signal; pure infinite-duration sinusoids require a broader treatment.

## Build the LessonPlan
- Set `topic` to the graph topic, `goal` to the learner's capability, and `learnerLevel` explicitly.
- Choose learnerLevel from `curious`, `student`, `practitioner`, or `expert` using stated background.
- Include createdAt and updatedAt as ISO-8601 strings; preserve the original creation time on edits.
- Select the target path and order its unmastered concepts topologically.
- Create one lesson per selected concept; status starts `planned`, then `in-progress`, then `done`.
- Lesson completion tracks the activity; it does not override mastery.
- Write an objective beginning “By the end you can …” followed by a testable action.
- Use beats with `kind` and `text`; allowed kinds are hook, question, build, reveal, zoom-out, recap.
- Give each visual a kind, style, title, and goal; omit `path` until an artifact actually exists.
- Choose `3b1b` for precise mathematical changes, `kurzgesagt` for scale narratives, `plain` for a simple diagram.
- Use the `retrieval-practice` skill to create 2–4 cards through `psi_cards_add`.
- Put only returned, real card ids in `checks`; never invent placeholder ids.
- If cards are not yet created, use `checks: []` and explicitly describe the plan as awaiting checks.
- After card creation, update the plan to reference their ids and preserve lesson order.

## One lesson fragment before cards exist
```json
{
  "conceptId": "sine-wave-parameters",
  "objective": "By the end you can distinguish amplitude changes from frequency changes.",
  "beats": [
    {"kind": "hook", "text": "The same note can be quiet or loud."},
    {"kind": "question", "text": "Does making the wave taller change its repetition rate?"},
    {"kind": "build", "text": "Hold frequency fixed while changing amplitude."},
    {"kind": "reveal", "text": "Height and repetition rate are independent parameters."},
    {"kind": "zoom-out", "text": "A spectrum separates frequency ingredients from their sizes."},
    {"kind": "recap", "text": "Predict which slider changes pitch for a pure tone."}
  ],
  "visuals": [{"kind": "explorable", "style": "3b1b", "title": "One sinusoid", "goal": "Separate height from repetition rate."}],
  "checks": [],
  "status": "planned"
}
```

## Validate and persist
1. Check unique ids, known prerequisites, no self-edges, and no cycles before any write.
2. Use `validateGraph` when available; otherwise inspect dependencies and perform a topological check.
3. Call `psi_concept_graph` with the validated graph; check the tool's schema at runtime.
4. Confirm success, create needed cards, then call `psi_lesson_plan` with the ordered plan.
5. Validate topic, concept references, beat kinds, visual fields, and actual card ids before that call.
6. If validation fails, repair the reported edge or field and validate again before continuing.
7. If writing fails, report what remains unsaved; never claim a successful graph or plan from a draft.
Do not bypass psi tools by editing topic storage directly during a teaching session.

## Anti-patterns
- One giant “Fourier math” node hides the exact learning gap.
- A dependency on every earlier chapter creates false prerequisites and stalls the frontier.
- Omitting misconceptions leaves the tutor unable to distinguish plausible wrong models.
- Adding decorative visual hooks makes production busy without making understanding observable.
- Assigning mastery from a diagnostic bypasses evidence and corrupts the next frontier.
- Filling checks with imagined ids produces a plan that cannot retrieve its assessments.
