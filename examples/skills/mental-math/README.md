# Mental math

Make everyday calculations fast enough to check decisions on the spot.

## Target performance

Answer at least 18 of 20 mixed multiplication, percentage, and square prompts correctly in 8 minutes without a calculator, then give a Fermi estimate with explicit units and assumptions.

## Subskill map

- `multiply-eleven` — Multiply by eleven; priority 1; prerequisites: none.
- `multiply-five-twenty-five` — Multiply by five and twenty-five; priority 1; prerequisites: none.
- `percentages` — Compute percentages and changes; priority 1; prerequisites: `multiply-five-twenty-five`.
- `round-compensate` — Multiply near round numbers; priority 2; prerequisites: `multiply-eleven`.
- `squares-ending-five` — Square numbers ending in five; priority 2; prerequisites: `multiply-five-twenty-five`.
- `squares-near-base` — Square near fifty and one hundred; priority 3; prerequisites: `squares-ending-five`, `round-compensate`.
- `estimate-scale` — Estimate and check scale; priority 2; prerequisites: `percentages`, `round-compensate`.
- `fermi-models` — Build Fermi estimates; priority 3; prerequisites: `estimate-scale`.

## How to start

1. `psi import-skill examples/skills/mental-math`
2. `/skill`
3. `/practice`

Practice in short rounds: attempt before opening hints, name one lesson after a miss, and retry. Use the build quest to combine skills, then try the boss. Failures still earn progress.

Numeric expected answers are stored as strings to match `Challenge.expected`; tolerances are absolute. Text answers use a canonical answer and listed variants. Equivalent solutions beyond those variants may need tutor review. Open tasks use rubrics.
