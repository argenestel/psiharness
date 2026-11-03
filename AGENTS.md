# ψ psi-harness — agent conventions

psi is a learning harness built on **pi** (`@earendil-works/pi-coding-agent`) and compatible with
**oh-my-pi** (`omp`, `@oh-my-pi/pi-coding-agent`, which rewrites `@earendil-works/*` imports to its own
copies). It is a **text-first, practice-first learning agent**: long-term memory of how the learner learns,
Josh Kaufman's *first 20 hours* skill deconstruction, Mark Rober's *Super Mario effect* (failure is cheap and
still earns progress), interactive challenges graded in chat, and spaced retrieval. Concept graphs and
3b1b/Kurzgesagt-style visuals remain available as optional extras.

## Runtime rules (read before writing code)

- **Node ≥ 22.18 runs `.ts` directly** (type stripping). No build step, no bundler.
  - Use only erasable TS syntax: no `enum`, no `namespace`, no constructor parameter properties.
  - Use `import type { … }` for type-only imports.
  - Relative imports **must include the `.ts` extension**: `import { slugify } from "../../core/src/slug.ts"`.
- **Zero runtime dependencies.** Use Node built-ins (`node:fs`, `node:path`, `node:child_process`,
  `node:http`, `node:test`, `node:assert/strict`). Do **not** run `npm install` or edit `package.json`/the
  lockfile; if you truly need a dependency, say so in your report.
- Exception: `extension/` may import from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`
  (host-provided; already installed as devDependencies for typechecking). Nothing else may import them,
  except `crew/` and `cli/` may *spawn* the `pi`/`omp` binaries.
- Generated HTML must be **self-contained single files** (inline CSS/JS). External script tags only from
  `https://cdn.jsdelivr.net/npm/` with exact pinned versions (e.g. `katex@0.16.11`), and must degrade
  gracefully offline.
- Tests: `node:test` + `node:assert/strict`, files at `<module>/test/*.test.ts`. Run all with `npm test`,
  typecheck with `npm run typecheck`. Both must pass before you report done.
- Style: tabs, double quotes, semicolons, 120 cols. Small focused files. Short doc comments on exports.

## Layout and ownership

| Dir | Owns |
|---|---|
| `core/` | Contracts (`core/src/types.ts` — main thread only), concept-graph algorithms, FSRS scheduler, BKT mastery, `PsiStore` file storage |
| `visual/` | Renderers: storyboard → Kurzgesagt-style HTML, storyboard → manim, manim runner, explorable HTML |
| `python/psi_manim/` | Python helpers for 3b1b-style manim scenes |
| `extension/` | The pi/omp extension: tools, slash commands, tutor mode, status widget |
| `crew/` | Multi-agent lesson studio: role prompts + runner that spawns `pi -p` role agents |
| `studio/` | Local web app (concept map, artifact gallery, flashcard review, progress) |
| `cli/` | `psi` command wrapping pi/omp |
| `skills/`, `prompts/` | Agent Skills (`<name>/SKILL.md`) and prompt templates (`*.md`) shipped with the package |
| `docker/` | Images: base (node+pi+psi), manim (python+manim+tex+ffmpeg), full; compose |
| `examples/topics/` | Sample topic packs (fixtures + demos) |
| `docs/` | User and architecture docs |

Only touch files in the directory you were assigned. Never `git commit` or `git push` — the main thread does that.

## Module APIs (stable — implement or consume exactly these)

### core (`core/src/index.ts` re-exports everything below)
- `slug.ts`: `slugify(s)`, `nowIso(date?)`, `newId(prefix)`
- `graph.ts`: `validateGraph(g): string[]` (empty = valid; checks unique ids, unknown prereqs, cycles),
  `topoOrder(g): string[]`, `frontier(g, mastered: Set<string>): Concept[]` (unmastered concepts whose prereqs
  are all mastered), `pathTo(g, targetId, mastered): string[]` (topo-ordered unmastered ancestors + target),
  `ancestors(g, id): Set<string>`, `toMermaid(g, mastered?): string`
- `fsrs.ts` (FSRS-5, default weights): `initFsrs(now?): FsrsState`,
  `schedule(s, rating, now?): { state: FsrsState; log: Omit<ReviewLog, "cardId"> }`,
  `retrievability(s, now?): number`, `isDue(s, now?): boolean`
- `bkt.ts`: `updateMastery(prev: Mastery | undefined, conceptId, correct, params?): Mastery`,
  `isMastered(m?): boolean` (pKnown ≥ 0.95)
- `store.ts`: `class PsiStore` — `new PsiStore(home = process.env.PSI_HOME ?? ~/.psi)`
  - `root`, `topicDir(topic)`, `listTopics(): string[]`
  - `readGraph/writeGraph`, `readPlan/writePlan`, `readLearner/writeLearner` (readers return `undefined` if absent)
  - `readCards(topic): Card[]`, `writeCards(topic, cards)`, `addCards(topic, drafts: Pick<Card,"conceptId"|"kind"|"prompt"|"answer"|"choices">[]): Card[]`
  - `dueCards(topic?: string, now?): Card[]` (all topics when omitted), `review(topic, cardId, rating, now?): Card`
    (applies FSRS, appends `reviews.jsonl`, updates BKT mastery with correct = rating ≥ 3)
  - `saveStoryboard(sb)`, `readStoryboard(topic, id)`, `saveExplorable(spec)`, `readExplorable(topic, id)`
  - `artifactsDir(topic)`, `writeArtifact(topic, filename, content): string` (returns abs path), `listArtifacts(topic): string[]`
  - On-disk layout: `$PSI_HOME/topics/<topic>/{graph.json, plan.json, cards.json, learner.json, reviews.jsonl,
    notes.md, storyboards/<id>.json, explorables/<id>.json, artifacts/*}`

### core — practice-first modules (re-exported from `core/src/index.ts`)
- On-disk: `$PSI_HOME/memory.json` (LearnerMemory, global), `$PSI_HOME/skills/<skill>/{plan.json, challenges.json,
  attempts.jsonl, sessions.jsonl, progress.json}`.
- `memory.ts`: `class MemoryStore` — `new MemoryStore(home = process.env.PSI_HOME ?? ~/.psi)`
  - `read(): LearnerMemory` (empty default), `setName(name)`
  - `remember(draft: Pick<MemoryItem,"kind"|"text"> & Partial<Pick<MemoryItem,"topic"|"skill"|"confidence"|"source">>): MemoryItem`
    (dedupes: same kind + highly similar text (token Jaccard ≥ 0.6) → updates the existing item, bumps confidence)
  - `update(id, patch): MemoryItem`, `forget(id): boolean`
  - `recall(q?: { kind?; skill?; topic?; query?; limit? = 12 }): MemoryItem[]` — ranked by keyword overlap, skill/topic match,
    confidence, recency; marks `lastUsedAt`
  - `addRecap(draft: Omit<SessionRecap,"id"|"date"> & { date? }): SessionRecap`, `recentRecaps(n = 3): SessionRecap[]`
  - `summarize(opts?: { skill?; topic?; maxChars? = 1800 }): string` — compact Markdown learner profile for system-prompt
    injection (name, goals, preferences, struggles/misconceptions, what clicked, last recap + "next"); "" when empty
- `gamify.ts` (pure): `xpFor(a: { outcome; kind; level; hintsUsed; lesson? }): number` (fail still earns XP; a written
  `lesson` on a fail earns a bonus; boss ×3), `levelFor(xp): { level; intoLevel; toNext }`,
  `updateStreak(p: Progress, now?): Progress`, `newBadges(p: Progress, a: Attempt): string[]`
  (e.g. "first-fail", "comeback", "streak-3", "streak-7", "hour-1", "hour-5", "hour-10", "hour-20", "boss-slayer", "no-hints")
- `practice.ts`: `class PracticeStore` — same home default
  - `listSkills(): string[]`, `readPlan(skill)`, `writePlan(plan)`, `nextSubskill(plan): Subskill | undefined`
    (priority asc, prerequisites solid, not solid), `setSubskillStatus(skill, id, status)`
  - `addChallenge(draft: Omit<Challenge,"id"|"createdAt"|"hints"> & { hints?: string[] }): Challenge`,
    `getChallenge(skill, id)`, `listChallenges(skill, opts?: { subskillId?; unattempted? })`
  - `checkAnswer(c: Challenge, answer: string): Outcome | undefined` — deterministic when `expected` is set
    (case/space/punctuation-insensitive; `acceptable`; numeric with `tolerance`); `undefined` = needs the tutor to grade
  - `recordAttempt(draft: Omit<Attempt,"id"|"at"|"xp"|"skill"|"subskillId"> & { at? }): { attempt; progress; leveledUp: boolean; badges: string[] }`
    (fills skill/subskillId from the challenge, computes XP, updates progress/streak/badges, links to the active session)
  - `startSession(skill, focus?, now?)`, `activeSession(skill?)`, `endSession(skill, now?): PracticeSession | undefined`
    (adds minutes to progress.minutesLogged; sessions longer than 3 h are capped)
  - `progress(skill): Progress`, `hours(skill): { logged: number; goal: number }`
  - `nextChallenge(skill, opts?)` (scheduler over this store; `reviewOnly` = warm-up across subskills),
    `reviewsDue(skill, now?): ChallengeSelection[]` (due reviews + spaced retries, best first)

- `state.ts`: `class StateStore` — `read(): PsiState`, `update(patch: Partial<Omit<PsiState,"updatedAt">>): PsiState`
  (`$PSI_HOME/state.json`; extension + web keep activeSkill/activeTopic/openChallenge here so a new process resumes).
- Challenge `format`: text | number | math | choice | code. `checkAnswer` grades text/number/math/choice; `code` is graded
  by running `setup` + learner code + `tests` in the browser sandbox (web) and recording the outcome.

### web (psi web — the browser UI; lives in `studio/`)
- Server `studio/src/server.ts` (existing routes stay) + new modules:
  - `studio/src/agent.ts` — `class AgentHub`: one `pi --mode rpc` child per chat (`-e extension`, `--skill skills`,
    `--session-dir $PSI_HOME/web-sessions`, an explicit tool list from `extension/src/tool-policy.ts` (execution tools —
    psi_run, psi_manim, psi_crew — only with `PSI_CODE_EXEC=1`; reads confined to PSI_HOME + bundled skills/prompts);
    `PSI_HOST=omp` → omp with its flag rules;
    model from `PSI_WEB_MODEL` or request). Strict LF JSONL framing (not readline).
  - `studio/src/practice-api.ts` — REST over PracticeStore/MemoryStore/StateStore.
- HTTP API (JSON; every non-GET must send header `X-Psi: 1`, else 403):
  - `POST /api/chat` {model?, skill?, topic?} → {id}; `GET /api/chat` → saved chats [{id, title, updatedAt}];
    `GET /api/chat/:id/events` (SSE: every pi stdout record as `data:`); `POST /api/chat/:id/prompt` {message};
    `POST /api/chat/:id/ui` {id, value?|confirmed?|cancelled?} (answers extension_ui_request); `POST /api/chat/:id/abort`;
    `DELETE /api/chat/:id`.
  - `GET /api/skills`, `GET /api/skills/:s` → {plan, progress, challenges}; `GET /api/skills/:s/challenges/:id`;
    `POST /api/skills/:s/challenges/:id/attempt` {answer, outcome?, hintsUsed?, lesson?} → server uses checkAnswer
    when it can, else requires outcome (code); returns {attempt, progress, leveledUp, badges};
    `GET /api/skills/:s/challenges/:id/hint?n=`; `GET /api/packs` (examples/skills list); `POST /api/packs/:slug/import`.
  - `GET /api/memory` (items + recaps + summary), `POST /api/memory` {kind, text}, `DELETE /api/memory/:id`;
    `GET /api/state`.
- Frontend `studio/public/` — vanilla ES modules, no build. Shell = `index.html` + `app.js` + `styles.css`.
  Modules: `js/api.js` (fetch helpers adding X-Psi), `js/chat.js` + `js/markdown.js` (chat view, streaming, markdown +
  KaTeX), `js/widgets.js` (inline renderers keyed by tool name: psi_challenge → challenge card, psi_attempt → XP/badge
  toast, psi_explorable/psi_storyboard → iframe, psi_progress_report → HUD), `js/codelab.js`
  (`runCode({language, setup, code, tests, expected}) → Promise<{ok, output, error, ms}>` in a Web Worker / iframe sandbox:
  Pyodide for python, a Worker for javascript, sql.js for sql; 10 s timeout), `js/practice.js` (skills dashboard,
  challenge runner), `js/memory.js` (memory panel). Libraries only from cdn.jsdelivr.net with exact versions:
  katex@0.16.11, pyodide@0.26.4, sql.js@1.11.0.

### knowledge graph + learning paths (second brain)
- `core/src/knowledge.ts`: `class KnowledgeStore` — `new KnowledgeStore(home = process.env.PSI_HOME ?? ~/.psi)`
  - `build(): KnowledgeGraph` — derives nodes/edges from PracticeStore skills (skill, subskills, prerequisite +
    contains edges, statuses/progress from progress + attempts), PsiStore topics (topic, concepts, prerequisite +
    contains, mastery from learner.json), MemoryStore items (note nodes + "about" edges when the note's skill/topic
    is set or its text names a node title), inferred "related" edges (token Jaccard over titles/tags/summaries
    across different skills/topics, weight ≥ 0.25, max 3 per node), plus learner links.
  - Learner links at `$PSI_HOME/graph/links.json`: `listLinks()`, `addLink(from, to)`, `removeLink(from, to)`.
  - Paths at `$PSI_HOME/graph/paths/<id>.json`: `listPaths()`, `readPath(id)`, `savePath(draft)` (validates step ids
    exist in the built graph), `deletePath(id)`.
  - `knowledgePathTo(graph, targetId, opts?: { includeDone?: boolean }): string[]` — topologically ordered unfinished
    prerequisite ancestors (via prerequisite + contains edges) ending at the target; done = status solid/mastered.
  - `neighborhood(graph, id, depth = 1): KnowledgeGraph` — local graph view.
- Web API: `GET /api/graph`, `GET /api/graph/neighborhood/:id?depth=`, `POST /api/graph/links` {from,to},
  `DELETE /api/graph/links` {from,to}, `GET /api/paths`, `GET /api/paths/:id`, `POST /api/paths` {title, goal, steps?,
  targetId?} (steps omitted + targetId → generated with knowledgePathTo), `PUT /api/paths/:id`, `DELETE /api/paths/:id`.
- Models: `GET /api/models` → `{ default, models: [{ id: "provider/model", provider, name, context?, reasoning? }] }`
  (from `pi --list-models`, cached 10 min; default = PSI_WEB_MODEL); `POST /api/chat` accepts `model`;
  `POST /api/chat/:id/model` {model} switches a live chat (pi RPC `set_model`). The browser remembers the last
  choice in localStorage `psi-model`.
- Extension tool `psi_path` {action: "list"|"get"|"create"|"next", id?, title?, goal?, targetId?, steps?} so the tutor can
  build and follow paths; injection names the active path and its next unfinished step.
- Frontend: `js/graph.js` (`mountGraph(el, { navigate, focus? })` — force-directed canvas graph, zero deps),
  `js/paths.js` (`mountPaths(el, { navigate, id? })`), `js/models.js` (`modelPicker({ value, onChange }) → HTMLElement`,
  `getPreferredModel()`). Routes: `#/graph`, `#/graph/:nodeId`, `#/paths`, `#/paths/:id`.

### teach first + ranked sources + game layer
- Types: `Source`, `SourceKind`, `Citation`, `SkillLesson`, `TutorMode`, `Verification`, `GameProfile`, `Achievement`,
  `LearnerSummary` in core/src/types.ts.
- `core/src/sources.ts`: `rankSource(input: { url; kind?; publisher?; license?; publishedAt? }): { rank; kind; rankReasons }`
  (trusted-domain table + kind weights + recency + license openness; plain-language reasons), `sourceId(url)`,
  `TRUSTED_SOURCES` (curated starting points per subject: python, javascript, sql, algorithms, calculus, linear algebra,
  physics, probability, machine-learning, general), `class SourceStore` — `$PSI_HOME/skills/<s>/sources.json`: `list(skill)` (rank desc),
  `add(skill, draft)` (dedupe by normalized URL, ranks it), `get(skill, id)`, `remove(skill, id)`.
- `core/src/lessons.ts`: `class LessonStore` — `$PSI_HOME/skills/<s>/lessons/<subskillId>.json`: `read`, `write`
  (requires ≥ 1 citation whose sourceId exists in the skill's sources), `list(skill)`.
- `core/src/profile.ts`: `class ProfileStore` — `$PSI_HOME/profile.json` (`read(): GameProfile` default
  {dailyGoal:{kind:"challenges",target:5}, tutorMode:"practice", gameLayer:"on"}, `update(patch)`), `summarize(now?): LearnerSummary`
  across all skills (today, calendar, streak, totalXp, level + levelTitle, combo = trailing run of successes in the active
  session, achievements = definitions in `ACHIEVEMENTS` evaluated from progress/attempts/lessons/paths).
- `gamify.ts`: `comboBonus(combo): number` (×1 under 3, ×1.2 at 3–4, ×1.5 at 5+ on base XP; never applies to fails),
  `levelTitle(level)`.
- Bundled packs ship `examples/skills/<s>/sources.json` and `lessons/<subskillId>.json`; `psi import-skill` and
  `POST /api/packs/:slug/import` copy them.
- Extension tools: `psi_lesson` {action: "show"|"write", subskillId?, lesson?} (show presents a lesson card
  widget; write saves a lesson with citations), `psi_sources` {action: "list"|"add"|"remove", skill?, url?, title?, kind?,
  excerpt?, license?}, `psi_fetch` {url} (reads a web page as text, ≤ 20 k chars, http/https only, no private IPs),
  `psi_search` {query, subject?} (`extension/src/practice/search.ts`: Wikipedia + Wikibooks, plus MDN / Stack Overflow /
  GitHub / arXiv by topic, Brave or SearXNG when configured; every candidate incl. the catalog scored by relevance to
  the goal, authority and popularity; off-topic dropped; never scrapes search pages; `evals/search-bench.ts` measures it), `psi_verify` {claim, skill?} → Verification with
  BM25-ranked evidence passages from cached fetched pages and conservative verdicts (likely-supported /
  possibly-contradicted / unclear); `psi_lesson write` rejects quotes not found on the fetched page;
  `/mode teach|practice|test`, `/verify <claim>`, `/sources`. Teaching contract: new or failed-twice subskill → lesson
  first; one question per message at most; every factual explanation cites [n] sources from the skill's list.
- Web API: `GET /api/me` → LearnerSummary, `PUT /api/me/profile` {dailyGoal?, tutorMode?, gameLayer?},
  `GET /api/skills/:s/sources`, `GET /api/skills/:s/lessons/:subskillId`.

### continuous lessons, sandboxed code execution, light Socratic prompts
- `psi_run` {language: "python"|"javascript"|"sql"|"bash", code, setup?, stdin?} — executes code for demos and to
  VERIFY computed claims before stating them. Enabled only when `PSI_CODE_EXEC=1` (set by the Docker `web`/`psi`
  services; off on a bare host unless the user opts in). With `PSI_RUN_SOCKET` (Compose) it runs in the separate
  no-network, no-secrets `runner` container via `extension/src/practice/run-server.ts` (fails closed if unreachable);
  `run-core.ts` holds the pi-free executor. Runs in a fresh temp dir with a stripped env, 10 s timeout,
  output capped at 64 KB, no inherited secrets. sql runs in an in-memory SQLite (`python3 -c` with sqlite3). Result:
  stdout, stderr, exitCode, ms + `details.widget {type:"run", language, code, stdout, stderr, exitCode, ms}`.
- `psi_next_steps` {options: [{label, message}] (2–4)} — the tutor ends every turn by offering what to do next as
  one-click replies (e.g. "Continue", "Show me another example", "I'm stuck", "Try one myself"); widget
  `{type:"next_steps", options}`. The web chat also always shows a default "Continue" reply after a teaching turn.
- `psi_ask` {question, kind: "predict"|"why"|"what-if", hint?} — a light Socratic prompt inside a lesson (not graded,
  no XP, a prediction before a demo, never in a turn with a challenge); widget `{type:"socratic", question, kind, hint}` with an
  answer box and "Just show me" (sends "Just show me" so the lesson continues).
- Flow contract (inject.ts): practise as you go — short chunks (one idea → demo with psi_run) and ONE quick graded
  psi_challenge (a faded example with new values) after every 1–2 chunks (`CHECK_EVERY`: teach 3, practice 2; test
  mode is all challenges); an independent problem ends a subskill; never end a turn without psi_next_steps;
  "continue"/"next" means proceed without re-asking. Guards count teaching turns since the last challenge
  (`state.taughtSinceCheck`, session-only) and the per-request reminder nudges a check when it is due.
- Session warm-up: the first turn with a skill computes `PracticeStore.reviewsDue(skill)` (max 3); the tutor serves
  them with `psi_challenge` action "review" before new material (allowed on continue turns; counts in
  `state.warmup`).
- Variants: `Challenge.variantOf` (stored as the family's original id; `addChallenge` validates it, keeps the original's gate class (boss / level ≥ 4) and inherits the
  subskill). A challenge and its variants share one FSRS memory in the scheduler; a due retry serves an unattempted
  variant, else returns `needsVariant: true` and `psi_challenge` hands the tutor the original prompt + last tries
  to write one. Missed items become retry-eligible after 2 other attempts or `RETRY_AFTER_MS` (30 min).

### adaptive practice, guarantees, evals
- `core/src/scheduler.ts`: `nextChallenge(skill, opts?: { subskillId?, now?, reviewOnly? })` →
  `{ challenge, reason: ChallengeReason, needsVariant? }`, `dueReviews(skill, input, opts?)` — interleaved,
  spaced selection (new / due review / delayed retry / stretch), difficulty adapts toward ~70–85% success; used by
  `psi_challenge` action "next" and `GET /api/skills/:s/next`. Hints never reduce XP ("help-then-solve" badge).
- `core/src/lock.ts`: `withFileLock(path, fn)` — read-modify-writes in PracticeStore, MemoryStore, ProfileStore,
  StateStore, KnowledgeStore and SourceStore are serialized across processes (LessonStore writes whole files;
  PsiStore topic files are single-writer).
- Attempts are skill-scoped (`recordAttempt` takes `skill`); browser-reported code results are `verified: false`.
- `extension/src/practice/guards.ts`: code-level guarantees — next steps always include Continue; an open challenge's
  answers are redacted from tutor text and options (single-digit answers only after an answer cue or in a table cell); a challenge (create/next/review) whose answer this turn's already-streamed text showed is refused (`ANSWER_SHOWN`) rather than redacted after the fact;
  challenges and psi_ask are blocked on continue/show-me turns until something was taught; a new subskill's first
  challenge waits for its lesson (not in test mode; released after two blocks); the turn after a graded miss must
  teach before a new challenge or psi_ask; [n] citations beyond the skill's sources are removed. Each intervention
  appends a `psi-guard` entry. `inject.ts` also adds a short per-request reminder (cite [n], one question last, no
  rhetorical questions, continue = teach now, open challenge id) to a copy of the latest message — never persisted.
- `studio/src/agent.ts` holds streamed text/thinking deltas while a challenge card is open (shown, not yet attempted),
  so the browser renders only the guard-redacted `message_end`.
- `evals/`: scripted learner sessions against the real model; `node evals/run.ts …` then `node evals/score.ts <dir>`.

### visual (`visual/src/index.ts` re-exports) — optional extras
- `palettes.ts`: `type Palette = { name; bg; fg; muted; accent: string[]; deep; glow }`, `PALETTES`, `paletteFor(style, name?)`
- `storyboard-html.ts`: `validateStoryboard(sb): string[]`, `renderStoryboardHtml(sb, opts?: { autoplay?: boolean; speech?: boolean }): string`
- `explorable.ts`: `validateExplorable(spec): string[]`, `renderExplorableHtml(spec): string`
- `manim.ts`: `storyboardToManim(sb): string` (Python source using `psi_manim`), `manimAvailable(): Promise<{ local: boolean; docker: boolean }>`,
  `renderManim(opts: { code: string; scene?: string; outDir: string; quality?: "l"|"m"|"h"; runner?: "auto"|"local"|"docker"; signal?: AbortSignal }): Promise<RenderResult>`
  (docker image name: `psi-manim:latest`, override with `PSI_MANIM_IMAGE`)

### crew (`crew/src/index.ts`)
- `roles.ts`: `ROLE_PROMPTS: Record<CrewRole, string>`
- `runner.ts`: `runCrewTask(task, opts?: { store?; host?: "pi"|"omp"; model?; signal?; bin?: string }): Promise<CrewResult>`,
  `runCrew(tasks, opts & { concurrency?: number }): Promise<CrewResult[]>`,
  `buildLesson(topic, conceptId, opts?): Promise<CrewResult[]>` (intuition ∥ storyteller → visualizer → quizmaster ∥ critic)
- Host binary: `PSI_HOST` env (`pi` default, or `omp`); `PSI_BIN` overrides the path.

### extension
- Entry `extension/src/index.ts` default-exports `(pi: ExtensionAPI) => void`.
- Tool names are prefixed `psi_`; commands are `/learn`, `/map`, `/lesson`, `/quiz`, `/review`, `/visualize`, `/explore`, `/crew`, `/studio`, `/progress`, `/tutor`.
- Practice-first layer lives in `extension/src/practice/` and is registered via `registerPractice(pi, deps)` from
  `extension/src/practice/index.ts`:
  - tools: `psi_memory_remember`, `psi_memory_recall`, `psi_memory_forget`, `psi_recap`, `psi_skill_plan`,
    `psi_challenge` (action create [variantOf?] / next / review), `psi_attempt` (grade/record; uses checkAnswer first), `psi_hint`,
    `psi_practice_session` (start/stop/status), `psi_progress_report`
  - commands: `/skill <thing to learn>` (20-hour deconstruction), `/practice [focus] [minutes]`, `/challenge [kind]`,
    `/boss`, `/quest` (build-to-learn project), `/hint`, `/remember <fact>`, `/memory`, `/forget`, `/recap`, `/hours`, `/streak`
  - every session: memory summary + active skill + progress injected via `before_agent_start`; "welcome back" on session_start
