# Tools and commands

Three surfaces: **agent tools** (`psi_*`, called by the model), **slash commands** (typed in a pi/omp session), and
the **`psi` CLI** (your shell). Sources: `extension/src/tools.ts`, `extension/src/schemas.ts`,
`extension/src/commands.ts`, `cli/src/`.

## Agent tools

Every tool returns pretty-printed JSON (truncated past 16,000 characters). Validation problems come back as
`{ "errors": [...] }` rather than exceptions. Wherever `topic?` appears, it is a slug that defaults to the active topic
(set by `/learn` or `--psi-topic`); with neither, the tool fails with "Choose a topic with /learn, or supply topic."
Crew role agents have no active topic and must pass it.

| Tool | Parameters | Does |
| --- | --- | --- |
| `psi_concept_graph` | `topic?`, `title`, `bigIdea`, `concepts: Concept[]` | Validates and saves the graph (keeps the original `createdAt`). Returns `{ topic, mermaid }` or errors. |
| `psi_lesson_plan` | `topic?`, `plan?: LessonPlan`, `targetId?` | Needs a graph. Saves `plan` if given (each `conceptId` must exist). Returns `{ plan, frontier, path? }`; `path` is `pathTo(targetId)`. |
| `psi_cards_add` | `topic?`, `cards: CardDraft[]` (≥ 1) | Checks concept ids (when a graph exists) and MCQ choices (≥ 2). Returns the created cards. |
| `psi_review_next` | `topic?` | Earliest-due card and count: `{ card \| null, remaining }`. Without any topic, searches all topics. |
| `psi_review_grade` | `topic?`, `cardId`, `rating: 1-4` | Records an attempt (FSRS + BKT). Returns `{ card, masteryChange: { before, after, delta }, next, remaining }`. |
| `psi_mastery` | `topic?` | `{ topic, mastery, frontier, due }` — BKT estimates per concept and what is ready next. |
| `psi_storyboard` | `storyboard: Storyboard` | Validates, saves `storyboards/<id>.json`, renders `artifacts/<id>.html`. Returns `{ path }`. |
| `psi_explorable` | `spec: ExplorableSpec` | Validates, saves `explorables/<id>.json`, renders `artifacts/<id>.html`. Returns `{ path }`. |
| `psi_manim` | `topic?`, `code?`, `storyboardId?`, `render?`, `scene?`, `quality?: l\|m\|h`, `runner?: auto\|local\|docker` | With `storyboardId`: writes `artifacts/<id>.py`, renders only if `render: true`. With `code`: always renders. Returns `{ outputs }` or a `RenderResult` (`ok`, `outputs`, `log?`). |
| `psi_crew` | `topic?`, `conceptId?`, `tasks?: { role, instructions, conceptId?, inputs? }[]` (≥ 1) | With `tasks`: runs each role sequentially. Without: `buildLesson(topic, conceptId)`. Returns `{ results: CrewResult[] }`. |
| `psi_note` | `topic?`, `note` (non-empty) | Appends a learner observation to `learner.json` `notes`. Never affects mastery. |

Payload shapes:

- **Concept** — `id, title, summary, prerequisites, difficulty (1-5)`, optional `intuition, misconceptions,
  visualHooks, tags`.
- **CardDraft** — `conceptId`, `kind: recall | predict | explain | mcq`, `prompt`, `answer`, `choices?`.
- **Rating** — `1` Again, `2` Hard, `3` Good, `4` Easy. ≥ 3 counts as correct for BKT.
- **Crew roles** — `architect | intuition | storyteller | visualizer | quizmaster | critic`.
- **LessonPlan, Storyboard, ExplorableSpec** — see [authoring](authoring.md).

Rules the teaching contract gives the model: hide the card answer until the learner attempts it; grade only real
attempts, passing `topic: card.topic` (cards can come from another topic when none is active); never infer mastery
from an explanation.

## Slash commands

Registered by the extension. Except `/learn`, `/tutor`, `/studio`, and `/progress`, each needs an active topic.
"Focus" defaults to the current lesson, then "the next frontier concept".

| Command | Arguments | Behavior |
| --- | --- | --- |
| `/learn <big idea>` | required text | Sets the active topic to `slugify(idea)`, tutor mode `on`, clears the current lesson, then asks the agent to diagnose (one question, wait), build a graph, and plan. |
| `/map` | ignored | Needs a graph. Posts Mermaid source and the frontier titles. |
| `/lesson [concept]` | exact id or case-insensitive full title | Needs a graph. Defaults to the first frontier concept. Sets the current lesson, turns tutoring on if off, and requests hook → intuition → visual → formalism → check. |
| `/visualize [focus]` | free text | Asks for an intuition-first `psi_storyboard`, with a prediction before the reveal. |
| `/explore [focus]` | free text | Asks for a `psi_explorable` with things to try and notice. |
| `/quiz [focus]` | free text | One question at a time; uses `psi_mastery` to choose and `psi_cards_add` to save checks. |
| `/review [focus]` | free text (context only) | Drills due cards with `psi_review_next` / `psi_review_grade`. The text is not a queue filter. |
| `/crew [concept]` | id or title | Asks for `psi_crew` with a resolved `conceptId`. |
| `/progress` | ignored | `ψ <topic> · mastered/total mastered · N due`; without a topic, due count across all topics. |
| `/tutor on\|off\|socratic\|explain` | required, case-insensitive | Sets the mode. `off` stops injecting the teaching contract. |
| `/studio` | ignored | Starts or reuses the studio on `PSI_STUDIO_PORT` (default 4173) and prints `http://localhost:<port>`. |

Prompt templates in `prompts/` also appear as slash commands: `/concept-map`, `/daily-review`,
`/explain-like-3b1b`, `/feynman-check`, `/kurzgesagt-explainer`, `/learn-big-idea`, `/make-flashcards`,
`/misconception-hunt`, `/socratic-drill`, `/zoom-out`. Skills in `skills/` are loaded by the host on demand.

### Host flags

The extension registers two host flags (the CLI sets them for you):

| Flag | Effect |
| --- | --- |
| `--psi-tutor` | Start with tutor mode `on`. |
| `--psi-topic <slug>` | Start on this topic with tutor mode `on`. |

## psi CLI

`node cli/src/psi.ts [command] [options] [-- host args]`. With no command, `learn` runs.

| Command | Does |
| --- | --- |
| `learn [big idea...]` | Interactive host session with psi loaded and tutoring on. With an idea, sends `/learn <idea>` first. |
| `ask "<question>"` | One-shot: runs the host in print mode (`-p`) with the question, then exits. |
| `topics` | Table of topics: title, mastered/total, due. |
| `map <topic> [--mermaid]` | Prerequisite tree (`✓` mastered, `▶` ready, `·` later), or Mermaid source. |
| `review [topic]` | Terminal flashcards for due cards (all topics when omitted). `q` quits. |
| `render <file.json> [-o out.html]` | Storyboard or explorable JSON → HTML. Default output: input path with `.html`. |
| `render --manim <file> [-q l\|m\|h] [--docker] [-o dir]` | `.py` source or storyboard JSON → MP4. Quality default `m`; output default is the input's directory. |
| `crew <topic> <conceptId>` | Runs `buildLesson`; prints role, ✓/✗, seconds, files, error. Exit 1 if any role failed. |
| `studio [--port N] [--open]` | Studio on `127.0.0.1`, default port 3210 (`0` = any free port). |
| `import <dir>` | Copies a topic pack into `PSI_HOME`; refuses to overwrite. |
| `doctor` | Checks Node, hosts, renderers, Docker image, and `PSI_HOME`. Exit 1 if any check fails. |

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--host pi\|omp` | learn, ask, crew | Host; overrides `PSI_HOST`. |
| `--topic <slug>` (alias `--psi-topic`) | learn, ask | Start on a topic. |
| `--model <m>` | learn, ask, crew | Forwarded to the host. |
| `--thinking <level>` | learn, ask | Forwarded to the host. |
| `-o, --output <path>` | render | Output file (HTML) or directory (Manim). |
| `-q, --quality l\|m\|h` | render --manim | Manim quality. |
| `--manim`, `--docker` | render | Manim pipeline; force the Docker runner. |
| `--port <n>`, `--open` | studio | Port; open a browser (`open`/`xdg-open`). |
| `--` | learn, ask | Forward everything after it to the host. |
| `-h, --help`, `-v, --version` | — | Help; package version. |

Options accept `--name value` or `--name=value`. Unknown options are errors: forward host options after `--`.

## Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `PSI_HOME` | store, CLI, crew, studio | Data root (default `~/.psi`). The CLI, crew, and `/studio` pass the resolved value to children. |
| `PSI_HOST` | CLI, crew | `pi` (default) or `omp`. |
| `PSI_BIN` | CLI, crew, doctor | Host executable path override. |
| `PSI_MANIM_IMAGE` | visual, doctor | Docker image for Manim (default `psi-manim:latest`). |
| `PSI_STUDIO_PORT` | studio server, `/studio` | Port for the standalone server (default 4173). Not used by `psi studio`. |
| `PSI_STUDIO_HOST` | studio server | Bind address (then `HOST`, then `127.0.0.1`). Not used by `psi studio`. |
| `NO_COLOR` | CLI | Disable colored output. |
