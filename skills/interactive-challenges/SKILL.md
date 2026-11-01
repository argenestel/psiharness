---
name: interactive-challenges
description: Design psi practice challenges with accurate fields, answer checking, hint ladders, and browser-code contracts. Use when authoring or coaching text, numeric, math, choice, or executable code cards.
---

# Interactive challenge field guide

## Source of truth and current availability
Read ../../core/src/types.ts for Challenge, ../../core/src/practice.ts for checkAnswer, and
../../extension/src/practice/tools.ts for the actual psi_challenge input schema.
Stored types and registered tool arguments are different contracts.

The registered psi_challenge takes action: "next" or "create" (default create). action "next" serves a ready
challenge chosen by the scheduler (new, due review, delayed retry, or one stretch item; difficulty adapts toward
roughly 70–85% success) and returns its reason; optional subskillId focuses it. Prefer "next" before creating.
For "create", kind, level, prompt, and hints are required in practice (the store validates them); optional fields
are skill, subskillId, expected, acceptable, tolerance, rubric, format, choices, unit, language, starterCode,
setup, tests.
Supply skill explicitly unless an active skill is already selected. It returns challengeId, skill,
and a widget for the browser. Stored types and registered arguments must not be confused.
The examples below are complete stored Challenge objects, not tool-call envelopes. To create one,
omit id and createdAt (store-generated) and send the remaining fields directly to psi_challenge.
If a client lacks cards or its runtime cannot load, fall back to chat without claiming execution.

## Exact Challenge fields
Required on every stored Challenge: id: string, skill: string, kind: ChallengeKind,
level: 1|2|3|4|5, prompt: string, hints: string[], createdAt: string (ISO timestamp).
Use a kebab-case skill slug. id and createdAt are supplied by storage on creation.
ChallengeKind is quickfire|predict|debug|apply|explain|build|boss; it describes the task,
whereas format describes the answer input. Choose level from task difficulty, not XP level.

Optional common fields: subskillId: string, expected: string, acceptable: string[], tolerance: number
(absolute numeric error bound), rubric: string[]. format is optional and defaults to text.
The remaining optional fields are choices: string[], unit: string, language: python|javascript|sql,
starterCode: string, setup: string, tests: string. There are no other Challenge fields.
The TypeScript interface does not enforce conditional requirements; the following are authoring
requirements for a usable card, not additional required properties in the interface.

| format | Format-specific fields and requirements for use |
| --- | --- |
| text | No extra fields; expected/acceptable for bounded answers, or rubric with expected omitted for open work |
| number | expected numeric string for automatic checking; optional unit and tolerance; acceptable for alternate forms |
| math | expected and optional acceptable for a finite set of symbolic strings, or rubric for open equivalence; optional unit/tolerance for numeric results |
| choice | choices containing distinct strings; expected must exactly equal one of them |
| code, python | language "python", starterCode stub, setup (may be empty), tests with throwing assertions; omit expected |
| code, javascript | language "javascript", starterCode stub, setup (may be empty), tests that throw on failure; omit expected |
| code, sql | language "sql", starterCode stub, setup schema/data, tests reference query, expected JSON rows encoded as a string |

Never add answer, correctIndex, options, solution, testCases, timeout, or a unit-conversion field.
Do not expose expected, acceptable, or answer-bearing hints in learner-visible introductory prose.
Dates and ids below are illustrative; use generated values for newly stored challenges.

## Text: bounded retrieval
```json
{
  "id": "example-text",
  "skill": "wave-basics",
  "kind": "quickfire",
  "level": 1,
  "prompt": "What is the SI unit of frequency? Give the unit name or symbol.",
  "expected": "hertz",
  "acceptable": ["Hz"],
  "hints": ["It measures cycles per second.", "Its symbol is Hz."],
  "format": "text",
  "createdAt": "2026-10-30T09:00:00.000Z"
}
```
For explain-it-back tasks omit expected and use rubric criteria; exact prose matching is inappropriate.

## Number: fixed units and explicit precision
```json
{
  "id": "example-number",
  "skill": "kinematics",
  "subskillId": "average-speed",
  "kind": "apply",
  "level": 1,
  "prompt": "A runner travels 100 m in 8 s. Give average speed in m/s, number only, to one decimal place.",
  "expected": "12.5",
  "tolerance": 0.05,
  "hints": ["Which quantity is distance per time?", "Divide the distance by the elapsed time."],
  "format": "number",
  "unit": "m/s",
  "createdAt": "2026-10-30T09:00:00.000Z"
}
```
unit labels the input; it does not parse or convert units. Put requested units and rounding in the prompt.

## Math: a finite set of accepted symbolic forms
```json
{
  "id": "example-math",
  "skill": "differentiation",
  "kind": "quickfire",
  "level": 1,
  "prompt": "Differentiate $x^2$ with respect to x. Enter 2x-style notation without dollar delimiters; no explanation.",
  "expected": "2x",
  "acceptable": ["2*x", "2 x", "2\\cdot x", "2 \\cdot x"],
  "hints": ["Apply the power rule.", "Multiply by the old exponent and reduce the exponent by one."],
  "format": "math",
  "createdAt": "2026-10-30T09:00:00.000Z"
}
```
The target card's live LaTeX preview is a display aid, not a symbolic equivalence grader.
Use inline $...$ and display $$...$$ in prompts; JSON must escape each LaTeX backslash as \\.

## Choice: diagnose a competing model
```json
{
  "id": "example-choice",
  "skill": "newtonian-motion",
  "kind": "predict",
  "level": 1,
  "prompt": "In an inertial frame, an object already moving has zero net force on it. What happens to its velocity?",
  "expected": "It stays constant.",
  "choices": ["It stays constant.", "It immediately becomes zero.", "It steadily increases."],
  "hints": ["Distinguish velocity from acceleration.", "Use net force = mass times acceleration."],
  "format": "choice",
  "createdAt": "2026-10-30T09:00:00.000Z"
}
```
Set expected to the complete choice text. Do not assume the interface sends a letter or index.

## Code: Python micro kata
```json
{
  "id": "example-code-python",
  "skill": "python-functions",
  "kind": "apply",
  "level": 1,
  "prompt": "Implement count_even(values) for a list of integers. Return how many entries are even; count duplicates separately. Keep the input unchanged.",
  "format": "code",
  "language": "python",
  "starterCode": "def count_even(values):\n    \"\"\"Return the number of even integers without changing values.\"\"\"\n    pass\n",
  "setup": "",
  "tests": "assert count_even([1, 2, 4]) == 2, 'Count both even entries'\nassert count_even([]) == 0, 'Empty input must return zero'\nassert count_even([0, -2, -3, 2, 2]) == 4, 'Include zero, negatives, and duplicates'\nvalues = [2, 1]\ncount_even(values)\nassert values == [2, 1], 'Do not mutate the input'\n",
  "rubric": ["Counts entries rather than distinct values", "Handles empty input", "Does not mutate input"],
  "hints": ["Test one integer for divisibility by two.", "Accumulate one for each even entry."],
  "createdAt": "2026-10-30T09:00:00.000Z"
}
```

## Code: JavaScript micro kata
```json
{
  "id": "example-code-javascript",
  "skill": "javascript-functions",
  "kind": "apply",
  "level": 1,
  "prompt": "Implement sum(values) for a finite array of numbers. Return zero for an empty array and do not mutate the input.",
  "format": "code",
  "language": "javascript",
  "starterCode": "/** Return the sum without changing values; empty input gives zero. */\nfunction sum(values) {\n  // Your implementation\n}\n",
  "setup": "",
  "tests": "if (sum([1, 2, 3]) !== 6) throw new Error('Sum all entries');\nif (sum([]) !== 0) throw new Error('Empty input must return zero');\nif (sum([-2, 0, 2, 2]) !== 2) throw new Error('Include negatives, zero, and duplicates');\nconst values = [2, 1];\nsum(values);\nif (JSON.stringify(values) !== '[2,1]') throw new Error('Do not mutate input');\n",
  "rubric": ["Returns a number", "Handles empty input", "Does not mutate input"],
  "hints": ["Choose the identity value for addition.", "Update a running total once per entry."],
  "createdAt": "2026-10-30T09:00:00.000Z"
}
```
console.assert is insufficient because it may only log; tests must throw on failure.

## Code: SQL with an explicit result contract
```json
{
  "id": "example-code-sql",
  "skill": "sql-aggregation",
  "kind": "apply",
  "level": 2,
  "prompt": "Write a SELECT returning name and total with one row per name in sales, ordered by name. Sum amount, treating an all-NULL group as zero. Duplicate amounts count separately.",
  "format": "code",
  "language": "sql",
  "starterCode": "-- Return name and total, grouped and ordered by name.\n-- Replace the zero placeholder with the aggregate.\nSELECT name, 0 AS total FROM sales GROUP BY name ORDER BY name;\n",
  "setup": "CREATE TABLE sales (name TEXT NOT NULL, amount INTEGER);\nINSERT INTO sales VALUES ('Ada', 2), ('Ada', 2), ('Ada', 1), ('Bo', NULL), ('Cy', -1), ('Cy', 1);\n",
  "tests": "-- ordered\nSELECT name, COALESCE(SUM(amount), 0) AS total FROM sales GROUP BY name ORDER BY name;",
  "expected": "[[\"Ada\",5],[\"Bo\",0],[\"Cy\",0]]",
  "rubric": ["One row per name", "Counts duplicates", "Treats an all-NULL group as zero"],
  "hints": ["Which aggregate adds all entries in a group?", "Consider what SUM returns when every amount is NULL.", "Use COALESCE to replace a NULL aggregate with zero."],
  "createdAt": "2026-10-30T09:00:00.000Z"
}
```
SQLite/sql.js uses in-memory schema and rows. expected represents result rows, not SQL source or
column metadata. Specify deterministic ordering and types; avoid reliance on backend-specific syntax.
Current SQL runner behavior differs from the generic setup/code/tests sequence in the type comment:
it compares the last learner-query result set with expected, or with tests on a pristine setup when
expected is omitted. It does not execute tests after learner SQL. Include "-- ordered" in tests to
enforce ordering; otherwise rows are compared as a multiset preserving types and duplicates.
The example supplies expected explicitly, so the reference query is illustrative; it is not executed
as a postcondition on learner-created views.

## Exact current grading behavior
checkAnswer returns undefined for format code, or when expected is absent or whitespace-only; a tutor must grade open
answers against rubric. Otherwise it considers expected and every acceptable candidate:
1. Lowercase and trim; convert Unicode dash/minus variants to ASCII minus.
2. Strip boundary whitespace, quotes, brackets/braces/parentheses, and the source's boundary sentence
   punctuation. Leading decimal points and signs survive; trailing periods are stripped. Internal
   punctuation survives. Trim again and collapse whitespace runs to one space.
3. Succeed on normalized string equality. Otherwise try numeric comparison: decimal numbers, valid
   comma-grouped thousands, one fraction slash with nonzero denominator, and trailing percent.
   Percentages are fractions: 75% = 0.75, not 75. Scientific notation, units, symbolic expressions,
   and LaTeX arithmetic are not numerically evaluated.
4. Accept absolute difference <= tolerance if supplied; otherwise <= 1e-9 * max(1, abs(candidate)).
   If no candidate matches, return fail. There is no automatic partial grade.

The comparator does not implement algebra, validate units, or run code. Its format branch only bypasses
code for sandbox grading. Avoid it for punctuation-sensitive syntax and case-sensitive identifiers.
For Python/JavaScript omit expected so the task is clearly test-graded, not a source-string target.
The browser runs setup, learner code, then tests for Python/JavaScript; completion without error passes.
SQL instead compares learner-query rows as described above. Failed assertions, execution errors,
or timeouts fail execution. Current limits are 5 seconds for JavaScript and 10 for Python/SQL.
The REST attempt route and psi_attempt use a browser-provided outcome for code, bypassing checkAnswer;
never invent a passing outcome or compare submitted SQL source with its expected JSON rows.
A browser execution result proves only the tested behavior; it is not a general correctness proof.

## Card behavior and coaching contract
In the web UI, the learner answers inside the card: numeric input has a unit label, math
has live LaTeX preview, choice has selectable answers, and code has an editor and browser execution.
After submission the agent receives a message of the form:
“Answered challenge <id>: … (<outcome>, +XP)”. Treat it as the already-recorded attempt notification.
Coach from its evidence: name a working part, explain one gap, and suggest a repair or fresh variation.
Do not repeat the card, ask for the same answer again, or call psi_attempt for that same submission.
A success on one case is not proof of mastery; a fail can still earn XP without becoming correct.
Do not invent XP amounts or infer execution output absent from the notification.
If the notification lacks enough evidence, ask for the relevant error or explanation, not another log.
In the present chat fallback, collect a real answer and call psi_attempt once with its actual evidence;
use an explicit rubric-based outcome only when deterministic checking is unavailable.

## Hint ladder
Put hints in increasing specificity: notice a feature → choose an operation/invariant → partial step.
Leave a meaningful learner action after each rung; do not open with a completed solution.
For a sum kata: “What result should empty input have?” → “Track a running total” →
“Initialize it to zero; what must happen for each entry?”
Use psi_hint with the actual challengeId, skill, and 1-based n to reveal one rung at a time.
Wait for an attempt or request before advancing; record assistance honestly.
Honor an explicit solution request with an explanation, then use a fresh case for independent retrieval.
