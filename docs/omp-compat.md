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

## What was verified

| Check | Result |
|---|---|
| `omp --version` / `--help` | Works once bun is on PATH. |
| Extension load: `omp --mode rpc --no-session -e ./extension/src/index.ts` | Loads with no stderr. Emits `setStatus` key `psi` (`ψ — · 0/0 mastered · 2 due`) and widget `psi-progress`. |
| Slash commands registered | `learn map lesson quiz review visualize explore crew progress tutor studio` all appear in `available_commands_update`. |
| `-p` print mode with extension | Runs; a provider failure surfaces as a normal agent error, not an extension load error. |

Not verified: any model turn under omp. The available credentials were not usable: the `FIREWORKS_API_KEY` in
the environment returns 401, and pi's `openai-codex` provider was at its usage limit during testing. So
tool calls (`psi_*`), `before_agent_start` tutor injection under omp, and crew runs with `PSI_HOST=omp`
are still untested under omp.

## API surface

psi imports only from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` (see AGENTS.md). omp's
legacy shim (`dist/types/extensibility/legacy-pi-coding-agent-shim.d.ts`) exports the same surface, including
`defineTool`, and omp aliases the `@earendil-works/*` package names to its own copies. The methods psi uses
exist in omp's type declarations: `registerTool`, `registerCommand`, `registerFlag`, `getFlag`, `sendMessage`,
`sendUserMessage`, `appendEntry`, and the `session_start`, `before_agent_start`, and `turn_end` events.

omp also exposes `pi.zod` (and a `z` export) next to TypeBox. psi uses TypeBox (`Type` from `pi-ai`) only, so no
feature detection is needed. `Type.Unsafe` and `Type.Union` of literals are used in `extension/src/schemas.ts`;
both work in pi and in omp's shim.

## Host differences to know

- **Boolean extension flags swallow the next positional argument (pi 1.1.0, same parser family as omp).**
  An unknown `--flag` followed by a non-dash argument takes that argument as its value. So
  `pi -p -e … --psi-tutor "Teach me"` drops the prompt. Put boolean psi flags after the prompt, or use
  `--psi-tutor=true`. With `=true` the value arrives as the string `"true"`, not `true`, so psi must normalize
  string values (see `extension/src/tutor.ts`).
- **Slash commands in print mode.** psi commands that only call `ctx.ui.notify` or `sendMessage` produce no
  stdout under `pi -p`. They work in RPC mode (`{"type":"prompt","message":"/map"}` returns the `psi-map`
  custom message and a notify event under pi 1.1.0).
- **Running omp in print mode with stdin attached** blocks on "Reading prompt from piped stdin". Redirect stdin
  from `/dev/null` in scripts.

## Open items

1. Live tool calls under omp (`omp -p -e ./extension/src/index.ts "…call psi_mastery…"`) once a provider is
   usable. Needs: a working `omp` credential or API key.
2. Crew under omp: `PSI_HOST=omp` makes `runCrewTask` spawn `omp` with the same `-e`, `--tools`, and
   `--append-system-prompt` flags. Confirm omp accepts `--tools` names of extension tools (`psi_*`) and that
   `--` still separates the message.
3. Tutor injection under omp: confirm `before_agent_start` `systemPrompt` replacement is honored.
