# oh-my-pi (omp) compatibility

psi runs as a pi extension (`extension/src/index.ts`) and is meant to run unchanged under oh-my-pi (`omp`,
`@oh-my-pi/pi-coding-agent`). This note records what was verified, how, and what is still open.

## Installing omp for testing

omp is not on the default PATH in our environment. It was installed into a scratch prefix, not the global npm tree:

```bash
npm i --prefix <scratch>/omp @oh-my-pi/pi-coding-agent   # resolved to 18.14.0
curl -fsSL https://bun.sh/install | BUN_INSTALL=<scratch>/bun bash
export PATH=<scratch>/bun/bin:$PATH BUN_INSTALL=<scratch>/bun   # the omp bin shebang is `env bun`
```

Without bun on PATH, `omp --version` fails with `env: 'bun': No such file or directory`.

To keep global config untouched, run omp with an isolated HOME and XDG dirs
(`HOME=<scratch>/omphome XDG_CONFIG_HOME=… XDG_DATA_HOME=… XDG_STATE_HOME=… XDG_CACHE_HOME=…`).
Otherwise omp writes under `~/.omp`.

### Credentials for live turns

omp reads `XAI_API_KEY` for `--model xai/<id>`. pi stores xAI as an OAuth credential, so
`pi auth print-api-key --provider xai` fails ("configured with OAuth, not an API key"); the OAuth bearer token from
`pi auth print-bearer-token --provider xai` works as `XAI_API_KEY`. We used a small wrapper script that fetches the
token at run time into the omp process environment only (never printed or written to disk), sets the isolated
HOME/XDG dirs, and `exec`s omp. Pointing `PSI_BIN` at that wrapper lets crew spawn omp the same way.

## What was verified (omp 18.14.0, pi 1.1.0, model `xai/grok-4.6`)

| Check | pi | omp |
|---|---|---|
| Extension load, status `psi` + widget `psi-progress` | yes | yes |
| Plain model turn | yes | yes (`-p … "Reply with exactly: pong"`) |
| `psi_*` tool calls in `-p --mode json` | all 10 tools in one run: concept graph (4 concepts), lesson plan + path, cards add, review next/grade, mastery, storyboard (2 scenes), explorable (function-plot), manim render, note | `psi_mastery`, `psi_cards_add`, `psi_note`. omp exposes extension tools as deferred `xd://psi_*` tools: the model `read`s the schema, then `write`s JSON to `xd://psi_<name>`. Results identical to pi. |
| Files land in `PSI_HOME/topics/<topic>/` | `graph.json plan.json cards.json learner.json reviews.jsonl notes.md storyboards/ explorables/ artifacts/` | same store, same layout |
| Tutor injection (`--psi-tutor=true --psi-topic …`, `before_agent_start` `systemPrompt`) | yes, incl. notes.md lines | yes, incl. notes.md lines |
| Slash commands over RPC (`{"type":"prompt","message":"/map"}`) | `/map` (psi-map message), `/progress`, `/tutor socratic`, `/studio`, and a full `/review` loop (next → attempt → `psi_note` → grade) | `/map`, `/progress`. omp answers with `response` then `prompt_result {agentInvoked:false}` and emits a `ready` record first. |
| Crew (`runCrew` quizmaster ∥ critic, `PSI_HOST=omp`, `PSI_BIN`=wrapper) | ok, about 60 s; quizmaster saved 2 cards, critic returned a FIX checklist | ok, about 130 s, same outcome, after the two fixes below (no `--skill`, `ls`/`find` mapped to `glob`). Before them every omp role exited 2. |

## Host differences to know

- **Boolean extension flags swallow the next positional argument (pi 1.1.0).** An unknown `--flag` followed by a
  non-dash argument takes that argument as its value, so `pi -p -e … --psi-tutor "Teach me"` drops the prompt.
  Use `--psi-tutor=true`; the value then arrives as the string `"true"`, which `flagEnabled()` in
  `extension/src/tutor.ts` normalizes (`true`, `"true"`, `"1"`, `"yes"`, `"on"`). `psi learn`/`ask` now pass
  `--psi-tutor=true`. omp parses registered extension flags with their declared type, so both forms work there.
- **omp has no `--skill` or `--prompt-template` flags, and rejects unknown flags** (`Error: unknown flag`, exit 2).
  Skills come only from settings (`skills.customDirectories`) or `.omp/skills` directories. omp declares the
  `resources_discover` extension event but never emits it (18.14.0), so the extension cannot add skill paths either.
  psi therefore passes `--skill`/`--prompt-template` only to pi; for omp, `buildHostArgs({ host: "omp" })` and
  `crewArgs` append a skill index (absolute `SKILL.md` paths plus descriptions) to the system prompt so the agent can
  `read` the relevant skill.
- **omp validates `--tools` strictly.** `ls` is unknown and `find` is "unavailable in this session" (it needs `fd`),
  and either aborts the run with exit 2. `roleTools(role, "omp")` maps `ls` and `find` to `glob`. The `psi_*` names
  are accepted (they are listed as "Other registered tools").
- **Slash commands in print mode.** psi commands that only call `ctx.ui.notify` or `sendMessage` produce no stdout
  under `-p`. Use RPC mode.
- **Running omp in print mode with stdin attached** blocks on "Reading prompt from piped stdin". Redirect stdin from
  `/dev/null` in scripts. Do the same for pi.

## API surface

psi imports only from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` (see AGENTS.md). omp's legacy
shim (`dist/types/extensibility/legacy-pi-coding-agent-shim.d.ts`) exports the same surface, including `defineTool`,
and omp aliases the `@earendil-works/*` package names to its own copies. The methods psi uses exist in omp:
`registerTool`, `registerCommand`, `registerFlag`, `getFlag`, `sendMessage`, `sendUserMessage`, `appendEntry`, and
the `session_start`, `before_agent_start`, and `turn_end` events. `ctx.model` (used by `psi_crew` to give children the
session's model) exists in both.

omp also exposes `pi.zod` next to TypeBox. psi uses TypeBox (`Type` from `pi-ai`) only; `Type.Unsafe` and
`Type.Union` of literals work in both hosts.

## Open items

1. Skills under omp are an index in the system prompt, not native skills. A native route would be writing
   `skills.customDirectories` into the user's omp settings, which psi should not do silently.
2. A full `buildLesson` under omp (5 roles, including the visualizer's manim render) was not run; only
   quizmaster ∥ critic. Under pi, `psi crew dot-product projection -- --model xai/grok-4.6` ran all five roles
   ok in about 12 minutes; the visualizer saved a storyboard and rendered an MP4 through the uv manim fallback.
3. `psi_crew` called from inside an omp session spawns `pi` children unless `PSI_HOST=omp` is set; the extension
   does not detect its host.
