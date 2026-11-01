# ψ psi

psi is a learning agent that teaches first and then has you practice. It runs on
[pi](https://pi.dev) (or [oh-my-pi](https://github.com/can1357/oh-my-pi)) and is used mainly through a local web
app: a tutor in chat, challenge cards, a code lab, and a record of how you learn.

```sh
node cli/src/psi.ts web --open      # http://127.0.0.1:4173
```

## What it does

- **Lessons before questions.** A new subskill starts with a short lesson: explanation, a worked example, common
  pitfalls. Factual statements cite numbered sources ([1], [2]) from a ranked list; each source shows why it ranks
  where it does (official docs, open textbook, recency, license). `/verify <claim>` retrieves the matching passages
  and gives a cautious verdict (likely supported, possibly contradicted, or unclear) that you can check yourself.
- **Continuous lessons.** The tutor teaches in chunks, may ask an ungraded "predict / why / what if" question, and
  ends each turn with one-click next steps, always including Continue. "Continue" means continue.
- **Interactive practice.** Challenges are text, number, math, multiple choice, or code. Exact answers are graded
  deterministically; open answers against a rubric. Code runs in your browser: Python via Pyodide, JavaScript in a
  Worker, SQL via sql.js.
- **Adaptive, spaced practice.** The scheduler mixes new items, due reviews, a second try at ones you missed, and an
  occasional step up, aiming for roughly 70–85% success. Each pick says why it was chosen.
- **Memory.** psi keeps goals, preferences, struggles, and what clicked in `~/.psi/memory.json`, and picks up from
  your last recap. You can see and delete every item.
- **Knowledge graph and learning paths.** Skills, steps, topics, and notes form one graph; a learning path is an
  ordered route to a goal, generated from prerequisites or built with the tutor.
- **A game layer you can turn off.** Failed attempts still earn XP; writing down what you'll change earns a bonus.
  Hints never cost XP. Streaks, levels, and badges can be set to On, Quiet (numbers, no celebrations), or Off.
- **Tutor code execution in Docker.** In the Docker setup the tutor can run demos and check computed results before
  stating them (`psi_run`), render Manim videos, and run a lesson crew. On a bare host these tools are off unless you
  set `PSI_CODE_EXEC=1`.
- **Measured.** `evals/` runs scripted learner sessions against a real model and scores how well the tutor kept its
  contract: teach first, one question at a time, next steps, citations, no spoilers, no double grading.

It builds on Josh Kaufman's *first 20 hours* (deconstruct a skill, learn enough to self-correct, practice) and Mark
Rober's *Super Mario effect* (failure is cheap and still counts). [Learning science](docs/learning-science.md) covers
the evidence and what psi does not claim.

## Quick start

Requires Node ≥ 22.18 (no build step, zero runtime dependencies) and an authenticated `pi` for the tutor.

```sh
git clone https://github.com/argenestel/psiharness && cd psiharness
node cli/src/psi.ts doctor
node cli/src/psi.ts web --open
```

Pick a skill pack on the start page. Without a model, you can still drill a pack in the terminal:

```sh
node cli/src/psi.ts import-skill examples/skills/mental-math
node cli/src/psi.ts practice mental-math
```

The terminal tutor is `node cli/src/psi.ts learn` (then `/skill <what to learn>` and `/practice`). It is also a pi
package: `pi install git:github.com/argenestel/psiharness`.

### Docker

```sh
docker compose -f docker/compose.yml up -d      # psi web on http://localhost:4173
```

The server, the agent behind every chat, and its tools run in a non-root, read-only container published on
loopback only. Compose copies your host pi login into a container volume, or reads API keys from `docker/.env`.
It enables tutor code execution inside the container. Container isolation limits what that code can reach on your
host; it is not a sandbox against a hostile learner. Details: [docker/README.md](docker/README.md).

### Evals

```sh
node evals/run.ts --dry-run                      # check scenarios without a model
node evals/run.ts --model xai/grok-4.6           # run all scenarios against a real model
node evals/score.ts evals/results/<timestamp>    # write report.md
```

Scores measure adherence to the tutor contract, not learning outcomes. See [evals/README.md](evals/README.md).

## Skill packs

`examples/skills/` has packs with a 20-hour plan, challenges, ranked sources, and a cited lesson per subskill:
python-foundations, javascript-essentials, sql-lab, sql-queries, algorithms-big-o, calculus-intuition,
linear-algebra-practice, probability-statistics, physics-mechanics, mental-math, regex, git-fluency, and
spanish-cafe-a1. `examples/topics/` has concept packs for the optional concept-map and visual tutor.

## Commands

In a session: `/skill`, `/practice`, `/challenge`, `/boss`, `/quest`, `/hint`, `/mode teach|practice|test`,
`/verify`, `/sources`, `/path`, `/remember`, `/memory`, `/forget`, `/recap`, `/hours`, `/streak`; concept layer:
`/learn`, `/map`, `/lesson`, `/quiz`, `/review`, `/visualize`, `/explore`, `/crew`, `/progress`, `/tutor`, `/studio`.

From the shell: `psi web`, `psi learn`, `psi skills`, `psi practice`, `psi hours`, `psi progress`, `psi memory`,
`psi import-skill`, `psi review`, `psi doctor`, and more (`psi --help`).

Every tool, command, route, and environment variable: [docs/tools-and-commands.md](docs/tools-and-commands.md).

## Docs

[Getting started](docs/getting-started.md) · [Architecture](docs/architecture.md) ·
[Tools and commands](docs/tools-and-commands.md) · [Authoring](docs/authoring.md) ·
[Learning science](docs/learning-science.md) · [oh-my-pi compatibility](docs/omp-compat.md) ·
[Contributing](CONTRIBUTING.md)

## License

Free for personal and noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
Commercial and enterprise use needs a separate license; see [COMMERCIAL.md](COMMERCIAL.md).
