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
node evals/run.ts
node evals/score.ts evals/results/<timestamp>
node evals/score.ts evals/results/<timestamp> --json
node --test evals/test/score.test.ts
node --test evals/test/run.test.ts
```

`npm test` does not include `evals/`. Dry runs validate all selected inputs without spawning pi or accessing a model.
The default model is `xai/grok-4.6`; override with `--model` or `PSI_EVAL_MODEL`. Repeat `--scenario`, or supply a
comma-separated list. `--out <directory>` overrides the shared invocation output directory. Results are ignored by git.

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
`teach`, `continue`, `show`, `wrong_guess`, `stuck`, `correct_answer`, `verify`, `answer`, or `other`.
Scoring uses the kind rather than inferring intent from the message. The ten sessions cover Python (3), SQL (3),
calculus (2), and Spanish (2), including repeated continuation, repair, and a later-subskill request.

Answer keys are keyed by challenge ID in `answer-keys/<pack-slug>.json`, with `correct` and `wrong` strings.
For `correct_answer` and `wrong_guess`, the runner looks up the open challenge immediately before sending the turn.
It substitutes the appropriate key verbatim; otherwise it sends the scripted message. Missing correct-answer keys
produce a `harness_warning`. Model-created challenges can therefore require manual review. The actual persisted state
uses `openChallenge: {skill, id}` and `activeSkill`, although the task description called it `challengeId`;
the runner also accepts that legacy shape and writes normalized `harness_state.challengeId`.

All 91 bundled challenge IDs have keys. Offline verification passed 22 Python keys (19 executable tests, 3 scalar),
24 SQL keys (20 SQLite row comparisons, 4 scalar), 22 deterministic calculus keys (including 3 Python programs),
and 18 deterministic Spanish keys: **86 machine-checked answers**. The remaining two calculus explanations and
three Spanish explanations/dialogues have rubrics instead of deterministic checks; their keys were manually reviewed
against those rubrics. They cannot be certified by a pack checker. No failed deterministic checks remain.

## Checks

| Check | Rule |
| --- | --- |
| 1. Teach first | Show/write a lesson for a subskill before its first challenge. |
| 2. One question | At most one sentence-ending question mark plus `psi_ask` per scripted turn. |
| 3. Next steps | Last tool is `psi_next_steps`, with 2–4 options including a continuation label. |
| 4. Continue/show | Teaching content precedes a question or challenge; empty non-teaching turns fail. |
| 5. Citations | Factual teaching explanations contain numbered citations within pack source bounds. |
| 6. No spoilers | Open challenge expected answers do not appear in buttons or text before grading. |
| 7. Attempt once | At most one `psi_attempt` per challenge in a session and per turn. |
| 8. Repair | After a wrong guess, teach before issuing another challenge. |
| 9. Latency | Report TTFT, settlement time, tool calls and attempts; informational only. |

Run health reports incomplete/error/timeout turns separately from contract scores. Each contract score is
passes / (passes + failures). Scenario overall scores average applicable contract checks; the aggregate overall
averages aggregate check ratios. N/A and latency do not inflate the score. `report.md` includes failures with evidence,
scenario and aggregate scores, parse errors, latency median/p90 and the five slowest turns. `--json` adds `score.json`.

## Interpretation and limits

Question and citation detection are heuristics. Question counting excludes fenced/inline code and double-quoted
text. Continuation/repair teaching text is a non-question sentence of at least 40 characters; continuation also accepts
`psi_lesson` or `psi_run`. Factual explanations use a 60-character sentence threshold and omit verdict/next-step prose.
These thresholds miss short explanations and can misclassify prose. The one-question metric totals a scripted turn,
which can contain several assistant messages, so it is stricter than a literal per-message interpretation.

Citation indices are bounded by the original pack's source count, not semantic support or live source mutations.
The lesson tool numbers its own citations locally; the scorer follows the requested pack-count heuristic.
Lesson calls and other tool calls are adherence signals, not proof their output was pedagogically useful.
Spoiler matching is literal after normalization: it ignores answers shorter than four normalized characters and
Python challenges without `expected`, excludes challenge-prompt material, and cannot detect paraphrases.
SQL's expected row sets differ from query text, so equivalent SQL solutions may evade literal spoiler matching.
Wrong guesses are scripted and do not adapt to the model. `/verify` can be extension-handled without a run;
the current implementation sends a user message that usually starts one. No learning outcomes are measured.

The injected contract mentions `id/skill` for an open answer while `psi_attempt` actually requires `challengeId`.
It also distinguishes already-saved browser/card answers from pending answers. The runner submits raw answer keys
and does not pretend browser grading occurred. The tool's duplicate-attempt guard covers two minutes, whereas this
evaluation deliberately checks once per challenge across the whole session. These differences are reported, not fixed.

## Time and cost

No real model was run during construction. Offline validation and fake-RPC timings only establish harness overhead;
they cannot establish provider latency, token usage or cost. Each scenario has roughly 7–9 model prompts, a roughly
2.5 KB injected contract/state budget plus host system context and tool schemas. Budget **roughly 1–4 minutes per
scenario**, and **a few cents to about a dollar for a full ten-scenario Grok 4.6 run** as unverified planning estimates,
not measured prices or results. Long tool use, the handled-command grace period and retries can increase duration.
Replace these estimates with observations after the relay records a real run.
