# ψ psi — a practice-first learning agent

Most agent harnesses are built to **do the work for you**. psi is built so **you get good at something**.

psi is a [pi](https://pi.dev)-style terminal agent (it runs inside pi or [oh-my-pi](https://github.com/can1357/oh-my-pi))
specialized for learning by doing. It remembers how you learn, breaks a skill into the parts that matter,
and runs short, game-like practice sessions in plain text.

```
psi learn          # then: /skill SQL queries   →   /practice
```

## The ideas it's built on

- **The first 20 hours** (Josh Kaufman): you don't need 10,000 hours to get good enough. Define a concrete target,
  deconstruct the skill, learn just enough to self-correct, remove the barriers to practice, and put in 20 focused hours.
- **The Super Mario effect** (Mark Rober): people learn faster when failure is part of a game instead of a judgement.
  In psi a failed attempt still earns XP, and naming what you'll try differently earns a bonus.
- **Learning by building**: quests are small real projects with milestones, not lectures.
- **Learning science**: predict before you're told, retrieval over re-reading, spacing and interleaving, honest grading.

## What a session looks like

```
ψ sql-queries · Lv 3 ▰▰▰▰▱▱▱▱▱▱ · 🔥4 · 6.5/20h

Welcome back — last time: JOINs clicked once you drew the two tables side by side. Next: GROUP BY with HAVING.

> /practice 20

Challenge · apply · level 2
  Using orders(id, customer_id, total), list customers whose total spend is over 500.
  Answer with a single SQL query.

> select customer_id, sum(total) from orders group by customer_id where sum(total) > 500
✗ Not quite — still earns XP for the attempt.
  What will you try differently?
> filters on groups go in HAVING, after GROUP BY
✓ Lesson logged (bonus XP). Try it again?
```

## Features

| | |
|---|---|
| **Learner memory** | Goals, background, preferences, what clicked, recurring struggles, misconceptions. It's recalled every session and stays private on your machine (`~/.psi/memory.json`). `/remember`, `/memory`, `/forget`. |
| **20-hour skill plans** | `/skill <what>` sets a concrete target, deconstructs it into subskills (the vital few first), picks a few (≤ 5) resources, lists practice barriers and their fixes, and tracks hours toward 20. |
| **Interactive practice** | `/practice`, `/challenge`, `/boss`, `/hint`. Quickfire, predict, debug, apply, explain, build, and boss challenges, graded instantly when there's an exact answer and by rubric otherwise. |
| **Game layer** | XP for every attempt (failing included), levels, daily streaks, badges (`first-fail`, `comeback`, `no-hints`, `hour-20`…). |
| **Build quests** | `/quest` gives you a small real project with 3–5 milestones for the active skill. |
| **Recaps** | `/recap` writes what you did, what was hard, and what to do next. The next session starts from it. |
| **Terminal drills** | `psi practice <skill>` drills auto-gradable challenges with no model at all. |
| **Optional extras** | Concept maps, spaced flashcards (FSRS-5), a crew of role agents, and 3b1b/Kurzgesagt-style visuals (manim, animated explainers, slider explorables) for when a picture really helps. |

## Quick start

Requires Node ≥ 22.18. No build step, zero runtime dependencies.

```bash
git clone https://github.com/argenestel/psiharness && cd psiharness
node cli/src/psi.ts doctor

# try a ready-made skill pack without any model
node cli/src/psi.ts import-skill examples/skills/mental-math
node cli/src/psi.ts practice mental-math

# the full agent (pi by default; PSI_HOST=omp for oh-my-pi)
node cli/src/psi.ts learn
```

Or install it as a pi package: `pi install git:github.com/argenestel/psiharness`.

### Commands

**Inside the agent**

| Command | |
|---|---|
| `/skill <what to learn>` | 20-hour deconstruction: target, subskills, resources, barriers |
| `/practice [focus] [minutes]` | A timed practice block, one challenge at a time |
| `/challenge [kind]` · `/boss` · `/quest` | A single challenge, a mixed boss fight, or a build quest |
| `/hint` | The next rung of the hint ladder |
| `/remember <fact>` · `/memory` · `/forget <id>` | Manage what psi knows about you |
| `/recap` · `/hours` · `/streak` | Wrap up, and see progress |
| `/learn` `/map` `/lesson` `/quiz` `/review` | Concept maps and spaced flashcards |
| `/visualize` `/explore` `/crew` `/studio` | Optional visuals and the multi-agent lesson crew |

**From the shell**

`psi skills`, `psi practice <skill>`, `psi hours`, `psi progress`, `psi memory`, `psi import-skill <dir>`, `psi learn`,
`psi review`, `psi doctor`. Run `psi --help` for everything.

## Skill packs

`examples/skills/` has ready-to-practice packs: **sql-queries**, **regex**, **mental-math**, **git-fluency**, and
**spanish-cafe-a1**. Each has a 20-hour plan and auto-graded challenges.

`examples/topics/` has concept packs (Fourier transform, linear transformations, entropy, backpropagation,
exponential growth) for the optional concept-map and visual tutor.

## Docker

```bash
docker compose -f docker/compose.yml run --rm psi
```

Images: `psi` (agent), `psi-manim` and `psi-full` (with the optional manim renderer). See [docker/README.md](docker/README.md).

## Docs

[Getting started](docs/getting-started.md) · [Architecture](docs/architecture.md) ·
[Tools and commands](docs/tools-and-commands.md) · [Learning science](docs/learning-science.md) ·
[oh-my-pi compatibility](docs/omp-compat.md) · [Contributing](CONTRIBUTING.md)

## License

Free for personal and noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
Commercial and enterprise use needs a separate license; see [COMMERCIAL.md](COMMERCIAL.md).
