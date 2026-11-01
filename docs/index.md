# psi docs

psi is a teach-first, practice-first learning agent on pi, used mainly through its browser app (psi web):
sourced lessons, interactive and in-browser code practice, adaptive spaced review, learner memory, a knowledge
graph with learning paths, and a game layer you can turn down or off. Concept maps, spaced flashcards, and visuals
are optional extras.

| If you want to… | Read |
| --- | --- |
| Start psi web, import a skill pack, practice without a model, run the terminal agent | [Getting started](getting-started.md) |
| Look up a `psi_*` tool, slash command, CLI command, HTTP route, or env var | [Tools and commands](tools-and-commands.md) |
| Write practice skill packs; optionally author concept packs, visuals, host skills, or prompts | [Authoring](authoring.md) |
| Understand modules, scheduler, locks, guards, verification, storage, web server, crew, rendering, evals | [Architecture](architecture.md) |
| Know why psi teaches the way it does, and what it deliberately avoids | [Learning science](learning-science.md) |
| Run psi under oh-my-pi (`omp`) | [omp compatibility](omp-compat.md) |
| Hack on psi | [CONTRIBUTING.md](../CONTRIBUTING.md) · [AGENTS.md](../AGENTS.md) |

Elsewhere in the repo:

- [README.md](../README.md) — overview.
- [docker/README.md](../docker/README.md) — images, build args, auth, compose.
- [python/README.md](../python/README.md) — `psi_manim` helpers.
- [ci/README.md](../ci/README.md) — staged GitHub Actions workflows.
- [evals/README.md](../evals/README.md) — scripted tutor-contract evaluations against a real model.
- [studio/DESIGN.md](../studio/DESIGN.md) — psi web design system and copy rules.
- `examples/skills/` — practice packs (`psi import-skill examples/skills/mental-math`).
- `examples/topics/` — importable topic packs (`psi import examples/topics/<pack>`).
- `skills/`, `prompts/` — the skills and prompt templates shipped to the host.
