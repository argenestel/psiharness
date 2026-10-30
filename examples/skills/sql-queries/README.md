# SQL queries

Answer business questions from a small relational shop database.

## Target performance

Write correct SQL for at least 9 of 10 schema-based prompts in 30 minutes, including joins, grouped filters, a subquery, and a window calculation.

## Subskill map

- `select-filter` — Select and filter; priority 1; prerequisites: none.
- `sort-limit` — Sort and limit; priority 2; prerequisites: `select-filter`.
- `join-tables` — Join tables; priority 1; prerequisites: `select-filter`.
- `group-having` — Group and filter aggregates; priority 1; prerequisites: `join-tables`.
- `subquery-tests` — Use subqueries; priority 2; prerequisites: `group-having`.
- `window-ranking` — Rank within groups; priority 3; prerequisites: `group-having`, `sort-limit`.
- `window-totals` — Calculate window totals; priority 3; prerequisites: `window-ranking`.

## How to start

1. `psi import-skill examples/skills/sql-queries`
2. `/skill`
3. `/practice`

Practice in short rounds: attempt before opening hints, name one lesson after a miss, and retry. Use the build quest to combine skills, then try the boss. Failures still earn progress.

Numeric expected answers are stored as strings to match `Challenge.expected`; tolerances are absolute. Text answers use a canonical answer and listed variants. Equivalent solutions beyond those variants may need tutor review. Open tasks use rubrics.
