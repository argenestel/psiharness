# Linear algebra practice

For learners comfortable with arithmetic and basic algebra who want usable intuition through short attempts.

## Target performance

By hour 20, solve at least 16 of 20 fresh 2D vector and 2x2 matrix tasks in 45 minutes, predict orientation and area changes, verify an eigenpair, and write loop-based transformation functions that pass all assertions.

## Your first 20 hours

Spend 2 hours sketching and predicting, 10 hours on the eight subskills in prerequisite order, 4 hours revisiting misses with new numbers, 3 hours building and testing the Python quest, and 1 hour on the mixed boss and a teach-back.

## Subskill map

- `vectors` — Vectors as arrows; priority 1 (core); prerequisites: none.
- `span` — Linear combinations and span; priority 1 (core); prerequisites: `vectors`.
- `transform` — Matrices as transformations; priority 1 (core); prerequisites: `span`.
- `compose` — Composition and multiplication; priority 1 (core); prerequisites: `transform`.
- `determinant` — Determinant as signed area scale; priority 1 (core); prerequisites: `transform`.
- `inverse` — Inverse transformations; priority 2 (useful); prerequisites: `compose`, `determinant`.
- `eigen` — Eigenvectors and eigenvalues; priority 2 (useful); prerequisites: `transform`, `determinant`.
- `models` — Build transformation models; priority 2 (useful); prerequisites: `inverse`, `eigen`.

## How to start

1. `psi import-skill examples/skills/linear-algebra-practice`
2. `/skill`
3. `/practice`

Predict sign and rough size aloud, estimate, then compute. Open hints one at a time. Write one lesson after a miss; failures still earn progress. Repeat prompts with changed numbers instead of memorizing answers.

Numeric answers use the displayed unit and an absolute tolerance; enter the magnitude in that unit. Math answers have a live LaTeX preview and are matched against the listed forms after normalizing spacing, `\frac`, `\sqrt`, and `^{}`; if an equivalent form you typed is marked wrong, tell the tutor so it can be reviewed. Explain challenges (`kind: explain`, `format: text`) have no single canonical answer: the tutor grades your own wording against the rubric. Python exercises run setup, your code, then assertions without third-party imports; replace the starter stubs and test boundary cases. The `kind: build` exercise is the build quest; finish it before the `kind: boss` capstone.

## Free resources

- [3Blue1Brown — Essence of linear algebra](https://www.3blue1brown.com/topics/linear-algebra) — Geometric lessons on basis vectors, determinants, and eigenvectors; watch after attempting each subskill.
- [Khan Academy — Linear algebra](https://www.khanacademy.org/math/linear-algebra) — Free videos and exercises for vectors, matrix products, and inverses.
- [MIT OpenCourseWare — 18.06SC Linear Algebra](https://ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/) — Problem-solving videos and problem sets with solutions for determinants and eigenvalues.
