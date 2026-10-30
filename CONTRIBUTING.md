# Contributing to psi

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
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` |
| `npm test` | `node --test` over `core visual crew studio cli extension` `test/*.test.ts` |
| `npm run check` | both; must pass before you open a PR |
| `npm run studio` | standalone studio server (port 4173) |
| `npm run psi -- <args>` | the CLI |

Run one file with `node --test core/test/fsrs.test.ts`. Use a throwaway store for manual testing:
`PSI_HOME=$(mktemp -d) node cli/src/psi.ts import examples/topics/exponential-growth`.

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

**Pedagogy.** Nothing except a graded review may change mastery. Tools, prompts, and skills must name `psi_*` tools
and parameters exactly as registered in `extension/src/tools.ts` — see
[docs/tools-and-commands.md](docs/tools-and-commands.md).

## Running studio and crew locally

```sh
# Studio against a scratch store
PSI_HOME=/tmp/psi-dev node cli/src/psi.ts studio --port 0 --open
PSI_HOME=/tmp/psi-dev PSI_STUDIO_PORT=4173 npm run studio

# Crew (needs an authenticated pi or omp; a lesson spawns five role agents)
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

Workflows are staged in `ci/workflows/` (not yet active) because the pushing token lacks the `workflow` scope:

- `ci.yml` — `npm ci`, typecheck, tests on Node 22.
- `docker.yml` — builds `psi`, `psi-manim`, then `psi-full` and pushes them to GHCR.

To enable them, move them to `.github/workflows/` (see [ci/README.md](ci/README.md)). Until then, run
`npm run check` locally before every PR.

## Pull requests

- One concern per PR; stay inside the module you are changing.
- `npm run check` passes.
- Update `docs/` when you change a tool, command, flag, env var, schema, or on-disk path.
