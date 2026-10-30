# ψ psi-harness — agent conventions

psi is a learning harness built on **pi** (`@earendil-works/pi-coding-agent`) and compatible with
**oh-my-pi** (`omp`, `@oh-my-pi/pi-coding-agent`, which rewrites `@earendil-works/*` imports to its own
copies). It teaches big ideas the way 3Blue1Brown and Kurzgesagt do: concept graphs, intuition first,
animated visuals, and spaced retrieval practice.

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

### visual (`visual/src/index.ts` re-exports)
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
