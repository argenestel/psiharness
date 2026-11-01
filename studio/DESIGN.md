# psi web — design system

## Brief

- **Subject:** a practice-first workspace for getting good at STEM and programming. You learn by attempting
  problems; a tutor in chat guides you, and psi remembers how you learn.
- **Audience:** self-directed learners (students, developers, career-switchers) who want to actually get better,
  not watch explanations.
- **Primary job:** get the learner into an attempt fast, and make progress (including failed attempts) visible.

The world this product lives in: graph paper, problem sets, a lab notebook, a highlighter, test-runner output,
and the level map of a game where dying is part of winning (the Super Mario effect). Visual choices come from there.

## Tokens

### Colour

| Name | Light | Dark ("blueprint") | Use |
|---|---|---|---|
| `paper` | `#F5F7FB` | `#13213D` | page background (cool, never cream) |
| `sheet` | `#FFFFFF` | `#182A4B` | the work surface: challenge sheets, code lab, composer |
| `ink` | `#1B2A4A` | `#E9EEF7` | text, primary buttons, focus rings |
| `pencil` | `#5B6478` | `#A9B4CA` | secondary text, icons, failed-attempt marks |
| `rule` | `#DCE3EF` | `#2A3F66` | 1 px borders, graph-paper grid lines |
| `highlighter` | `#FFE45C` | `#FFE45C` | progress only: XP, solved marks, level and hours fills |
| `alert` | `#B4401A` | `#FF9E7A` | system errors only (network, crashes). Never for a wrong answer. |

Rules: highlighter yellow means progress and nothing else. A wrong answer is drawn in ink and pencil, not red.
Text on highlighter is always `#1B2A4A`. No gradients. No drop shadows except the focused challenge sheet
(`0 1px 0 rule`, a hairline, not a blur).

### Type

- **Display / headings:** Bricolage Grotesque, weights 600 and 800, optical size on.
  `https://cdn.jsdelivr.net/npm/@fontsource-variable/bricolage-grotesque@5.1.1/index.min.css` (check the exact URL
  resolves; fall back to `@fontsource/bricolage-grotesque@5.1.1`).
- **Body / UI:** Atkinson Hyperlegible Next, 400 and 700 —
  `https://cdn.jsdelivr.net/npm/@fontsource/atkinson-hyperlegible-next@5.2.4/index.css` (+ the 700 weight file).
- **Code only:** JetBrains Mono 400/700 — `https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.1.1/index.css`.
  Monospace is never used for labels, numbers in the HUD, or metadata.
- Fallbacks: `ui-sans-serif, system-ui` and `ui-monospace`. Fonts must not block render (`font-display: swap`).
- Scale (1.25): 13 · 16 · 20 · 25 · 31 · 39 px. Body 16/1.55. Headings tight (1.15) with -0.01em tracking at 31+.
- Measure: chat and prose columns max 68ch.
- Sentence case everywhere. No all-caps labels, no tracked eyebrows above headings, no "→" appended to buttons,
  no "A · B · C" meta strings, no single highlighted word in a headline.

### Shape and space

- Spacing unit 4 px; common steps 8 · 12 · 16 · 24 · 32 · 48.
- Radius: 6 px for inputs and buttons; 10 px for the challenge sheet; nothing else is rounded. No pill chips
  except the slash-command suggestions.
- Borders: 1 px `rule`. Lists are plain rows divided by rules, not grids of cards.
- Graph paper (16 px grid of `rule` lines at 55 % opacity) appears **only** on surfaces where work happens: the
  challenge sheet and the code lab. Everywhere else is plain `paper`.

### Motion

- One orchestrated moment: when an attempt is recorded, its mark is drawn into the attempt trail (highlighter swipe
  left-to-right for solved, a pencil ring for missed). XP counts up once. A level-up adds a single full-width
  highlighter stroke under the level number. Nothing else animates on its own.
- Motion answers actions: opening the drawer, expanding tool activity, revealing a hint.
- `prefers-reduced-motion`: all of the above become instant.

## The memorable element: the attempt trail

Every attempt leaves a mark in a horizontal trail: a highlighter swipe (solved), a pencil ring (missed, with the
lesson written under it on hover/focus), a half swipe (partial), a dot (skipped). It appears in the bench, on the
skill page, and grows live after each answer. It makes the Super Mario effect visible: misses are part of the
trail, not erased. Spend the boldness here; keep everything else quiet.

## Layout

```
Desktop ≥ 1180 px
┌────────────┬──────────────────────────────────┬──────────────────┐
│ sidebar    │ conversation, centred, ≤ 68ch     │ bench            │
│ 248 px     │                                   │ 320 px           │
│ New chat   │ messages                          │ active skill     │
│ Chats      │ challenge sheets inline           │ target           │
│ Skills     │                                   │ next subskill    │
│ Memory     │ composer pinned to the bottom     │ attempt trail    │
│            │                                   │ hours of 20      │
└────────────┴──────────────────────────────────┴──────────────────┘
Tablet 768–1179: bench becomes a toggle panel from the right.
Phone < 768: one column; top bar (menu, title, bench button); sidebar is a drawer with a backdrop;
composer pinned with safe-area insets; no horizontal scroll at 360 px.
```

- Content is left-aligned. Only the empty home hero is centred.
- Sidebar: plain lists. Chats sorted by recency with relative time; skills with level number and a 2 px
  highlighter fill for hours. Active row = `ink` text + 2 px ink bar on the left. No icons-as-decoration.
- The top HUD strip from the old design is removed; that information lives in the bench (desktop) and
  under the skill name in the phone top bar.

## Views

- **Home (empty state):** the hero is a real problem you can attempt immediately, rendered as a challenge sheet
  (pulled from an imported pack, or a built-in one: e.g. "What does `print(len('psi'))` print?"). Under it:
  "What do you want to get good at?" input with two actions: **Start a skill** (`/skill …`) and **Explain a
  concept** (`/learn …`). Below: available skill packs as a plain list (title, what you'll be able to do,
  number of challenges, **Add** button). If the learner has history: a "Continue" row from the latest recap
  instead of the hero problem.
- **Chat:** assistant messages are unboxed prose on paper; user messages are right-aligned, ink text on `sheet`
  with a 1 px rule. Tool activity collapses into one quiet line per turn ("Planned your skill, saved 2 notes")
  expandable for details; thinking hidden. Extension status/widget/notify records update the bench or show a
  toast — never a stack of chips in the conversation. Streaming caret is a 2 px ink bar.
- **Challenge sheet:** graph-paper surface, 10 px radius. Header: kind and level in plain words ("Predict ·
  level 2" is not allowed — use "Predict the output" and a 5-step level meter). Big input sized to the format;
  Enter submits, Ctrl/Cmd+Enter runs code, H opens the next hint. Result appears in place: solved → highlighter
  swipe + "+12 XP"; missed → pencil ring + "Missed it. What will you try differently?" box; then "Next
  challenge".
- **Code lab:** editor on graph paper, line numbers in `pencil`, output panel below with one row per test
  (pass = highlighter dot, fail = pencil ring + message). Reset to starter. First Python run explains the
  one-time download ("Loading Python in your browser… about 10 MB, once").
- **Skill page:** title + target performance as one sentence; attempt trail; subskills as an ordered checklist
  (it is a real sequence, so numbering is allowed); challenge list as rows (prompt preview, format, last result
  mark, **Try** button).
- **Memory:** "What psi knows about you", grouped by kind as plain lists; each item editable/removable inline;
  one line explaining it's stored only on this machine.

## Copy

Plain verbs, sentence case, from the learner's side. Buttons name exactly what happens: "Check answer", "Run
code", "Show a hint", "Next challenge", "Add skill", "Start a skill". The same action keeps the same name
everywhere. Errors say what happened and what to do ("Couldn't reach the tutor. Check that psi web is running,
then retry."). Empty states invite an action.

## Quality floor

Keyboard reachable everywhere with visible ink focus rings (2 px, offset 2 px); WCAG AA contrast in both themes;
aria-live for streaming replies and results; reduced motion respected; works at 360 px wide.

## Knowledge graph and learning paths

- **Graph (`#/graph`)** is the learner's second brain: every skill, step, topic, concept and memory note, linked.
  It sits on plain `paper` (no graph-paper grid: the grid means "work happens here").
- Nodes are drawn in ink and pencil only: skill = filled ink disc (largest), topic = ink ring, subskill/concept =
  small ink dot, note = pencil square. Size follows importance (degree), never colour.
- Progress uses the system's one rule: a node that is solid or mastered gets a highlighter halo; "next" gets a
  2 px ink ring. Locked nodes are pencil at 50 % opacity.
- Edges: prerequisite = pencil line with a small arrowhead; contains = thin pencil line; related = dotted pencil;
  learner link = ink line; about (note) = hairline. Hover/focus dims everything outside the node's neighbourhood.
- **The bold moment:** a selected learning path is drawn as one continuous highlighter stroke through its steps
  in order, behind the nodes, like marking a route on a map. Nothing else on the graph uses highlighter fills
  except mastered halos.
- Interaction: drag to pan, wheel/pinch to zoom, click a node to open the side panel (title, summary, status,
  progress, links in and out, actions: **Practise this**, **Ask the tutor**, **Make a path to here**, **Link to…**),
  `/` focuses search, arrow keys move between connected nodes, Esc closes the panel. Filters as plain toggles
  (Skills, Topics, Notes, Related links). A "Local" switch shows only the focused node's neighbourhood.
  Accessible fallback: the same graph as a nested list for keyboard and screen-reader users.
- **Paths (`#/paths`)**: plain list of paths (title, goal sentence, "4 of 9 steps done" with a thin highlighter
  line). A path page shows its steps as an ordered checklist (a real sequence, so numbers are allowed), each step
  linking to its node, plus **Continue this path** (opens a tutor chat on the next unfinished step) and **Edit
  steps** (reorder, remove, add from search). **New path**: type a goal and either pick a target node ("Make a path
  to here" generates the prerequisite route) or ask the tutor to build one.
- **Model choice:** a quiet control in the composer footer and in New chat: "Model: grok-4.6" opening a list grouped
  by provider with search. The choice persists per browser and can change mid-chat ("Switched to …" appears as a
  single pencil line in the conversation).

## Honesty and the game layer

- **Game layer setting** (You page and sidebar Settings): **On** (default), **Quiet** (numbers stay; no meters,
  fills, strokes, count-ups or announcements), **Off** (no XP, levels, streaks, badges, combo or goal ring
  anywhere; progress is shown only as learning: the trail, route map, practice time and totals in neutral words).
  Applied through `<html data-game="on|quiet|off">`.
- **Asking for help is never penalised.** Hints cost nothing; a hinted solve says "Solved with a hint — that's how
  learning works." The badge is "Asked for help, then solved it".
- **Verification shows evidence first:** the passages (matched sentence marked in context, with source and trust),
  then a conservative verdict ("The sources likely support this" / "A source may contradict this" / "Couldn't
  confirm from the sources") and always the note "Matched by wording, not meaning — read the passages."
- **Why this challenge:** review, retry and stretch picks say so in one quiet line above the sheet.
- **Levels:** "Skill level N" belongs to one skill; "Your level N" is the learner overall. A challenge's own
  difficulty is "Difficulty N", never "Level".
