# Regular expressions

Turn text cleanup and log inspection into short, checkable experiments.

## Target performance

Solve at least 9 of 10 JavaScript regex tasks in 25 minutes: whole-string validation, captures, lookarounds, and extracting fields from a supplied log line.

## Subskill map

- `character-classes` — Choose character classes; priority 1; prerequisites: none.
- `anchors-boundaries` — Anchor matches; priority 1; prerequisites: `character-classes`.
- `quantifiers` — Control repetition; priority 1; prerequisites: `character-classes`, `anchors-boundaries`.
- `groups-captures` — Capture useful fields; priority 2; prerequisites: `quantifiers`.
- `alternation` — Choose alternatives; priority 2; prerequisites: `groups-captures`.
- `lookarounds` — Assert context; priority 3; prerequisites: `groups-captures`, `alternation`.
- `log-parsing` — Parse a log line; priority 2; prerequisites: `groups-captures`, `lookarounds`.

## How to start

1. `psi import-skill examples/skills/regex`
2. `/skill`
3. `/practice`

Practice in short rounds: attempt before opening hints, name one lesson after a miss, and retry. Use the build quest to combine skills, then try the boss. Failures still earn progress.

Numeric expected answers are stored as strings to match `Challenge.expected`; tolerances are absolute. Text answers use a canonical answer and listed variants. Equivalent solutions beyond those variants may need tutor review. Open tasks use rubrics.

Patterns use the JavaScript flags and samples stated in each prompt. Return raw patterns without slash delimiters. Lookbehind tasks require an engine with lookbehind support. IP and timestamp tasks validate shape only.
