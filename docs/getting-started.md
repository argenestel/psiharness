# Getting started

psi runs TypeScript directly on Node ≥ 22.18 (type stripping). It has no build step and zero runtime dependencies.
Teaching sessions need an installed, authenticated [pi](https://pi.dev) or oh-my-pi (`omp`) host with model access;
psi never handles provider credentials itself.

## Install

**As a pi package** — loads the extension, skills, and prompt templates declared under `pi` in `package.json`:

```sh
pi install git:github.com/argenestel/psiharness
```

Then start `pi` and type `/learn Fourier transform`. This does not put a `psi` command on your `PATH`.

**From a checkout** — gives you the `psi` CLI, which launches pi/omp with psi preloaded:

```sh
git clone https://github.com/argenestel/psiharness && cd psiharness
node cli/src/psi.ts doctor
node cli/src/psi.ts learn "Fourier transform"
```

In these docs `psi` means `node cli/src/psi.ts` (or `npm run psi --`). For a real command, symlink the entry point the
way the Docker image does: `ln -s "$PWD/cli/src/psi.ts" ~/.local/bin/psi`. Node refuses to strip types from files under
`node_modules`, so run psi from a checkout or symlink rather than an `npm install` copy.

### Choosing the host

| Setting | Effect |
| --- | --- |
| `--host pi\|omp` | Selects the host for one command; overrides `PSI_HOST`. |
| `PSI_HOST=omp` | Default host (otherwise `pi`). |
| `PSI_BIN=/path/to/binary` | Executable to run instead of `pi`/`omp`. |
| `--model <m>`, `--thinking <level>` | Forwarded to the host. |
| `-- <args>` | Everything after `--` is forwarded to the host unchanged. |

```sh
PSI_HOST=omp psi learn "backpropagation"
```

With omp, psi first checks that `omp --help` runs and prints an install hint if it does not.

### Docker

```sh
docker compose -f docker/compose.yml run --rm psi      # tutor in a container
docker compose -f docker/compose.yml up studio         # studio on http://localhost:4173
```

Both services share the `psi-data` volume (`PSI_HOME=/data`). Images: `psi` (Node + pi + psi, optional omp via
`--build-arg INSTALL_OMP=1`), `psi-manim` (Python, Manim, TeX, FFmpeg), `psi-full` (base + Manim). See
[docker/README.md](../docker/README.md) for auth mounts and build arguments.

## Where data lives

Everything is plain files under `PSI_HOME` (default `~/.psi`): `topics/<topic>/` holds the graph, plan, cards, learner
model, review log, specs, and rendered artifacts; `workspace/` is the host's working directory when launched by the
CLI. Layout details: [architecture](architecture.md#storage).

## First session

```sh
psi learn "Fourier transform"
```

The CLI launches the host in `$PSI_HOME/workspace` with `--psi-tutor` (tutor mode on) and passes
`/learn Fourier transform` as the initial message. `/learn` sets the active topic to the slug `fourier-transform` and
asks the agent to diagnose your prior knowledge with one question, wait for your answer, then save a prerequisite graph
(`psi_concept_graph`) and lesson plan (`psi_lesson_plan`). These are instructions to a model, so wording and depth
vary by host and model.

Continue inside the session:

| Step | Type | What happens |
| --- | --- | --- |
| Diagnose | your answer | Guides graph and plan creation. Explanations never grant mastery. |
| Map | `/map` | Mermaid source of the graph plus the frontier (concepts you are ready for). |
| Lesson | `/lesson` or `/lesson <id or title>` | First frontier concept by default: hook → intuition → visual → formalism → check. |
| Visual | `/visualize [focus]`, `/explore [focus]` | Animated storyboard or slider explorable; the tool returns an artifact path. |
| Cards | `/quiz [focus]`, `/make-flashcards <subject>` | Retrieval checks. Cards are saved only when `psi_cards_add` succeeds. |
| Review | `/review` | One due card at a time: prompt, your attempt, feedback, your 1–4 rating, `psi_review_grade`. |
| Progress | `/progress` | `ψ <topic> · mastered/total · due` for the active topic. |
| Studio | `/studio` | Starts (or reuses) the studio and prints its URL. |

`/make-flashcards` is a prompt template; the rest are extension commands. `/tutor socratic` switches to focused
questions and hints, `/tutor explain` to paced explanation followed by a check, `/tutor off` stops injecting the
teaching contract. Full reference: [tools and commands](tools-and-commands.md).

## Without a model

These read and write the store directly:

```sh
psi topics                               # topics with mastered/total and due counts
psi map fourier-transform                # prerequisite tree: ✓ mastered, ▶ ready, · later
psi map fourier-transform --mermaid      # Mermaid source
psi review                               # drill due cards across all topics (or: psi review <topic>)
psi import examples/topics/fourier-transform
```

Terminal review snapshots the due queue, prints the prompt (and numbered choices for MCQs), waits for Enter, shows
the answer, then asks `1 Again / 2 Hard / 3 Good / 4 Easy` and prints the next due time. `q` or EOF stops without
grading the current card.

## Doctor

`psi doctor` checks:

- Node ≥ 22.18 (required);
- `pi`, `omp`, `latex`, `ffmpeg`, `docker` version commands, and `PSI_BIN` if set;
- `manim --version` locally, and `docker image inspect` of `PSI_MANIM_IMAGE` (default `psi-manim:latest`);
- that `PSI_HOME` is writable (creates and removes a probe directory).

Each failure prints a fix. Exit status is 1 if **any** check fails, including optional tools you may not need (you only
need omp, Manim, TeX, FFmpeg, or Docker for those features). Doctor does not test provider authentication.

## Studio

| Launch | Default URL | Notes |
| --- | --- | --- |
| `psi studio [--port N] [--open]` | `http://127.0.0.1:3210` | Always binds loopback. `--port 0` picks a free port. `--open` uses `open`/`xdg-open`. |
| `npm run studio` | `http://127.0.0.1:4173` | Honors `PSI_STUDIO_PORT` and `PSI_STUDIO_HOST` (then `HOST`). |
| `/studio` in a session | `http://localhost:4173` | Spawns the standalone server detached, port from `PSI_STUDIO_PORT`; does not open a browser. |

Per topic, studio shows a concept map with frontier, the lesson path, an artifact gallery, reveal-and-rate card review,
and progress/review history. It watches `$PSI_HOME/topics` and refreshes live; ratings made in studio go through the
same `PsiStore.review()` as the terminal and the agent.

Next: [authoring](authoring.md) · [architecture](architecture.md) · [learning science](learning-science.md)
