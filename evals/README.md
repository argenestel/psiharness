# Tutor-contract evaluations

This harness measures **adherence to psi's tutor contract**, per scripted learner session. It does not measure
learning outcomes, demonstrate superior teaching, or modify the tutor to repair failures. Treat failures as evidence
to inspect alongside the raw event stream.

Requires Node >= 22.18, `pi` on PATH (or `PSI_EVAL_PI`), and the chosen provider's credentials in the normal pi
configuration or environment (for example `XAI_API_KEY`). No installation or runtime dependencies are needed.

```sh
node evals/run.ts --dry-run
node evals/run.ts --list
node evals/run.ts --scenario python-foundations-first-lesson --model xai/grok-4.6
node evals/run.ts --concurrency 4
node evals/run.ts --scenario sql-lab-select-sort --repeat 3 --concurrency 3
node evals/score.ts evals/results/<timestamp>
node evals/score.ts evals/results/<timestamp> --json
node evals/keys.ts
node --test evals/test/*.test.ts
```

`npm test` does not include `evals/`. Dry runs validate all selected inputs without spawning pi or accessing a model.
The default model is `xai/grok-4.6`; override with `--model` or `PSI_EVAL_MODEL`. Repeat `--scenario`, or supply a
comma-separated list. `--out <directory>` overrides the shared invocation output directory. Results are ignored by git.
`--concurrency N` (default 1) runs up to N scenario sessions at once; each has its own `PSI_HOME`, cwd, pi child,
trace and summary file, so parallel runs (and separate invocations sharing `--out`) never write the same file.
`--repeat K` runs every selected scenario K times: traces become `<id>.r<k>.jsonl` and the report adds mean and
min–max range across repeats per check, overall, and per scenario.

Each scenario run writes `<id>[.r<k>].jsonl` and `<id>[.r<k>].summary.json` (the run result plus its run-health
score). There is no shared `summary.json` any more; `score.ts` merges the per-scenario summaries (and still reads a
legacy `summary.json` for runs that no per-scenario file covers) into the report's **Run summaries** table.

Each scenario imports a pack through the real CLI into a fresh temporary `PSI_HOME`. Pi also gets a separate empty
temporary working directory, preventing this repository's `AGENTS.md` from becoming learner-facing tutor context.
Absolute extension, skill and prompt paths, the web tool policy, `PSI_WEB_READ_ROOT`, and RPC mode preserve web-chat
fidelity. Environment variables, including provider credentials, pass through. Code execution defaults **off**, even
if the parent has `PSI_CODE_EXEC=1`; pass `--code-exec` to enable it. `--keep` retains temporary directories for inspection.
`PSI_EVAL_PI` may name a binary or an absolute `.ts`/`.mjs` fake, launched with the current Node executable.

Each JSONL line is `{turn, attempt, at, record}`: `at` is receipt time in epoch milliseconds;
`record` contains the raw pi event or a `harness_*` record. Turn indices and attempt numbers come from the runner,
not pi's internal turns.
Both attempts remain in the log when a model error triggers the single retry; scoring uses the last attempt.
Timeouts abort the turn and remain run-health failures. Dialog requests are cancelled with their original IDs.
The runner waits for `agent_settled`, since `agent_end` can precede retries or queued work. A `"handled"` prompt gets
a 60-second grace period for `agent_start` or `agent_settled`; if neither arrives it settles at response time.
The ordinary per-turn deadline is 240 seconds. Child shutdown closes stdin, then forcefully kills after five seconds.

## Scenarios and answers

Scenarios are JSON files with `id`, `title`, repo-relative `skillPack`, `turns`, and
`expectations: {subskills: [...], notes: "..."}`. Each turn has a learner `message` and a `kind`:
`teach`, `continue`, `show`, `challenge`, `wrong_guess`, `stuck`, `correct_answer`, `verify`, `answer`, or `other`.
Scoring uses the kind rather than inferring intent from the message. The ten sessions cover Python (3), SQL (3),
calculus (2), and Spanish (2), including repeated continuation, repair, and a later-subskill request. Every scenario
asks "Give me a challenge on this." before its first wrong guess and "Give me another challenge on this." before its
correct answer (an attempt closes a challenge, so each graded answer needs a fresh one). The second request follows a
`stuck` turn, never a `wrong_guess` turn, so the repair check still sees teaching before the next challenge.

Answer keys are keyed by challenge ID in `answer-keys/<pack-slug>.json`, with `correct` and `wrong` strings.
**Answer turns are dynamic.** For `correct_answer` and `wrong_guess` the runner finds the open challenge just before
sending the turn: the latest successful `psi_challenge` `tool_execution_end` `details.widget` (type `challenge`),
unless a successful `psi_attempt` for it has been seen since; otherwise `state.json`'s `openChallenge` if that id was not
attempted. It sends the verified `correct` key (or the plausible `wrong` one) verbatim; only when no challenge is open
or the open one has no key (a model-created challenge) does it send the scripted message, with a `harness_warning`.
Each answer turn logs `harness_answer {mode: dynamic|fallback, challengeId, openFrom: widget|state}`; the report's
"Dynamic answers" column and the run summary count them. The actual persisted state
uses `openChallenge: {skill, id}` and `activeSkill`, although the task description called it `challengeId`;
the runner also accepts that legacy shape and writes normalized `harness_state.challengeId`.

All 91 bundled challenge IDs have keys, verified by `node evals/keys.ts` (and `test/keys.test.ts`) against the packs'
own grading: `PracticeStore.checkAnswer` from `core/src/practice.ts` for text/number/math/choice, and for code the
pack's reference behaviour as the browser runners apply it — Python runs `setup` + key + `tests` (assertions) in fresh
globals; SQL runs `setup` + key in a fresh in-memory SQLite and compares the last result's rows with `expected`
(unordered unless the tests say `-- ordered`). Every `correct` key must grade `success` and every `wrong` key must
not. 86 keys are machine-checked (22 Python, 24 SQL, 22 calculus, 18 Spanish). The first verification found four
`wrong` keys that actually passed (`ch-exceptions-2`, `ch-sql-top-prices`, `ch-sql-above-average`,
`ch-sql-bought-mug`: the seeded data hid the mistake); they were replaced with wrong answers the checker rejects.
Keys the pack cannot grade deterministically (two calculus explanations, three Spanish explanations/dialogues, all
rubric-graded) carry an explicit `"skip"` reason; the verifier fails any unmarked unverifiable key and any `skip` on
a deterministically gradable one. A code challenge without a reference (no tests / no expected rows) would be skipped.

## Checks

| Check | Rule |
| --- | --- |
| 1. Teach first | Show/write a lesson for a subskill before its first challenge. |
| 2. One question | At most one sentence-ending question mark plus `psi_ask` per scripted turn. |
| 3. Next steps | Last tool is `psi_next_steps`, with 2–4 options including a continuation label. |
| 4. Continue/show | Teaching content precedes a question or challenge; empty non-teaching turns fail. |
| 5. Citations | Factual teaching sentences cite `[n]` markers, all within pack + session-added source bounds. |
| 6. No spoilers | Open challenge expected answers do not appear in buttons or tutor text before the learner answers. |
| 7. Attempt once | At most one `psi_attempt` per challenge in a session and per turn. |
| 8. Repair | After a wrong guess, teach before issuing another challenge. |
| 9. Latency | Report TTFT, settlement time, tool calls and attempts; informational only. |

Run health reports incomplete/error/timeout turns separately from contract scores. Each contract score is
passes / (passes + failures). Scenario overall scores average applicable contract checks; the aggregate overall
averages aggregate check ratios. N/A and latency do not inflate the score. `report.md` has, in order: aggregate checks
(with the number of scenarios where each check was N/A, and repeat spread when K > 1), one contiguous scenario table
(score, dynamic answers, guard interventions, run health), run summaries, per-scenario detail sections, latency,
failures, explicit N/A items, run health and parse errors. Every failure names its scenario; position evidence is
labelled `event seq`, the 1-based record number in that scenario's JSONL trace. `--json` adds `score.json`.

**Guard interventions.** The extension records corrective actions as pi custom session entries with
`customType: "psi-guard"`; in RPC mode they arrive as `entry_appended` records. The scorer counts them per scenario
and per turn (entries between turns are counted as "between turns") and reports 0 when there are none. They are
informational: a guard-corrected turn still scores on what the learner finally saw.

## Interpretation and limits

Question and citation detection are heuristics. Question counting excludes fenced/inline code and double-quoted
text. Continuation/repair teaching text is a non-question sentence of at least 40 characters; continuation also accepts
`psi_lesson` or `psi_run`. Factual explanations use a 60-character sentence threshold (sentences are split on line
breaks too, so list items stand alone) and omit verdicts, questions and meta/instructional prose: invitations and
next-step offers ("Don't peek", "Try this", "Your turn", "We can…", "Next…", "Let's…") and remarks about the tutoring
machinery (challenge, card, attempt, graded, hint, XP, button…). These thresholds miss short explanations and can
misclassify prose. The one-question metric totals a scripted turn,
which can contain several assistant messages, so it is stricter than a literal per-message interpretation.

Citation indices are bounded by the pack's source count plus distinct sources the tutor added this session with
`psi_sources add` (URLs already in the pack do not count); this is not semantic support. A failure lists the valid and
invalid markers and the bound. The lesson tool numbers its own citations locally; the scorer follows this count.
Lesson calls and other tool calls are adherence signals, not proof their output was pedagogically useful.
Spoiler matching depends on the expected answer: numbers (any length, including "0") match as whole numeric tokens
(not inside `x=3`, `30`, `x^3`, or citation markers like `[3]`); choice answers match their text and their label as
"answer is B" / "option B" / "(B)" — a label only counts when the other labels are not listed the same way, and labels
are case-sensitive; math answers match with whitespace removed; other text matches literally after normalization
when it has at least four characters. Challenges that cannot be matched — code without `expected` (Python tests),
SQL row sets, rubric answers, short text — are N/A and listed explicitly with the reason. Challenge-prompt text is
removed, and in a learner answer turn only tutor text after the first `psi_attempt` counts (echoing the learner's
own answer before grading is not a spoiler). Paraphrases are not detected. Wrong guesses come from verified keys
when a keyed challenge is open; otherwise they are scripted and do not adapt to the model. `/verify` can be extension-handled without a run;
the current implementation sends a user message that usually starts one. No learning outcomes are measured.

The injected contract mentions `id/skill` for an open answer while `psi_attempt` actually requires `challengeId`.
It also distinguishes already-saved browser/card answers from pending answers. The runner submits raw answer keys
and does not pretend browser grading occurred. The tool's duplicate-attempt guard covers two minutes, whereas this
evaluation deliberately checks once per challenge across the whole session. These differences are reported, not fixed.

## Time and cost

Observed with `xai/grok-4.6`, default settings: the first relay run (4 scenarios, sequential) took about 2–9 minutes
per scenario; the dynamic-answer run (python-foundations-first-lesson + sql-lab-joins-jump, `--concurrency 2`) took
194 s and 325 s (wall clock ≈ 325 s), with TTFT median 3.3 s / p90 4.8 s and settle median 21 s / p90 36 s per turn.
Long first turns (source search, fetch, lesson write) dominate: 30–70 s. Token usage and cost are not recorded by the
harness; check the provider dashboard. Retries, the handled-command grace period and long tool use add time.
In that run the SQL tutor created its own challenges (`psi_challenge` create, UUID ids) instead of presenting pack
challenges, so its answer turns fell back to scripted text; model-created challenges have no keys by design.
