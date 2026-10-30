# Calculus intuition

For learners comfortable with arithmetic and basic algebra who want usable intuition through short attempts.

## Target performance

By hour 20, solve at least 16 of 20 fresh rate, derivative, optimization, and accumulation questions in 45 minutes; justify units and signs, and implement a derivative estimator and an area accumulator that pass their assertions.

## Your first 20 hours

Spend 2 hours sketching and predicting, 10 hours on the eight subskills in prerequisite order, 4 hours revisiting misses with new numbers, 3 hours building and testing the Python quest, and 1 hour on the mixed boss and a teach-back.

## Subskill map

- `rates` — Rates of change; priority 1 (core); prerequisites: none.
- `limits` — Limits by numbers; priority 1 (core); prerequisites: `rates`.
- `derivative` — Slope under a microscope; priority 1 (core); prerequisites: `limits`.
- `power` — Power rule; priority 1 (core); prerequisites: `derivative`.
- `product-chain` — Product and chain rules; priority 2 (useful); prerequisites: `power`.
- `optimization` — Optimization; priority 2 (useful); prerequisites: `product-chain`.
- `area` — Accumulated area; priority 1 (core); prerequisites: `rates`.
- `ftc` — Fundamental theorem; priority 2 (useful); prerequisites: `area`, `power`.

## How to start

1. `psi import-skill examples/skills/calculus-intuition`
2. `/skill`
3. `/practice`

Predict sign and rough size aloud, estimate, then compute. Open hints one at a time. Write one lesson after a miss; failures still earn progress. Repeat prompts with changed numbers instead of memorizing answers.

Numeric answers use the displayed unit and an absolute tolerance; enter the magnitude in that unit. Math answers have a live LaTeX preview and are matched against the listed forms after normalizing spacing, `\frac`, `\sqrt`, and `^{}`; if an equivalent form you typed is marked wrong, tell the tutor so it can be reviewed. Explain challenges (`kind: explain`, `format: text`) have no single canonical answer: the tutor grades your own wording against the rubric. Python exercises run setup, your code, then assertions without third-party imports; replace the starter stubs and test boundary cases. The `kind: build` exercise is the build quest; finish it before the `kind: boss` capstone.

## Free resources

- [3Blue1Brown — Essence of calculus](https://www.3blue1brown.com/topics/calculus) — Visual lessons on local change and accumulation; watch one chapter after attempting its challenges.
- [Khan Academy — Calculus 1](https://www.khanacademy.org/math/calculus-1) — Short videos and instantly checked exercises for limits, derivatives, and rules.
- [OpenStax — Calculus Volume 1](https://openstax.org/details/books/calculus-volume-1) — Free textbook with worked examples and odd-numbered answers for self-correction.
- [MIT OpenCourseWare — 18.01SC Single Variable Calculus](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/) — Problem sets with full solutions for optimization and the fundamental theorem.
