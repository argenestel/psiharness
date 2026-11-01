# Tools and commands

Five surfaces: **agent tools** (`psi_*`, called by the model), **slash commands** (typed in a pi/omp session),
the **`psi` CLI** (your shell), the **HTTP API** behind psi web, and **environment variables**. Sources:
`extension/src/practice/*.ts`, `extension/src/tools.ts`, `extension/src/tool-policy.ts`, `extension/src/commands.ts`,
`cli/src/`, `studio/src/`.

## Which tools exist where

- **Terminal sessions** (`psi learn`, `pi -e extension/src/index.ts`) get every tool the extension registers.
- **Web chats** get `read` plus the explicit list in `extension/src/tool-policy.ts`; `PSI_WEB_TOOLS` can only narrow
  it. Web `read` calls are confined to `PSI_HOME` and psi's bundled `skills/` and `prompts/`.
- **Execution tools** — `psi_run`, `psi_manim`, `psi_crew` — are registered only when `PSI_CODE_EXEC=1`
  (exactly `1`). The Docker `web` and `psi` services set it; a bare host does not. Without it these tools do not
  exist in either surface; the bundled skills tell the tutor to describe the visual, use an explorable, or work an
  example by hand instead.

## Teaching and sources

Registered in `extension/src/practice/lessons.ts` and `extension/src/practice/flow.ts`.

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `psi_lesson` | `action: show\|write`, `skill?`, `subskillId?`, `lesson?` | `show` returns the lesson card widget with numbered citations, or `{ missing: true }` with research instructions. `write` validates a `SkillLesson` (≥ 1 citation whose `sourceId` exists in the skill's sources) and rejects any citation `quote` not found on the fetched page or stored excerpt. `subskillId` defaults to the plan's next subskill. |
| `psi_sources` | `action: list\|add\|remove`, `skill?`, `url?`, `id?`, `title?`, `kind?`, `publisher?`, `excerpt?`, `license?` | Ranked references for a skill. `add` needs `url` and `title`, dedupes by normalized URL, and ranks it (trusted domain, kind, recency, license). `remove` takes `id` or `url`. Always returns the list, rank descending. |
| `psi_fetch` | `url` | Reads a public http/https page as untrusted text (≤ 20,000 characters returned; private and loopback addresses refused). With an active skill the full page is cached for `psi_lesson` quote checks and `psi_verify`. |
| `psi_search` | `query`, `subject?` | Web search (DuckDuckGo HTML) for candidate sources, ranked; falls back to the curated `TRUSTED_SOURCES` catalog offline. |
| `psi_verify` | `claim`, `skill?` | Ranks sentences from the skill's sources against the claim with BM25 (cached pages; up to three uncached pages are fetched; otherwise the stored excerpt). Returns evidence passages, numbered citations, a note, and a conservative verdict: `likely-supported`, `possibly-contradicted`, or `unclear`. The verdict matches wording, not meaning; it is a signal, not proof. |
| `psi_next_steps` | `options: { label (≤ 60), message (≤ 400) }[]` (2–4) | One-click replies at the end of a turn. A guard always adds "Continue" (replacing the fourth option if needed) and redacts open-challenge answers from labels and messages. |
| `psi_ask` | `question`, `kind: predict\|why\|what-if`, `hint?` | A light Socratic prompt inside a lesson: ungraded, no XP. The web card has an answer box and "Just show me". |
| `psi_run` | `language: python\|javascript\|sql\|bash`, `code`, `setup?`, `stdin?` | **Needs `PSI_CODE_EXEC=1`.** Runs a tutor demo in a fresh temp directory with a stripped environment (`PATH`, `HOME`, `LANG` only), 10 s timeout, 64 KB output cap per stream. `sql` runs against in-memory SQLite via `python3`. `bash` also needs `PSI_CODE_EXEC_BASH=1`. Returns stdout, stderr, exit code, timing, and a `run` widget. |

## Practice

Registered in `extension/src/practice/tools.ts` and `extension/src/practice/paths.ts`. A `?` marks an optional
parameter. `skill?` defaults to the active skill.

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `psi_memory_remember` | `kind`, `text`, `skill?`, `topic?`, `source?: learner\|observed\|inferred` | Save or merge a durable observation (similar same-kind text updates the existing item). Default source: learner. |
| `psi_memory_recall` | `query?`, `kind?`, `skill?`, `limit?: 1–100` | Ranked recall (default 12); marks returned items used. |
| `psi_memory_forget` | `id` | Delete one observation. |
| `psi_recap` | `summary`, `wins`, `struggles`, `next`, `minutes?`, `skill?` | Save a session recap. Does not stop the session or credit hours. |
| `psi_skill_plan` | `action: create\|update\|get\|next`, `plan?`, `overwrite?`, `removeSubskillIds?` | `create` refuses to replace an existing plan unless `overwrite: true` (learner asked to start over). `update` merges subskills by id, keeping saved statuses; `removeSubskillIds` deletes. `get`/`next` read the plan or the next subskill and its drills. |
| `psi_challenge` | `action?: create\|next`, `skill?`, `subskillId?`, `kind?`, `level?: 1–5`, `prompt?`, `expected?`, `acceptable?`, `tolerance?`, `rubric?`, `hints?`, `format?: text\|number\|math\|choice\|code`, `choices?`, `unit?`, `language?: python\|javascript\|sql`, `starterCode?`, `setup?`, `tests?` | `next` presents a ready challenge picked by the scheduler and reports why (`new`, `review`, `retry`, `stretch`). `create` (default) validates and saves a new one. Either way it becomes the open challenge; answers are hidden from the call display and response. A guard blocks it on a "continue"/"show me" turn until something was taught. |
| `psi_attempt` | `challengeId`, `skill?`, `answer`, `outcome?: success\|partial\|fail\|skipped`, `hintsUsed?`, `lesson?`, `feedback?` | Deterministic grading overrides the supplied outcome; open answers need an outcome; `code` needs the outcome from a run. Refuses a second attempt on the same challenge within 2 minutes. Records XP, streak, badges, and progression. Hints never reduce XP. |
| `psi_hint` | `challengeId`, `skill?`, `n` | Show hint `n` (1-based, clamped to the ladder). |
| `psi_practice_session` | `action: start\|stop\|status`, `skill?`, `focus?`, `minutes?: (0, 180]` | Start (if none is active), stop and credit minutes, or report elapsed/planned time. Planned time defaults to 20 and is not a hard timer. |
| `psi_progress_report` | `skill?` | XP, level, streak, hours, attempts, badges, next subskill for one skill, the active skill, or all skills. |
| `psi_path` | `action: list\|get\|create\|next`, `id?`, `title?`, `goal?`, `targetId?`, `steps?` | Learning paths over the knowledge graph. `create` with `targetId` and no `steps` generates the prerequisite route; creating makes the path active, and the active path's next step is injected into each turn. |

Memory kinds: `goal`, `background`, `preference`, `strength`, `struggle`, `misconception`, `insight`,
`motivation`, `constraint`. Challenge kinds: `quickfire`, `predict`, `debug`, `apply`, `explain`, `build`, `boss`.
Plan and challenge fields: [Writing a skill pack](authoring.md#writing-a-skill-pack).

Record a failure's `lesson` with the attempt to receive its bonus; do not record the same attempt twice. In psi
web the learner can add the lesson afterwards (`POST /api/skills/:s/attempts/:id/lesson`), which awards it once.

## Concept and visual tools (optional layer)

Registered in `extension/src/tools.ts`. They return pretty-printed JSON (truncated past 16,000 characters);
validation problems come back as `{ "errors": [...] }`. `topic?` defaults to the active topic (set by `/learn` or
`--psi-topic`); with neither, the tool fails. Crew role agents must pass it.

| Tool | Parameters | Does |
| --- | --- | --- |
| `psi_concept_graph` | `topic?`, `title`, `bigIdea`, `concepts: Concept[]` | Validates and saves the graph. Returns `{ topic, mermaid }` or errors. |
| `psi_lesson_plan` | `topic?`, `plan?: LessonPlan`, `targetId?` | Needs a graph. Saves `plan` if given. Returns `{ plan, frontier, path? }`; `path` is `pathTo(targetId)`. |
| `psi_cards_add` | `topic?`, `cards: CardDraft[]` (≥ 1) | Checks concept ids and MCQ choices (≥ 2). Returns the created cards. |
| `psi_review_next` | `topic?` | Earliest-due card and count. Without any topic, searches all topics. |
| `psi_review_grade` | `topic?`, `cardId`, `rating: 1-4` | FSRS + BKT update. Returns `{ card, masteryChange, next, remaining }`. |
| `psi_mastery` | `topic?` | `{ topic, mastery, frontier, due }`. |
| `psi_storyboard` | `storyboard`, `speech?`, `autoplay?` | Validates, saves `storyboards/<id>.json`, renders `artifacts/<id>.html`. |
| `psi_explorable` | `spec` | Validates, saves `explorables/<id>.json`, renders `artifacts/<id>.html`. |
| `psi_manim` | `topic?`, `code?`, `storyboardId?`, `render?`, `scene?`, `quality?: l\|m\|h`, `runner?: auto\|local\|docker` | **Needs `PSI_CODE_EXEC=1`.** With `storyboardId`: writes `artifacts/<id>.py`, renders only if `render: true`. With `code`: always renders. Finished MP4s are copied to `artifacts/<name>.mp4`. |
| `psi_crew` | `topic?`, `conceptId?`, `tasks?: { role, instructions, conceptId?, inputs? }[]` | **Needs `PSI_CODE_EXEC=1`.** With `tasks`: runs each role sequentially. Without: `buildLesson(topic, conceptId)`. Children use the session model unless `PSI_CREW_MODEL` is set. |
| `psi_note` | `topic?`, `note` | Appends a timestamped observation to `notes.md`. Never affects mastery. |

Payload shapes: **Concept** — `id, title, summary, prerequisites, difficulty (1-5)`, optional `intuition,
misconceptions, visualHooks, tags`. **CardDraft** — `conceptId`, `kind: recall | predict | explain | mcq`, `prompt`,
`answer`, `choices?`. **Rating** — `1` Again, `2` Hard, `3` Good, `4` Easy (≥ 3 counts as correct for BKT).
**Crew roles** — `architect | intuition | storyteller | visualizer | quizmaster | critic`. LessonPlan, Storyboard,
ExplorableSpec: [authoring](authoring.md).

## Slash commands

### Practice and teaching

Registered in `extension/src/practice/`. Commands that send a message rely on the model's tool calls; the
others act locally.

| Command | Behavior |
| --- | --- |
| `/skill <what to learn>` | Activates a skill slug and asks for a first-20-hours plan (target, level, time per day; ≤ 3 resources; 3–6 sources; a lesson before the first challenge). |
| `/practice [focus] [minutes]` | Starts a block (trailing number = minutes, default 20, max 180). Asks for `psi_challenge` action `next`, creating only if none remain. |
| `/challenge [request]` | Asks for one new challenge. Free text, not a validated kind. |
| `/boss [request]` | Asks for a harder challenge mixing solid subskills. |
| `/quest [request]` | Asks for a build project with 3–5 milestones, one build challenge at a time. |
| `/hint` | Local: shows the next rung for the open challenge. |
| `/remember <fact>` | Local: saves a learner `preference`, scoped to the active skill. |
| `/memory` | Local: lists observations with ids. |
| `/forget <id>` | Local: deletes one observation. |
| `/recap [request]` | Asks the agent to stop the session and save a recap and durable observations. |
| `/hours` | Local: hours toward the active skill's goal. |
| `/streak` | Local: the active skill's streak. |
| `/mode [teach\|practice\|test]` | Local: shows or sets the tutor mode in `profile.json`. teach = mostly explanation, light optional checks; practice = short lesson then challenges (default); test = challenges only, repair afterwards. |
| `/verify <claim>` | Asks the agent to run `psi_verify` and explain the evidence. |
| `/sources` | Asks the agent to list the active skill's ranked sources and their reasons. |
| `/path [list \| <id> \| new <goal>]` | Local `list` and `<id>` (activates the path and shows its next step); `new <goal>` asks the agent to build one with `psi_path`. |

All need an active skill except `/skill`, `/remember`, `/memory`, `/forget`, `/mode`, and `/path`.

### Concept and visual layer

Registered in `extension/src/commands.ts`. Except `/learn`, `/tutor`, `/studio`, and `/progress`, each needs an
active topic. "Focus" defaults to the current lesson, then "the next frontier concept".

| Command | Behavior |
| --- | --- |
| `/learn <big idea>` | Sets the topic to `slugify(idea)`, tutor mode `on`; asks for a one-question diagnosis, a graph, and a plan. |
| `/map` | Local: Mermaid source of the graph plus frontier titles. |
| `/lesson [concept]` | Teaches the first frontier concept (or an exact id / title): hook → intuition → visual → formalism → check. |
| `/quiz [focus]` | One question at a time with `psi_mastery` and `psi_cards_add`. |
| `/review [focus]` | Drills due cards with `psi_review_next` / `psi_review_grade`. |
| `/visualize [focus]` | Asks for an intuition-first `psi_storyboard`. |
| `/explore [focus]` | Asks for a `psi_explorable`. |
| `/crew [concept]` | Asks for `psi_crew`; without `PSI_CODE_EXEC=1` that tool does not exist and the agent can only explain. |
| `/progress` | Local: `ψ <topic> · mastered/total · N due`. |
| `/tutor on\|off\|socratic\|explain` | Local: concept-layer tutor mode. `off` stops the concept contract; practice injection stays. |
| `/studio` | Local: starts or reuses the web server (the same app as `psi web`) on `PSI_STUDIO_PORT`/`PSI_STUDIO_HOST` and prints its URL. |

Under pi, the templates in `prompts/` also appear as slash commands (`/teach-me`, `/practice-block`,
`/check-sources`, `/first-20-hours`, `/boss-fight`, `/build-quest`, `/code-kata`, `/welcome-back`, …). omp gets a
readable skill index instead of pi's resource flags.

### Host flags

| Flag | Effect |
| --- | --- |
| `--psi-skill <slug>` | Start on a practice skill (CLI: `psi learn -- --psi-skill <slug>`). |
| `--psi-tutor` | Start with concept tutor mode `on` (pass `--psi-tutor=true` under pi; see [omp-compat](omp-compat.md)). |
| `--psi-topic <slug>` | Start on a topic with tutor mode `on`. |

## psi CLI

`node cli/src/psi.ts [command] [options] [-- host args]` (or `npm run psi --`). With no command, `learn` runs.

### Model-free practice commands

These parse their own arguments and ignore the host options.

| Command | Behavior |
| --- | --- |
| `psi skills` | Skills with progress, hours, and next subskill. |
| `psi practice <skill> [--minutes N]` | Drills challenges with explicit expected answers. `?` hint, `s` skip, `q`/EOF quit. |
| `psi hours [skill]` | Hours for one skill or all. |
| `psi progress [skill]` | XP, level, streak, attempts, badges. |
| `psi memory [list\|show\|add <kind> <text>\|forget <id>\|name <name>]` | Inspect and edit learner memory (default `list`). |
| `psi import-skill <dir> [--force]` | Imports `plan.json`, `challenges.json`, and when present `sources.json` and `lessons/*.json`; `--force` replaces pack files and keeps learner history. |

### Web, tutor, and tools

| Command | Does |
| --- | --- |
| `web [--port N] [--host H] [--open]` | psi web: chat with the tutor, practice, code lab, graph, paths, sources. Alias `studio`. Defaults to `127.0.0.1:4173`; flags override `PSI_STUDIO_PORT`/`PSI_STUDIO_HOST`; `--port 0` picks a free port; `--open` opens a browser. |
| `learn [big idea...]` | Interactive host session with psi loaded and tutoring on; with an idea, sends `/learn <idea>` first. |
| `ask "<question>"` | One-shot print-mode run, then exit. |
| `topics` | Topics with mastered/total and due counts. |
| `map <topic> [--mermaid]` | Prerequisite tree (`✓` mastered, `▶` ready, `·` later) or Mermaid source. |
| `review [topic]` | Terminal flashcards for due cards (all topics when omitted). |
| `render <file.json> [-o out.html] [--speech] [--autoplay]` | Storyboard or explorable JSON → HTML. |
| `render --manim <file> [-q l\|m\|h] [--docker] [-o dir]` | `.py` or storyboard JSON → MP4 (quality default `m`). Not gated by `PSI_CODE_EXEC`: you run it yourself. |
| `crew <topic> <conceptId>` | Runs `buildLesson`; exit 1 if any role failed. Not gated by `PSI_CODE_EXEC`. |
| `import <dir>` | Copies a topic pack into `PSI_HOME`; refuses to overwrite. |
| `doctor` | Checks Node, hosts, renderers, the Manim image, and that `PSI_HOME` is writable. |

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--host pi\|omp` | learn, ask, crew | Host; overrides `PSI_HOST`. (For `web`, `--host` is a bind address.) |
| `--topic <slug>` (alias `--psi-topic`) | learn, ask | Start on a topic. |
| `--model <m>`, `--thinking <level>` | learn, ask (crew: `--model`) | Forwarded to the host. |
| `-o`, `-q`, `--manim`, `--docker`, `--speech`, `--autoplay` | render | See above. |
| `--` | learn, ask, crew | Forward everything after it to the host. |
| `-h, --help`, `-v, --version` | — | Help; package version. |

Value options accept `--name value` or `--name=value`. Unknown options are errors; forward host options after `--`.

### Evals

`node evals/run.ts [--scenario <id,...>] [--model <m>] [--code-exec] [--concurrency N] [--repeat K] [--dry-run]
[--list] [--keep] [--out <dir>]` runs scripted learner sessions against a real model (results in `evals/results/`);
`node evals/score.ts <results dir> [--json]` scores them. `node evals/run.ts --help` lists the current options. See
[evals/README.md](../evals/README.md).

## HTTP API (psi web)

Served by `studio/src/server.ts` with `graph-api.ts`, `learn-api.ts`, and `practice-api.ts`. JSON throughout.
Every non-GET request must send `X-Psi: 1` (else 403), and the `Host` header must be a loopback name, an IP literal,
the bind host, or a name in `PSI_STUDIO_ALLOWED_HOSTS` (else 421).

| Route | Purpose |
| --- | --- |
| `POST /api/chat` `{model?, skill?, topic?}` | Start a chat (one `pi --mode rpc` child); returns `{id}`. Skill/topic also become the active ones. |
| `GET /api/chat` | Saved chats `[{id, title, updatedAt}]`. |
| `GET /api/chat/:id/events[?since=N]` | Server-sent events: every pi stdout record; resumes after sequence `N` (or `Last-Event-ID`). |
| `POST /api/chat/:id/prompt` `{message}` | Send a message; waits up to 10 s for pi to accept it. |
| `POST /api/chat/:id/ui` `{id, value?, confirmed?, cancelled?}` | Answer an `extension_ui_request`. |
| `POST /api/chat/:id/abort` | Abort the running turn. |
| `POST /api/chat/:id/model` `{model}` | Switch a live chat's model (`provider/id`). |
| `DELETE /api/chat/:id` | Delete a chat. |
| `GET /api/models` | `{ default, models: [{ id, provider, name, context?, reasoning? }] }` from `pi --list-models`, cached 10 minutes; `default` is `PSI_WEB_MODEL`. |
| `GET /api/skills` | Skill slugs. |
| `GET /api/skills/:s[?unattempted=1]` | `{plan, progress, challenges}` (`lessonAvailable` per subskill). Challenges omit `expected`/`acceptable`/`rubric`/hints, except SQL code challenges' expected rows, which the browser compares. |
| `GET /api/skills/:s/next` | `{challenge, reason}` from the scheduler (`new`/`review`/`retry`/`stretch`); never includes `expected`, even for SQL. |
| `GET /api/skills/:s/challenges/:id` | One challenge, same omissions. |
| `GET /api/skills/:s/challenges/:id/hint?n=` | Hint `n` (zero-based here). |
| `POST /api/skills/:s/challenges/:id/attempt` `{answer, outcome?, hintsUsed?, lesson?}` | Grades with `checkAnswer` when possible; `code` needs the browser `outcome` (recorded `verified: false`); open answers return `needsGrading: true` and nothing is recorded. |
| `GET /api/skills/:s/attempts[?limit=N]` | Recent attempts, newest first (default 40, max 200). |
| `POST /api/skills/:s/attempts/:id/lesson` `{lesson}` | Attach a lesson to a recorded attempt; the first one on a miss earns the bonus. |
| `GET /api/skills/:s/sources` | Ranked sources. |
| `GET /api/skills/:s/lessons` | `[{id, title}]`. |
| `GET /api/skills/:s/lessons/:subskillId` | A lesson with resolved, numbered citations. |
| `GET /api/packs` · `POST /api/packs/:slug/import` | Bundled `examples/skills` packs; import one. |
| `GET /api/memory` · `POST /api/memory` `{kind, text}` · `PATCH /api/memory/:id` · `DELETE /api/memory/:id` | Learner memory (items, recaps, summary). |
| `GET /api/state` | `{activeSkill?, activeTopic?, openChallenge?}`. |
| `GET /api/me` · `PUT /api/me/profile` `{dailyGoal?, tutorMode?, gameLayer?}` | Learner summary (today, streak, level, achievements…); update profile (`gameLayer`: `on`/`quiet`/`off`). |
| `GET /api/graph` · `GET /api/graph/neighborhood/:id?depth=` | Knowledge graph; local view. |
| `POST /api/graph/links` · `DELETE /api/graph/links` `{from, to}` | Learner links. |
| `GET /api/paths` · `GET /api/paths/:id` · `POST /api/paths` `{title, goal, steps?, targetId?}` · `PUT /api/paths/:id` · `DELETE /api/paths/:id` | Learning paths; `targetId` without `steps` generates the route. |
| `GET /api/topics` · `GET /api/topics/:t` · `/cards/due` · `/artifacts` · `/reviews` | Concept-layer topics. |
| `POST /api/topics/:t/cards/:id/review` `{rating}` | Grade a card (same-origin only). |
| `GET /api/events` | SSE `changed` events when `$PSI_HOME/topics` changes. |
| `GET /artifacts/:topic/:file` | Artifact file with a sandboxing CSP. |

## Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `PSI_HOME` | everything | Data root (default `~/.psi`). Passed on to host, crew, and web children. |
| `PSI_HOST` | CLI, crew, web agent, model list | `pi` (default) or `omp`. |
| `PSI_BIN` | CLI, crew, web agent, model list, doctor | Host executable override. |
| `PSI_WEB_MODEL` | web agent, `/api/models` | Default model for new web chats (Docker default `xai/grok-4.6`). |
| `PSI_STUDIO_PORT` | web server, `psi web`, `/studio` | Port (default 4173). `--port` overrides. |
| `PSI_STUDIO_HOST` | web server, `psi web`, `/studio` | Bind address (default `127.0.0.1`). `--host` overrides. Generic `HOST` is ignored. |
| `PSI_STUDIO_ALLOWED_HOSTS` | web server | Comma-separated extra names accepted by the `Host` header check. |
| `PSI_CODE_EXEC` | extension, web tool policy, crew, tutor prompt | `1` registers `psi_run`, `psi_manim`, `psi_crew` and adds them to web chats; the tutor prompt then asks it to verify computed results with `psi_run`. Any other value: absent. |
| `PSI_CODE_EXEC_BASH` | `psi_run` | `1` additionally allows `language: "bash"`. |
| `PSI_CREW_ALLOW_BASH` | crew | `1` (with `PSI_CODE_EXEC=1`) gives the crew visualizer `bash` and `write`. No other role ever gets them. |
| `PSI_CREW_MODEL` | `psi_crew` | Model for crew children (default: the session's model). Shell `psi crew` uses `--model`. |
| `PSI_MANIM_RUNNER` | visual | Default Manim runner: `auto`, `local`, or `docker`. |
| `PSI_MANIM_IMAGE` | visual, doctor | Docker image for Manim (default `psi-manim:latest`). |
| `PSI_WEB_IDLE_MIN` | web agent | Minutes before an idle chat's pi child is stopped (default 30; a turn still producing output is never cut). |
| `PSI_WEB_TOOLS` | web agent | Comma list that narrows the web tool policy; cannot add tools. |
| `PSI_EVAL_MODEL` | evals | Default eval model (`--model` overrides; default `xai/grok-4.6`). |
| `PSI_EVAL_PI` | evals | Host binary or a `.ts`/`.mjs` fake for evals. |
| `PSI_FETCH_ALLOW_LOOPBACK` | `psi_fetch` | Tests only: `1` permits loopback addresses. Never set it in normal use. |
| `NO_COLOR` | CLI | Disable colored output. |

Set internally, not by you: `PSI_WEB_READ_ROOT` (web and eval children; confines `read`). Docker Compose also reads
`PSI_WEB_PORT`, `PSI_WEB_FULL_PORT`, `PSI_PI_HOST_DIR`, `PSI_SYNC_AUTH`, and memory caps; see
[docker/README.md](../docker/README.md).
