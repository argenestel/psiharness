# ψ psi — an agent harness for learning big ideas

Most agent harnesses are built to **write code for you**. psi is built to **put ideas in your head**.

It turns the [pi](https://pi.dev) coding agent (and its fork [oh-my-pi](https://github.com/can1357/oh-my-pi))
into a tutor that teaches the way the best explainers do:

- **3Blue1Brown** — intuition before formalism, "you could have invented this", visuals that *are* the math.
- **Kurzgesagt** — a hook you can't ignore, scale jumps, concrete numbers, warm flat-vector storytelling.
- **Learning science** — prerequisite maps, predict-before-reveal, retrieval practice, FSRS spaced repetition,
  Bayesian knowledge tracing. Mastery is measured, never assumed.

```
psi learn "the Fourier transform"
```

## What you get

| Piece | What it does |
|---|---|
| **Concept graph** | Decomposes a big idea into a prerequisite DAG, tracks which concepts you've mastered, and always knows your *frontier*: what you're ready to learn next. |
| **Tutor mode** | A pedagogy layer injected into the agent: one idea at a time, Socratic hint ladder, Feynman teach-back. |
| **Explainers** | Kurzgesagt-style animated storyboards rendered to self-contained HTML players (SVG + Web Animations, captions, optional speech). |
| **Manim** | 3b1b-style math animation via Manim Community + `psi_manim` helpers, locally or in Docker. |
| **Explorables** | Slider-driven interactives: function plots, 2×2 linear transforms, vector fields, Fourier epicycles, probability sims, exponential growth. |
| **Retrieval practice** | Recall / predict / explain / MCQ cards scheduled with FSRS-5, reviewable in the terminal or the studio. |
| **Crew** | A multi-agent lesson studio: architect, intuition, storyteller, visualizer, quizmaster, and critic agents build a full lesson in parallel. |
| **Studio** | A local web app with a live concept map, artifact gallery, flashcard review, and progress views. |

## Install

Requires Node ≥ 22.18. psi has no build step and zero runtime dependencies.

```bash
# as a pi package
pi install git:github.com/argenestel/psiharness

# or clone and use the psi CLI (wraps pi or omp)
git clone https://github.com/argenestel/psiharness && cd psiharness
node cli/src/psi.ts doctor
node cli/src/psi.ts learn "entropy"
PSI_HOST=omp node cli/src/psi.ts learn "backpropagation"   # use oh-my-pi instead of pi
```

### Docker

```bash
docker compose -f docker/compose.yml run --rm psi          # tutor in a container
docker compose -f docker/compose.yml up studio             # studio on http://localhost:4173
```

See [docker/README.md](docker/README.md) for images (`psi`, `psi-manim`, `psi-full`) and auth options.

## Inside a session

| Command | Behavior |
|---|---|
| `/learn <big idea>` | Required topic text; selects the topic, enables tutoring, diagnoses knowledge, then builds the graph and plan |
| `/map` | Show the active topic's graph and frontier; arguments are ignored |
| `/lesson [concept]` | Exact concept id or case-insensitive full title; defaults to the first frontier concept |
| `/visualize [focus]` | Make an animated storyboard; defaults to the current lesson, then the next frontier concept |
| `/explore [focus]` | Make a slider-driven explorable; same focus default as `/visualize` |
| `/crew [concept]` | Build a full lesson; resolve a title to a concept id; defaults to the current lesson, then the next frontier concept |
| `/quiz [focus]` | Ask retrieval questions one at a time; same focus default as `/visualize` |
| `/review [focus]` | Drill due cards for the active topic; optional text is forwarded as context, not a queue filter |
| `/studio` | Start or reuse the local studio and print its URL; arguments are ignored |
| `/progress` | Show active-topic mastery/review progress, or a global summary with no active topic; arguments are ignored |
| `/tutor on\|off\|socratic\|explain` | Required mode, case-insensitive |

Except for `/learn`, `/tutor`, `/studio`, and `/progress`, commands require an active topic selected with `/learn`.
`/map` and `/lesson` also require an existing graph.

## Sample topics

`examples/topics/` ships five ready-made packs (Fourier transform, linear transformations, entropy, backpropagation,
exponential growth). Import one with `psi import examples/topics/fourier-transform`.

## Layout

See [AGENTS.md](AGENTS.md) for the module map and contracts, and [docs/](docs/) for architecture.

## License

MIT
