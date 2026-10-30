# Probability and statistics

For learners comfortable with arithmetic and basic algebra who want usable intuition through short attempts.

## Target performance

By hour 20, solve at least 16 of 20 fresh counting, conditional-probability, expectation, binomial, and z-score tasks in 45 minutes; explain a sampling-distribution prediction and build a reproducible simulation that passes its tests.

## Your first 20 hours

Spend 2 hours sketching and predicting, 10 hours on the eight subskills in prerequisite order, 4 hours revisiting misses with new numbers, 3 hours building and testing the Python quest, and 1 hour on the mixed boss and a teach-back.

## Subskill map

- `counting` — Count the sample space; priority 1 (core); prerequisites: none.
- `rules` — Probability rules; priority 1 (core); prerequisites: `counting`.
- `conditional` — Conditional probability and Bayes; priority 1 (core); prerequisites: `rules`.
- `moments` — Expectation and variance; priority 1 (core); prerequisites: `rules`.
- `binomial` — Binomial models; priority 2 (useful); prerequisites: `counting`, `moments`.
- `normal` — Normal distribution and z-scores; priority 2 (useful); prerequisites: `moments`.
- `sampling` — Sampling and CLT; priority 2 (useful); prerequisites: `normal`, `moments`.
- `simulation` — Simulation and model checks; priority 2 (useful); prerequisites: `conditional`, `binomial`, `sampling`.

## How to start

1. `psi import-skill examples/skills/probability-statistics`
2. `/skill`
3. `/practice`

Predict sign and rough size aloud, estimate, then compute. Open hints one at a time. Write one lesson after a miss; failures still earn progress. Repeat prompts with changed numbers instead of memorizing answers.

Numeric answers use the displayed unit and an absolute tolerance; enter the magnitude in that unit. Math answers have a live LaTeX preview and are matched against the listed forms after normalizing spacing, `\frac`, `\sqrt`, and `^{}`; if an equivalent form you typed is marked wrong, tell the tutor so it can be reviewed. Explain challenges (`kind: explain`, `format: text`) have no single canonical answer: the tutor grades your own wording against the rubric. Python exercises run setup, your code, then assertions without third-party imports; replace the starter stubs and test boundary cases. The `kind: build` exercise is the build quest; finish it before the `kind: boss` capstone.

## Free resources

- [Seeing Theory](https://seeing-theory.brown.edu/) — Interactive views of probability, distributions, and sampling; use it to check a prediction visually.
- [Khan Academy — Statistics and probability](https://www.khanacademy.org/math/statistics-probability) — Short videos and instantly checked exercises for counting, conditional probability, and z-scores.
- [OpenStax — Introductory Statistics 2e](https://openstax.org/details/books/introductory-statistics-2e) — Free worked examples for probability and introductory inference.
- [MIT OpenCourseWare — 18.05 Introduction to Probability and Statistics](https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/) — Reading questions and problem sets with solutions for Bayes, expectation, and the CLT.
