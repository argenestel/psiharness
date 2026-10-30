# Tools and commands

Three surfaces: **agent tools** (`psi_*`, called by the model), **slash commands** (typed in a pi/omp session), and
the **`psi` CLI** (your shell). Sources: `extension/src/practice/`, `extension/src/tools.ts`, `extension/src/schemas.ts`,
`extension/src/commands.ts`, `cli/src/`.

## Practice agent tools

Registered in `extension/src/practice/tools.ts`. A `?` marks an optional parameter; string fields are strings,
`hints`, `acceptable`, `rubric`, `wins`, and `struggles` are string arrays. These tools return JSON;
plan validation returns repairable errors, while storage errors can throw.

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `psi_memory_remember` | `kind`, `text`, `skill?`, `topic?`, `source?: learner\|observed\|inferred` | Save or merge a durable observation. Default source: learner. |
| `psi_memory_recall` | `query?`, `kind?`, `skill?`, `limit?: integer 1–100` | Ranked recall (default limit 12); marks returned observations used. No topic parameter on this tool. |
| `psi_memory_forget` | `id` | Delete one observation. |
| `psi_recap` | `summary`, `wins`, `struggles`, `next`, `minutes?: number ≥ 0`, `skill?` | Save a recap; defaults to active skill and 0 minutes. Does not itself stop the session or credit hours. |
| `psi_skill_plan` | `action: create\|update\|get\|next`, `plan?: unknown` | Create/update requires a complete plan; get/next may select with `plan.skill`, otherwise uses the active skill. |
| `psi_challenge` | `skill`, `subskillId?`, `kind`, `level: integer 1–5`, `prompt`, `expected?`, `acceptable?`, `tolerance?: number ≥ 0`, `rubric?`, `hints` | Save and present a challenge; hides expected/acceptable arguments in its call display and omits them from its response. |
| `psi_attempt` | `challengeId`, `skill`, `answer`, `outcome?: success\|partial\|fail\|skipped`, `hintsUsed?: integer ≥ 0`, `lesson?`, `feedback?` | Deterministic grading overrides the supplied outcome; open answers require an outcome. Default hints: active ladder count, otherwise 0. Records XP and progress. |
| `psi_hint` | `challengeId`, `skill`, `n: integer` | Show a 1-based hint, clamped to the ladder; empty ladders return no hint. |
| `psi_practice_session` | `action: start\|stop\|status`, `skill`, `focus?`, `minutes?: number > 0 and ≤ 180` | Start if no session is active, stop and credit hours, or inspect status. Planned time defaults to 20; it is not a hard timer. |
| `psi_progress_report` | `skill?` | Report one specified skill, the active skill, or all skills when neither is set. |

Memory kinds: `goal`, `background`, `preference`, `strength`, `struggle`, `misconception`, `insight`,
`motivation`, `constraint`. Challenge kinds: `quickfire`, `predict`, `debug`, `apply`, `explain`, `build`, `boss`.
For complete plan fields and grading rules, see [Writing a skill pack](authoring.md#writing-a-skill-pack).
The plan tool validates required fields, unique subskill ids, prerequisites, and cycles, and supplies timestamps
and a default `hoursGoal` of 20. Both create and update take a full plan, rather than a patch.

Record a failure's `lesson` in that attempt to receive its bonus. The tool does not provide an operation to add
bonus XP to an already recorded attempt; do not record the same attempt twice.

## Optional concept and visual agent tools

Concept-layer tools return pretty-printed JSON (truncated past 16,000 characters). Validation problems come back as
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
| `psi_storyboard` | `storyboard: Storyboard`, `speech?: boolean`, `autoplay?: boolean` | Validates, saves `storyboards/<id>.json`, renders `artifacts/<id>.html`. Returns `{ path }`. |
| `psi_explorable` | `spec: ExplorableSpec` | Validates, saves `explorables/<id>.json`, renders `artifacts/<id>.html`. Returns `{ path }`. |
| `psi_manim` | `topic?`, `code?`, `storyboardId?`, `render?`, `scene?`, `quality?: l\|m\|h`, `runner?: auto\|local\|docker` | With `storyboardId`: writes `artifacts/<id>.py`, renders only if `render: true`. With `code`: always renders. Returns `{ outputs }` or a `RenderResult` (`ok`, `outputs`, `log?`). |
| `psi_crew` | `topic?`, `conceptId?`, `tasks?: { role, instructions, conceptId?, inputs? }[]` (≥ 1) | With `tasks`: runs each role sequentially. Without: `buildLesson(topic, conceptId)`. Returns `{ results: CrewResult[] }`. |
| `psi_note` | `topic?`, `note` (non-empty) | Appends a timestamped learner observation to `notes.md` through `appendNote`. Never affects mastery. |

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

## Practice slash commands

Registered in `extension/src/practice/commands.ts`. Most workflows ask the model to use tools, so completion
requires successful tool calls. Hint display, memory editing, hours, and streak display act locally.

| Command | Behavior |
| --- | --- |
| `/skill <what to learn>` | Activate a skill slug and request a first-20-hours plan after asking target, level, and time per day; request at most 3 resources. |
| `/practice [focus] [minutes]` | Start a block; a numeric trailing argument is minutes (default 20, > 0 and ≤ 180). Requests one challenge at a time. |
| `/challenge [kind or request]` | Request a fresh challenge; arguments are free text, not a validated kind selector. |
| `/boss [request]` | Request a harder boss mixing solid subskills. |
| `/quest [request]` | Request a small build project with 3–5 milestones, one build challenge at a time. |
| `/hint` | Show the next hint for the current challenge. |
| `/remember <fact>` | Save a learner-sourced preference scoped to the active skill if selected. |
| `/memory` | List observations with ids. |
| `/forget <id>` | Delete one observation. |
| `/recap [request]` | Ask the agent to stop the block, save a recap and durable observations. |
| `/hours` | Show hours toward the active skill's goal. |
| `/streak` | Show the active skill's practice streak. |

All need an active skill except `/skill`, `/remember`, `/memory`, and `/forget`.
`/progress` belongs to the concept layer; use `psi_progress_report` or shell `psi progress` for practice progress.

## Optional concept slash commands

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
| `/tutor on\|off\|socratic\|explain` | required, case-insensitive | Sets the mode. `off` stops the concept contract; practice injection remains active. |
| `/studio` | ignored | Starts or reuses the studio on `PSI_STUDIO_PORT` (default 4173) and prints the connection URL using `PSI_STUDIO_HOST` (default loopback). |

Under pi, prompt templates in `prompts/` also appear as slash commands: `/concept-map`, `/daily-review`,
`/explain-like-3b1b`, `/feynman-check`, `/kurzgesagt-explainer`, `/learn-big-idea`, `/make-flashcards`,
`/misconception-hunt`, `/socratic-drill`, `/zoom-out`. Practice templates include `/first-20-hours`,
`/practice-block`, `/boss-fight`, `/build-quest`, `/failure-debrief`, `/welcome-back`, and `/weekly-review`.
The pi launcher supplies template/skill directories; omp gets a readable skill index instead of these pi flags.

### Host flags

The extension registers these host flags:

| Flag | Effect |
| --- | --- |
| `--psi-skill <slug>` | Select a practice skill; forward through the CLI as `psi learn -- --psi-skill <slug>`. |
| `--psi-tutor` | Start with tutor mode `on`. |
| `--psi-topic <slug>` | Start on this topic with tutor mode `on`. |

## psi CLI

`node cli/src/psi.ts [command] [options] [-- host args]`. With no command, `learn` runs.

Practice commands parse their own arguments; they do not accept the general host options below.

| Command | Flags and behavior |
| --- | --- |
| `psi skills` | No flags; list skills, progress, hours, and next subskill. |
| `psi practice <skill> [--minutes N]` | `--minutes N` or `--minutes=N` sets a positive duration; without it there is no deadline. Drills unattempted or latest-failed eligible challenges with explicit expected answers; open answers go to the agent. `?` hint, `s` skip, `q`/EOF quit. |
| `psi hours [skill]` | No flags; hours for one skill or all skills. |
| `psi progress [skill]` | No flags; XP, levels, streak, attempts, and badges for one skill or all. |
| `psi memory [list\|show\|add <kind> <text>\|forget <id>\|name <name>]` | No flags; default list; show renders a summary; add uses the memory kinds above. |
| `psi import-skill <dir> [--force]` | Import plan and challenges; force overwrites pack files while preserving learner history. Import performs basic JSON/shape checks, not full pack validation. |

Other CLI commands:

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
| `studio [--port N] [--host H] [--open]` | Flags override `PSI_STUDIO_PORT` and `PSI_STUDIO_HOST`; defaults to port 4173 on `127.0.0.1` (`0` = a free port). |
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
| `--port <n>`, `--host <address>`, `--open` | studio | Bind port/address; open a browser (`open`/`xdg-open`). Here host is an address, not pi/omp. |
| `--speech`, `--autoplay` | render (storyboard HTML) | Browser speech; start playback on load. Both default off. |
| `--` | learn, ask, crew | Forward everything after it to the host. |
| `-h, --help`, `-v, --version` | — | Help; package version. |

Value options accept `--name value` or `--name=value`; switches are bare flags. Unknown options are errors: forward host options after `--`.

## Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `PSI_HOME` | store, CLI, crew, studio | Data root (default `~/.psi`). The CLI, crew, and `/studio` pass the resolved value to children. |
| `PSI_HOST` | CLI, crew | `pi` (default) or `omp`. |
| `PSI_BIN` | CLI, crew, doctor | Host executable path override. |
| `PSI_MANIM_IMAGE` | visual, doctor | Docker image for Manim (default `psi-manim:latest`). |
| `PSI_STUDIO_PORT` | studio server, CLI, `/studio` | Port (default 4173); `psi studio --port` overrides it. |
| `PSI_STUDIO_HOST` | studio server, CLI, `/studio` | Bind address (default `127.0.0.1`); `psi studio --host` overrides it. Also used by `/studio`. Generic `HOST` is ignored. |
| `PSI_STUDIO_ALLOWED_HOSTS` | studio server | Comma-separated additional names accepted by its HTTP Host guard. Does not set the bind address. |
| `PSI_MANIM_RUNNER` | visual | Default `auto`, `local`, or `docker`; explicit runner/CLI `--docker` overrides it. |
| `PSI_CREW_MODEL` | extension crew tool | Overrides the session model for `psi_crew`; shell `psi crew` uses `--model`. |
| `NO_COLOR` | CLI | Disable colored output. |
