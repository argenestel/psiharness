# Spanish café A1

Use a small set of reusable phrases in a real café interaction.

## Target performance

Complete a six-turn café exchange in Spanish: greet, introduce yourself, order a drink politely, ask its price, understand a price from 1 to 100, and thank the server; satisfy at least 5 of 6 checks in two roleplays.

## Subskill map

- `greet-introduce` — Greet and introduce yourself; priority 1; prerequisites: none.
- `order-drinks` — Order café basics; priority 1; prerequisites: `greet-introduce`.
- `numbers-prices` — Read numbers and prices; priority 1; prerequisites: none.
- `ser-estar` — Choose ser or estar; priority 2; prerequisites: `greet-introduce`.
- `polite-requests` — Make polite requests; priority 2; prerequisites: `order-drinks`.
- `cafe-roleplay` — Complete a café visit; priority 3; prerequisites: `numbers-prices`, `ser-estar`, `polite-requests`.

## How to start

1. `psi import-skill examples/skills/spanish-cafe-a1`
2. `/skill`
3. `/practice`

Practice in short rounds: attempt before opening hints, name one lesson after a miss, and retry. Use the build quest to combine skills, then try the boss. Failures still earn progress.

Numeric expected answers are stored as strings to match `Challenge.expected`; tolerances are absolute. Text answers use a canonical answer and listed variants. Equivalent solutions beyond those variants may need tutor review. Open tasks use rubrics.
