# Physics mechanics

For learners comfortable with arithmetic and basic algebra who want usable intuition through short attempts.

## Target performance

By hour 20, solve at least 16 of 20 fresh introductory mechanics problems in 50 minutes with a labeled force or motion sketch, consistent SI units, and a sign check; implement and test a no-drag projectile model.

## Your first 20 hours

Spend 2 hours sketching and predicting, 10 hours on the eight subskills in prerequisite order, 4 hours revisiting misses with new numbers, 3 hours building and testing the Python quest, and 1 hour on the mixed boss and a teach-back.

## Subskill map

- `units` — Units and estimation; priority 1 (core); prerequisites: none.
- `kinematics-1d` — One-dimensional motion; priority 1 (core); prerequisites: `units`.
- `kinematics-2d` — Two-dimensional motion; priority 2 (useful); prerequisites: `kinematics-1d`.
- `forces` — Newton and free-body reasoning; priority 1 (core); prerequisites: `kinematics-1d`.
- `friction` — Friction; priority 2 (useful); prerequisites: `forces`.
- `energy` — Work and energy; priority 1 (core); prerequisites: `forces`.
- `momentum` — Momentum and collisions; priority 2 (useful); prerequisites: `forces`.
- `circular` — Circular motion; priority 3 (later); prerequisites: `forces`, `energy`.

## How to start

1. `psi import-skill examples/skills/physics-mechanics`
2. `/skill`
3. `/practice`

Predict sign and rough size aloud, estimate, then compute. Open hints one at a time. Write one lesson after a miss; failures still earn progress. Repeat prompts with changed numbers instead of memorizing answers.

Numeric answers use the displayed unit and an absolute tolerance; enter the magnitude in that unit. Math answers have a live LaTeX preview and are matched against the listed forms after normalizing spacing, `\frac`, `\sqrt`, and `^{}`; if an equivalent form you typed is marked wrong, tell the tutor so it can be reviewed. Explain challenges (`kind: explain`, `format: text`) have no single canonical answer: the tutor grades your own wording against the rubric. Python exercises run setup, your code, then assertions without third-party imports; replace the starter stubs and test boundary cases. The `kind: build` exercise is the build quest; finish it before the `kind: boss` capstone.

## Free resources

- [OpenStax — University Physics Volume 1](https://openstax.org/details/books/university-physics-volume-1) — Free mechanics chapters with force diagrams and worked examples.
- [Khan Academy — Physics](https://www.khanacademy.org/science/physics) — Short explanations and practice on motion, forces, and energy.
- [MIT OpenCourseWare — 8.01SC Classical Mechanics](https://ocw.mit.edu/courses/8-01sc-classical-mechanics-fall-2016/) — Worked examples and problem sets with solutions for momentum, energy, and circular motion.
- [PhET — Projectile Motion](https://phet.colorado.edu/en/simulations/projectile-motion) — Free simulation to test projectile predictions before and after coding the model.
