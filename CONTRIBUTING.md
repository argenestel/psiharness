# Contributing to psi

psi is a teach-first, practice-first learning agent with a browser UI (psi web). Prioritize sourced lessons,
learner memory, first-20-hours plans, auto-graded and in-browser code challenges, failure reflections, and build
quests. Concept maps and visuals are optional extras.

Read [AGENTS.md](AGENTS.md) first: it holds the module map and the stable APIs. This file covers setup and workflow.

## Setup

- **Node ≥ 22.18.** Node runs the `.ts` sources directly via type stripping. There is no build step or bundler.
- **Zero runtime dependencies.** `devDependencies` (TypeScript, `@types/node`, and the pi SDK for typechecking the
  extension) are only for checks.

```sh
git clone https://github.com/argenestel/psiharness && cd psiharness
npm ci                 # dev dependencies only
npm run check          # typecheck + all tests
node cli/src/psi.ts doctor
```

| Script | Runs |
| --- | --- |
| `npm run typecheck` | `tsc` over the root project, the browser modules (`studio/public`), and the sandbox workers |
| `npm test` | `node --test` over `core visual crew studio cli extension` `test/*.test.ts` |
| `npm run check` | both; must pass before you open a PR |
| `npm run studio` | the psi web server (port 4173), same as `node cli/src/psi.ts web` |
| `npm run psi -- <args>` | the CLI |

Run one file with `node --test core/test/fsrs.test.ts`. Use a throwaway store for manual testing:
`PSI_HOME=$(mktemp -d) node cli/src/psi.ts import-skill examples/skills/mental-math`.

## Typechecking

`npm run typecheck` runs three checks; all must pass:

- `tsc --noEmit -p tsconfig.json` — server/core/extension TypeScript.
- `tsc -p studio/public/tsconfig.json` — browser ES modules (JSDoc-checked).
- `tsc -p studio/public/js/runners/tsconfig.json` — sandbox web workers with the WebWorker library.

Browser JavaScript has no build step; types are expressed as JSDoc. The browser and worker configs are separate
from the root check so DOM and worker globals stay isolated. The worker config uses `noResolve` and a narrow
`compareRows` declaration to avoid importing the DOM-based editor into its program; the browser check covers
that helper's implementation. `moduleDetection: "force"` isolates each worker's script globals for checking only.
Also run `npm test` for runtime coverage.

## Conventions

**TypeScript (erasable syntax only).** `tsconfig.json` sets `erasableSyntaxOnly` and `verbatimModuleSyntax`:

- no `enum`, `namespace`, or constructor parameter properties;
- `import type { … }` for type-only imports;
- relative imports include `.ts`: `import { slugify } from "../../core/src/slug.ts"`.

**Dependencies.** Node built-ins only (`node:fs`, `node:path`, `node:child_process`, `node:http`, `node:test`, …). Do
not add packages or edit `package.json`/the lockfile without discussion. Only `extension/` may import
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`; `cli/` and `crew/` may *spawn* `pi`/`omp`.

**Contracts.** `core/src/types.ts` is the shared contract; change it in a dedicated PR and update every consumer. Keep
the module APIs listed in AGENTS.md stable.

**Generated HTML.** Self-contained single files with inline CSS/JS. External scripts only from
`https://cdn.jsdelivr.net/npm/` with exact pinned versions (e.g. `katex@0.16.11`), and the page must still work
offline.

**Tests.** `node:test` + `node:assert/strict`, in `<module>/test/*.test.ts`. Never spawn a real model in tests;
point `PSI_BIN` at a stub and `PSI_HOME` at a temp directory (see `crew/test/` and `cli/test/`).

**Style.** Tabs, double quotes, semicolons, 120 columns. Small focused files. A short doc comment on every export.

**Pedagogy.** Practice XP rewards attempts and reflection; it is not mastery. Only graded card reviews update
concept BKT mastery. Hints never cost XP. Teach before testing: a lesson in chunks, one challenge at the end of a
subskill, one question per message. Tools, prompts, and skills must name `psi_*` tools and parameters exactly as
registered in `extension/src/practice/*.ts` or `extension/src/tools.ts` — see
[docs/tools-and-commands.md](docs/tools-and-commands.md). A new tool is not visible to web chats until it is added
to `extension/src/tool-policy.ts`; mark anything that executes code `execution: true` and register it only when
`PSI_CODE_EXEC=1`. Skills that mention an execution tool must say what to do when it is absent.

## Contributing learning material

Practice packs live in `examples/skills/`: a plan, challenges (auto-gradable answers where appropriate, rubrics for
open work, `tests` for code), ranked `sources.json`, and a cited lesson per subskill. Include one boss and one build quest by convention. Follow
[Writing a skill pack](docs/authoring.md#writing-a-skill-pack) and exercise canonical, alternate, and wrong answers
with the answer checker before importing. Host instruction skills and prompt templates live separately in `skills/`
and `prompts/`. Optional concept packs live in `examples/topics/`.

[Getting started](docs/getting-started.md) · [Architecture](docs/architecture.md) ·
[Tools and commands](docs/tools-and-commands.md) · [Learning science](docs/learning-science.md).

There is no separate build, lint, or static-analysis script. TypeScript checking and the Node test suite are the
repository's automated checks; run both via `npm run check`.

## Evals

Changes to the tutor contract, injection, guards, skills, or prompts should be checked against a real model:

```sh
node evals/run.ts --dry-run                       # validate scenarios without a model
node evals/run.ts --scenario python-foundations-first-lesson --model xai/grok-4.6
node evals/score.ts evals/results/<timestamp>
```

Evals need an authenticated `pi`; `npm test` does not run them. See [evals/README.md](evals/README.md).

## Running studio and crew locally

```sh
# Studio against a scratch store
PSI_HOME=/tmp/psi-dev node cli/src/psi.ts studio --port 0 --open
PSI_HOME=/tmp/psi-dev PSI_STUDIO_PORT=4173 npm run studio

# Crew (needs an authenticated pi or omp; a lesson runs five role tasks)
PSI_HOME=/tmp/psi-dev node cli/src/psi.ts crew exponential-growth doubling-time
PSI_HOST=omp node cli/src/psi.ts crew <topic> <conceptId> --model <model>
```

Crew writes `topics/<topic>/crew/log.jsonl` and per-role briefs; each role times out after 15 minutes. To try the
extension inside a host without the CLI: `pi -e extension/src/index.ts --skill skills --prompt-template prompts`.

## Docker

```sh
docker build -f docker/base.Dockerfile -t psi:latest .
docker build -f docker/base.Dockerfile --build-arg INSTALL_OMP=1 -t psi:omp .
docker build -f docker/manim.Dockerfile -t psi-manim:latest .
docker build -f docker/full.Dockerfile -t psi-full:latest .   # needs psi:latest first
docker compose -f docker/compose.yml build
```

Build from the repo root. `.dockerignore` keeps `node_modules`, `.env*`, `.psi`, media, and caches out of the context.
Pins and auth options: [docker/README.md](docker/README.md).

## CI

Workflows are staged in `ci/workflows/` (not yet active) as described in [ci/README.md](ci/README.md):

- `ci.yml` — `npm ci`, typecheck, tests on Node 22.
- `docker.yml` — builds `psi`, `psi-manim`, then `psi-full` and pushes them to GHCR.

To enable them, move them to `.github/workflows/` (see [ci/README.md](ci/README.md)). Until then, run
`npm run check` locally before every PR.

## Pull requests

- One concern per PR; stay inside the module you are changing.
- `npm run check` passes.
- Update `docs/` when you change a tool, command, flag, env var, route, schema, or on-disk path.

## License

psi is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md); commercial and enterprise use needs a
separate license, described in [COMMERCIAL.md](COMMERCIAL.md).
