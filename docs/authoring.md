# Authoring learning material

Contracts live in `core/src/types.ts`; the JSON schemas agents see are in `extension/src/schemas.ts`; renderer
validators are `validateStoryboard()` and `validateExplorable()` in `visual/src/`. Dates are ISO-8601 strings. In the
tables below `?` marks an optional field.

## Writing a skill pack

Practice packs are the main authoring format: a first-20-hours plan and text challenges. Start from
`examples/skills/mental-math/`, `examples/skills/sql-queries/`, `examples/skills/regex/`,
`examples/skills/git-fluency/`, or `examples/skills/spanish-cafe-a1/`.
Each contains `plan.json` and a `challenges.json` array. These are different from optional topic packs below
and from host instruction skills (`SKILL.md`). Contracts are in `core/src/types.ts`; storage and grading are in
`core/src/practice.ts`.

### Plan fields

| Field | Meaning |
| --- | --- |
| `skill` | Kebab-case skill slug; use the same identity in every challenge. |
| `title` | Display name. |
| `targetPerformance` | Observable, testable definition of good enough. |
| `whyItMatters` | The learner's reason for learning. |
| `subskills` | Array of the records below. |
| `resources` | Array of `{ title, url?, why }`; choose only enough to self-correct. The `/skill` workflow requests at most 3; no count is enforced by validation. |
| `barriers` | Array of `{ barrier, fix, done }`, where `done` is boolean. |
| `hoursGoal` | Positive hour target, conventionally 20. The plan tool supplies 20 when omitted. |
| `createdAt`, `updatedAt` | ISO-8601 timestamps; include them in pack files. The plan tool manages timestamps for its own writes. |

Every subskill has `id`, `title`, `why`, `priority` (1 core, 2 useful, 3 later), `prerequisites` (subskill ids),
`selfCorrection`, `drills` (string array), and `status` (`locked`, `active`, `practicing`, or `solid`).
Use unique kebab-case ids and an acyclic prerequisite graph. Next-subskill selection chooses the lowest numeric
priority unfinished subskill whose prerequisites are all solid, breaking ties by plan order. Successful attempts
do not automatically change subskill status.

### Challenge fields and hint ladders

Full pack records contain `id`, `skill`, `kind`, `level` (integer 1–5), `prompt`, `hints` (string array), and
`createdAt`. Optional fields are `subskillId`, `expected`, `acceptable` (string array), `tolerance` (number), and
`rubric` (string array). Use stable, globally unique challenge ids: attempt recording resolves ids across skills.
The challenge tool assigns ids and timestamps for challenges it creates.

Kinds are `quickfire`, `predict`, `debug`, `apply`, `explain`, `build`, and `boss`. Give open tasks a concrete rubric;
leave `expected` absent when a single exact answer would be misleading. Write hints in order from a small nudge to
a specific method, with the answer left for the learner. `/hint` reveals one rung at a time; terminal drills use `?`.

**Pack convention: include one boss and one build quest per pack.** The shipped examples follow it; neither
`PracticeStore` nor the CLI importer enforces the count. A build quest uses kind `build`, not a separate quest kind.

### Auto-gradable answers

`PracticeStore.checkAnswer(challenge, answer)` returns `success` or `fail` when `expected` is a nonblank string;
otherwise it returns `undefined` for tutor grading. `acceptable` adds alternative strings but does not enable
auto-grading without `expected`.

The actual normalization in `core/src/practice.ts` lowercases, trims, converts several Unicode minus/dash forms to
ASCII minus, strips leading wrappers/sentence punctuation and trailing wrappers/sentence punctuation, and collapses
whitespace runs to one space. It preserves internal punctuation, signs, decimal points, and percent markers.
It does not execute SQL, run regexes, or check semantic equivalence. Supply alternate spellings explicitly.

Numeric comparison also accepts signed decimals, correctly grouped thousands commas, fractions, and percentages.
`75%` means `0.75`, not `75`. `tolerance` is an absolute numeric difference; without it, the threshold is
`1e-9 * max(1, abs(expectedNumericValue))`. A normalized exact-string match succeeds before numeric tolerance is
checked. Use a nonnegative tolerance, including 0 for exact numeric answers.

### Validate before importing

`cli/src/commands/import-skill.ts` parses both JSON files, checks that the plan has a usable skill name and that
challenges is an array, normalizes skill identities, and writes the two files. It does not validate subskill fields,
prerequisite references, answer quality, or boss/build counts. `--force` replaces pack files while keeping existing
attempts, sessions, and progress; keep ids stable when updating an installed pack.

Before importing, inspect the fields above and use the checker against every canonical answer and alternative.
From the repository root, this read-only check exercises all shipped packs:

```sh
node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { PracticeStore } from "./core/src/practice.ts";
const store = new PracticeStore();
for (const pack of readdirSync("examples/skills")) {
    const dir = `examples/skills/${pack}`;
    const plan = JSON.parse(readFileSync(`${dir}/plan.json`, "utf8"));
    const challenges = JSON.parse(readFileSync(`${dir}/challenges.json`, "utf8"));
    assert.equal(challenges.filter(c => c.kind === "boss").length, 1);
    assert.equal(challenges.filter(c => c.kind === "build").length, 1);
    for (const c of challenges) {
        assert.equal(c.skill, plan.skill);
        if (!c.expected?.trim()) {
            assert.equal(store.checkAnswer(c, "an open response"), undefined);
            assert.ok(c.rubric?.length, `${pack}/${c.id}: needs a rubric`);
            continue;
        }
        for (const answer of [c.expected, ...(c.acceptable ?? [])]) {
            assert.equal(store.checkAnswer(c, answer), "success", `${pack}/${c.id}`);
        }
    }
}
JS
```

This is a sanity check, not proof that answers are correct: also try plausible wrong answers, tolerance boundaries,
and prompt-specific edge cases. Then run `psi import-skill examples/skills/mental-math` and
`psi practice mental-math` against a scratch `PSI_HOME`. Open-ended build/boss tasks need the agent's rubric grading.

## Optional topic packs

A pack is a directory that `psi import` copies to `$PSI_HOME/topics/<graph.topic>/`:

```text
<pack>/
  graph.json              # required
  plan.json
  cards.json
  storyboards/<id>.json
  explorables/<id>.json
  artifacts/*
  README.md               # optional; copied as-is
```

```sh
psi import <pack-directory>
```

The importer requires a kebab-case `graph.topic`, runs `validateGraph()`, rejects symlinks and special files, stages
the copy beside the target, and **refuses to overwrite** an existing topic (so learner data is never clobbered). It
does not validate other files or render saved specs; render them with `psi render` or ask the agent. Do not ship
`learner.json` or `reviews.jsonl`. Working examples: `examples/topics/` (e.g. `exponential-growth`).

### graph.json

```json
{
  "topic": "waves",
  "title": "Waves",
  "bigIdea": "Predict how frequency changes a wave.",
  "concepts": [{
    "id": "frequency", "title": "Frequency",
    "summary": "Frequency counts cycles per unit time.",
    "prerequisites": [], "difficulty": 1
  }],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

| Concept field | Meaning |
| --- | --- |
| `id` | Unique kebab-case id. |
| `title` | Display name. |
| `summary` | One or two plain-language sentences. |
| `prerequisites` | Concept ids that must be understood first (edges point prerequisite → dependent). |
| `difficulty` | Integer 1 (intro) … 5 (research level). Enforced by the tool schema, not by `validateGraph()`. |
| `intuition?` | The core insight in one sentence. |
| `misconceptions?` | Wrong mental models the tutor should probe. Shown in studio as "Watch out for". |
| `visualHooks?` | Concrete metaphors that make the idea click. Shown in studio as "Picture this". |
| `tags?` | Free-form strings. |

`validateGraph()` rejects duplicate or non-kebab ids, unknown prerequisites, self-loops, and cycles (naming the cycle).

### plan.json

```json
{
  "topic": "waves", "goal": "Predict wave changes", "learnerLevel": "curious",
  "lessons": [{
    "conceptId": "frequency", "objective": "Predict the period when frequency doubles",
    "beats": [{"kind": "question", "text": "What changes when cycles arrive twice as often?"}],
    "visuals": [], "checks": [], "status": "planned"
  }],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

- `learnerLevel`: `curious | student | practitioner | expert`.
- `lessons` are in teaching order — by convention a topological order of unmastered concepts. `psi_lesson_plan` only
  checks that each `conceptId` exists.
- Lesson: `conceptId`, observable `objective` ("by the end you can …"), `beats`, `visuals`, `checks` (card ids; not
  validated), `status` (`planned | in-progress | done`).
- Beat: `kind` (`hook | question | build | reveal | zoom-out | recap`) and `text`.
- Visual reference: `kind` (`storyboard | manim | explorable | diagram`), `style`, `title`, `goal` (what it must make
  obvious), `path?` relative to the topic directory. `diagram` is a reference kind with no dedicated renderer.

### cards.json

Prefer `psi_cards_add`: send drafts with `conceptId`, `kind`, `prompt`, `answer`, and `choices?`; the store assigns
`id`, `topic`, `createdAt`, and a fresh FSRS state (due immediately). For a pack, write full records:

```json
[{
  "id": "card-frequency", "topic": "waves", "conceptId": "frequency", "kind": "predict",
  "prompt": "If frequency doubles, what happens to the period?",
  "answer": "The period halves because period is the reciprocal of frequency.",
  "fsrs": {
    "state": 0, "stability": 0, "difficulty": 0, "reps": 0, "lapses": 0,
    "due": "2026-01-01T00:00:00.000Z"
  },
  "createdAt": "2026-01-01T00:00:00.000Z"
}]
```

| Kind | Use |
| --- | --- |
| `recall` | Free recall of a fact or definition. |
| `predict` | "What happens if …?" — commit before seeing. |
| `explain` | Own-words explanation (Feynman), graded by the agent. |
| `mcq` | Multiple choice; `psi_cards_add` requires ≥ 2 `choices`. |

Card ids must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` to be reviewable. FSRS fields: `state` (0 new, 1 learning,
2 review, 3 relearning), `stability` (days until recall probability falls to 90%), `difficulty` (1–10 once reviewed;
0 for new cards), `reps`, `lapses`, `due`, `lastReview?`. See [learning science](learning-science.md) for card-writing
guidance.

## Storyboard JSON

Saved as `storyboards/<id>.json`. `psi_storyboard { storyboard, speech?, autoplay? }` validates, saves, and renders
`artifacts/<id>.html`; `psi render <file.json> [-o out.html]` renders without saving.

```json
{
  "id": "wave-question", "title": "Twice as often", "topic": "waves", "style": "3b1b",
  "scenes": [{
    "id": "predict", "narration": "Predict the period when frequency doubles.", "durationSec": 8,
    "elements": [{
      "id": "question", "kind": "text",
      "props": {"x": 800, "y": 450, "text": "Twice the frequency: what period?", "align": "middle"},
      "enter": {"type": "fade", "duration": 0.6}
    }]
  }]
}
```

| Object | Fields |
| --- | --- |
| Storyboard | `id`, `title`, `topic` (non-empty), `style` (`3b1b \| kurzgesagt \| plain`), `scenes` (non-empty); `conceptId?`, `palette?` (name from `visual/src/palettes.ts`; falls back to the style). |
| Scene | `id` (unique), `narration` (caption text), `durationSec` (> 0), `elements`; `background?` (CSS color or palette token `bg`/`deep`), `camera?` `{ zoom?, x?, y? }` — camera at scene end, animated from the previous scene; `zoom` > 0. |
| Element | `id` (unique across the whole storyboard, including inside groups), `kind`, `props`; `enter?`, `exit?`, `loop?` animations. Canvas is 1600×900, origin top-left. Unknown props are ignored. |
| Anim | `type` (`fade pop slide draw pulse orbit float grow typewriter`); `delay?` (s, default 0), `duration?` (s, default 0.6), `from?` (`left right top bottom`, for `slide`). Entry delay counts from scene start; exit ends `delay` seconds before scene end. Non-negative. |

| Kind | Props (required numeric props are validated as finite) |
| --- | --- |
| `circle` | `x, y, r`, `fill?, stroke?` |
| `rect` | `x, y, w, h`, `rx?, fill?, stroke?` |
| `text` | `x, y, text`, `size?, fill?, weight?, align?` (`start middle end`) |
| `arrow` | `x1, y1, x2, y2`, `stroke?, width?, curve?` |
| `path` | `d` (SVG path data), `fill?, stroke?, width?` |
| `equation` | `x, y, tex` (LaTeX), `size?, fill?` |
| `graph` | `x, y, w, h, fn, domain: [a,b]`, `range?: [c,d], stroke?` |
| `vector` | `x, y, dx, dy`, `stroke?, label?` |
| `creature` | `x, y`, `size?, color?, mood?` (`happy curious surprised`) — Kurzgesagt-style blob |
| `particles` | `x, y, w, h, count`, `color?, speed?` |
| `group` | `children: Element[]`, `x?, y?, scale?, rotate?` |

- `graph.fn` is parsed, never evaluated: numbers, `x`, `+ - * / % **`, parentheses, `Math.PI`, `Math.E`, and calls to
  `Math.{sin cos tan asin acos atan atan2 exp log log2 log10 sqrt abs pow min max floor ceil round sign cbrt hypot}`.
- Palettes: `kurzgesagt`, `kurzgesagt-space`, `kurzgesagt-bio`, `3b1b`, `plain`.
- The agent-facing `props` schema is an open record; `validateStoryboard()` is the real check (including nested
  group children).
- Manim conversion is approximate: see [architecture](architecture.md#rendering).

## Explorable JSON

Saved as `explorables/<id>.json`. `psi_explorable { spec }` validates, saves, and renders `artifacts/<id>.html`;
`psi render` works too.

```json
{
  "id": "wave-slider", "title": "Change the frequency", "topic": "waves", "style": "3b1b",
  "template": "function-plot",
  "params": {"fn": "Math.sin(f*x)", "domain": [-6.28, 6.28], "range": [-2, 2]},
  "sliders": [{"name": "f", "label": "Frequency", "min": 0.5, "max": 4, "step": 0.1, "value": 1}],
  "prompts": ["Predict how many cycles you will see before doubling the frequency."]
}
```

Top level: `id`, `title`, `topic`, `style`, `template`, `params`, `sliders`, `prompts` (shown beside the canvas: what to
try, what to notice); `conceptId?`. Each slider has `name`, `label`, finite `min < max`, `step > 0`, and `value` within
bounds. Slider names must be unique identifiers and not reserved (JS keywords, `x`, `y`, `t`, `Math`, …). A page URL
such as `wave-slider.html?f=2` presets slider values (clamped and snapped to the step).

| Template | `params` | Sliders |
| --- | --- | --- |
| `function-plot` | `fn` (expression in `x` + slider names), `domain: [min,max]`; `range?` (default `[-5,5]`), `compare?` (second expression) | any |
| `linear-transform` | `showDeterminant?`, `showEigen?` (booleans), `vectors?: [x,y][]` | exactly `a, b, c, d` → matrix `[[a,b],[c,d]]` |
| `vector-field` | `fx`, `fy` (expressions in `x, y` + slider names); plotted on `[-5,5]²` | any |
| `fourier-epicycles` | `shape`: `square \| sawtooth \| heart \| custom`; `points` (≥ 3 `[x,y]`) for `custom` | must include `terms`, `speed` |
| `probability-sim` | `experiment`: `coin` (Binomial(1,p)) \| `dice` (uniform 1–6) \| `galton` (Binomial(10,p)) | must include `trials`, `p` |
| `exponential-growth` | `mode`: `compound` (`(1+r)^t`) \| `doubling` (`2^(r·t)`) \| `logistic` (adds `K/(1+(K-1)e^(-r·t))` to the compound curve); always plotted against linear `1+r·t` | must include `rate`, `steps`, `capacity` (used only by `logistic`) |

Explorable expressions are token-validated against `x`/`y`, slider names, and an allow-list of `Math` members before
compilation. Interacting with an explorable never submits a grade.

## Manim scenes

Use Manim Community (not ManimGL); setup is in [python/README.md](../python/README.md). Local renders get
`PYTHONPATH=<repo>/python` automatically; if you run `manim` yourself, set it or `pip install ./python/psi_manim`.

```python
from psi_manim import PsiScene, vector_on_plane

class WaveQuestion(PsiScene):
    def construct(self):
        self.title_card("Predict before revealing")
        self.add(vector_on_plane((2, 1)))
        self.narrate("What changes if the horizontal component doubles?", run_time=4)
```

- `PsiScene`: dark canvas; `title_card(text)`, `caption(text)` (no time), `narrate(text, run_time=2)` (subtitle +
  wait; no audio).
- Builders: `number_line_story(values, x_range)`, `vector_on_plane(vector, color)`, `transform_grid(matrix)` →
  `(grid, animation)`, `epicycles(coeffs)` → `(chain, tracker, trace)` with `(frequency, complex amplitude)` pairs and
  tracker time in turns, `plot_with_tracker(fn, x_range)` → `(group, tracker)`, `growth_dots(n)`. Add returned objects
  before animating trackers.

**`psi_manim`** — `{ topic?, code?, storyboardId?, render?, scene?, quality?, runner? }`:

- `storyboardId` (wins over `code`): transpiles a saved storyboard to `artifacts/<id>.py`; renders only with
  `render: true`.
- `code`: always renders, whatever `render` says.
- `scene` defaults to the first `class X(...Scene...)` in the code; `quality` `l|m|h` (default `l`); `runner`
  `auto|local|docker` (default `auto`, local first).

```sh
psi render --manim scene.py -q l -o out/            # Python source
psi render --manim storyboard.json --docker -o out/ # storyboard JSON, forced Docker
```

The CLI defaults to quality `m`, writes next to the input when `-o` is omitted, and has no `--scene` flag (first scene
class wins). MP4s land under `<out>/media/…`. Studio's gallery lists only top-level files in `artifacts/`, so open
nested videos by the returned path.

## Skills and prompts

Host instruction skills are separate from practice packs. The pi host discovers these; omp receives a skill index instead of pi resource flags. `package.json` declares `pi.extensions`, `pi.skills`
(`./skills`), and `pi.prompts` (`./prompts/*.md`); the pi CLI launch passes the same directories with `--skill` and
`--prompt-template`. Adding a file needs no registration in psi code.

**Skill** — `skills/<name>/SKILL.md` with `name` and `description` frontmatter (description says *what* and *when*).
Supporting files may sit beside it, e.g. `skills/retrieval-practice/references/card-examples.md`.

```markdown
---
name: wave-intuition
description: Teach frequency through predictions about a changing wave. Use when a learner meets periodic motion.
---
# Wave intuition
Ask for a prediction, show one change, then check a new case.
```

**Prompt template** — `prompts/<name>.md` becomes `/<name>`. Existing templates use `description` and
`argument-hint` frontmatter and `$1`, `$@`, or a `${1:-default}` fallback (see `daily-review.md`). Substitution is
done by the host; check host support before using new syntax.

```markdown
---
description: Predict the effect of changing one wave parameter.
argument-hint: "<concept>"
---
Ask one prediction question about $1, then wait for the learner.
```

Name tools exactly as registered (`psi_…`, see [tools and commands](tools-and-commands.md)). New *slash commands*
with behavior need `registerCommand()` in `extension/src/practice/commands.ts` for practice or
`extension/src/commands.ts` for the optional concept layer.

## Adding a crew role

Roles are a closed set; adding one touches several owners:

1. Add the literal to `CrewRole` in `core/src/types.ts` (main thread only).
2. Add `ROLE_PROMPTS[role]` and a least-privilege `ROLE_TOOLS[role]` in `crew/src/roles.ts` (both exhaustive records).
3. Add the literal to the `psi_crew` task `role` union in `extension/src/tools.ts`.
4. Touch `buildLesson()` in `crew/src/runner.ts` only if the role joins the fixed pipeline.

A `CrewTask` is `{ role, topic, instructions, conceptId?, inputs? }` (`inputs` are paths relative to the topic
directory). The runner adds topic context, host invocation, file tracking, timing, and logging. Role prompts should
end in a concise final message: `buildLesson()` forwards it to later roles via `crew/<role>.md`.
