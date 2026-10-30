# psi docs

psi is a pi-style, text-first learning agent: remember the learner, deconstruct a skill, practice,
reflect, and build. Concept maps, spaced flashcards, and visuals are optional extras.

| If you want to… | Read |
| --- | --- |
| Import a skill pack, practice without a model, then start the agent | [Getting started](getting-started.md) |
| Look up a `psi_*` tool, slash command, CLI flag, or env var | [Tools and commands](tools-and-commands.md) |
| Write practice skill packs; optionally author concept packs, visuals, host skills, or prompts | [Authoring](authoring.md) |
| Understand modules, data flow, storage, tutor injection, crew, rendering, studio API | [Architecture](architecture.md) |
| Know why psi teaches the way it does, and what it deliberately avoids | [Learning science](learning-science.md) |
| Run psi under oh-my-pi (`omp`) | [omp compatibility](omp-compat.md) |
| Hack on psi | [CONTRIBUTING.md](../CONTRIBUTING.md) · [AGENTS.md](../AGENTS.md) |

Elsewhere in the repo:

- [README.md](../README.md) — overview.
- [docker/README.md](../docker/README.md) — images, build args, auth, compose.
- [python/README.md](../python/README.md) — `psi_manim` helpers.
- [ci/README.md](../ci/README.md) — staged GitHub Actions workflows.
- `examples/skills/` — practice packs (`psi import-skill examples/skills/mental-math`).
- `examples/topics/` — importable topic packs (`psi import examples/topics/<pack>`).
- `skills/`, `prompts/` — the skills and prompt templates shipped to the host.
