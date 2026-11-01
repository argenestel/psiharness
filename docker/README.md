# Docker

Everything runs in containers: the psi web server, the pi agent it spawns for every chat, and all of that
agent's tools. Run commands from the repository root.

## Quick start

```sh
docker compose -f docker/compose.yml up -d
```

Open http://localhost:4173. That builds `psi:latest` on first use, copies your pi login into the container
(see [Authentication](#authentication)), and starts the `web` service. Stop it with
`docker compose -f docker/compose.yml down` (learning data stays in its volume).

```sh
docker compose -f docker/compose.yml ps            # web should be "healthy"
docker compose -f docker/compose.yml logs -f web
docker compose -f docker/compose.yml build web     # rebuild after pulling new psi source
docker compose -f docker/compose.yml up -d web     # recreate with the new image
```

Port taken? `PSI_WEB_PORT=4174 docker compose -f docker/compose.yml up -d` (or set it in `docker/.env`).

## Services and profiles

`docker compose up` starts only `pi-auth` (a one-shot credential copy that exits) and `web`.
Everything else is opt-in:

| Service | Profile | What it is |
| --- | --- | --- |
| `web` | default | `psi web` on `psi:latest`, published on `127.0.0.1:${PSI_WEB_PORT:-4173}` |
| `pi-auth` | default | Copies host pi credentials into the `pi-home` volume, then exits |
| `web-full` | `full` | `psi web` on `psi-full:latest` (Manim, TeX, FFmpeg) on `127.0.0.1:${PSI_WEB_FULL_PORT:-4175}` |
| `psi` | `cli` | Interactive terminal tutor: `docker compose -f docker/compose.yml run --rm psi` |
| `manim` | `build` | Builds `psi-manim:latest` for the host-side Docker renderer |

```sh
docker compose -f docker/compose.yml --profile full up -d web-full     # video rendering in the container
docker compose -f docker/compose.yml run --rm psi                       # terminal tutor (TTY)
docker compose -f docker/compose.yml run --rm psi psi skills            # any psi command
docker compose -f docker/compose.yml --profile build build manim
```

`web` and `web-full` share the same data and pi volumes; run one at a time unless you need both.

## Authentication

pi must write its config dir (lock files, OAuth token refresh), so mounting `~/.pi` read-only does not work.
Instead:

1. **Host pi login (default).** Compose mounts the host's `~/.pi/agent` read-only at `/run/pi-host` in the
   `pi-auth` service only. It copies `auth.json`, `settings.json`, `models.json` and `models-store.json` into the
   writable `pi-home` volume (`~/.pi/agent` in the containers) when they are missing there. The `web` container
   never sees the host directory, and nothing is ever written back to the host.
   - Log in on the host first (`pi`, then `/login`). The container runs as UID 1000; your `auth.json` must be
     readable by that UID (it is when your host user is UID 1000).
   - Every `up` re-copies any file that is newer on the host, so a fresh host login reaches the container
     automatically. To force a full re-copy: `PSI_SYNC_AUTH=1 docker compose -f docker/compose.yml up -d`.
   - Use another directory: `PSI_PI_HOST_DIR=/path/to/agent-dir`.
   - OAuth tokens (e.g. xAI) are refreshed inside the container and saved in `pi-home`. Providers that rotate
     refresh tokens make the two copies independent: whichever side refreshes first can leave the other with a
     dead token (`invalid_grant`). Log in again on the host and run `up` again; for a long-running container,
     an API key in `docker/.env` avoids this.
2. **API keys.** Copy `docker/.env.example` to `docker/.env` (gitignored) and set `XAI_API_KEY`,
   `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, or export them in your shell. Unset keys are not passed.
   If you use only keys, create an empty host dir first (`mkdir -p ~/.pi/agent`) so Docker does not create it
   as root.

The web agent uses `PSI_WEB_MODEL` (default `xai/grok-4.6`); override it in `docker/.env` or the shell. The
entrypoint logs only which files it copied and warns when no credentials are present; it never prints secrets.

## Code execution

Compose sets `PSI_CODE_EXEC=1` for `web` and `psi`. The execution capability covers `psi_run`
(Python, JavaScript, SQL, optionally bash), `psi_manim` (Python rendering), and `psi_crew` (child agents).
Set `PSI_CODE_EXEC=0` to disable all three model-facing tools. `web-full` does not set it, so its Manim stack is
unused by the tutor until you put `PSI_CODE_EXEC=1` in `docker/.env` (passed through `env_file`). Crew visualizers receive bash/write only
when **both** `PSI_CODE_EXEC=1` and `PSI_CREW_ALLOW_BASH=1`; other roles never receive them.
Bash in `psi_run` separately requires `PSI_CODE_EXEC_BASH=1`.

`psi_run` code does not run in the agent's container. Compose starts a separate **`runner`** service with no
network (`network_mode: none`), no learner data, no pi login, a read-only root, no capabilities, 512 MB of memory
and 128 processes. `web` and `psi` reach it only through a Unix socket on the `psi-run` volume
(`PSI_RUN_SOCKET`); if the runner is down, `psi_run` fails instead of running code locally. Each run gets a fresh
temporary directory, a stripped environment (`PATH`, `HOME`, `LANG`), a 10 s timeout and a 64 KB output cap. So
model-written demo code, including code steered by a fetched page, cannot read your tokens or `/data` or send
anything out. Demos that need the internet or `pip install` will fail by design.

Crew and web pi/omp children inherit an allowlisted environment with pi provider credentials and config paths,
not arbitrary host secrets. Web tools use an explicit list; a pi extension hook restricts the read tool to
canonical paths beneath `PSI_HOME` and psi's bundled `skills/` and `prompts/`, blocking symlink escapes.

`psi_manim` and `psi_crew` (and `psi_run` outside Compose, when `PSI_RUN_SOCKET` is unset) still run as the
**same user** as the agent, with access to that user's files and credentials. They are not a sandbox against a
malicious learner or prompt injection; keep them off unless you need them, and avoid mounting sensitive host files.
Learner code challenges still run in the browser sandbox (Pyodide, JavaScript Worker, or sql.js).
Recreate `web` after changing execution settings:

```sh
docker compose -f docker/compose.yml up -d web
```

New `docker compose ... run --rm psi` containers pick up the settings automatically. These defaults
apply to the `web` and `psi` Compose services; plain `docker run` requires explicit `-e` flags.
The shared hardening keeps `/tmp` on a 256 MB executable tmpfs with `nosuid,nodev`, and limits open
files to 4096 (soft) / 8192 (hard), with per-container pids and memory caps. (There is deliberately no
`ulimit nproc`: Linux counts it per UID across the whole host, and UID 1000 is usually your desktop user, whose
existing processes would stop containers from starting.)

## Data: backup, restore, reset

| Volume | Mounted at | Contents |
| --- | --- | --- |
| `psi-data` | `/data` (`PSI_HOME`) | Skills, challenges, attempts, memory, topics, web chat sessions |
| `psi-pi-home` | `/home/psi/.pi` | The container's pi credentials and settings |

```sh
# Backup / restore learning data
docker run --rm -v psi-data:/data:ro -v "$PWD":/backup --entrypoint tar psi:latest czf /backup/psi-data.tgz -C /data .
docker run --rm -v psi-data:/data -v "$PWD":/backup --entrypoint tar psi:latest xzf /backup/psi-data.tgz -C /data

# Reset: learning data (irreversible), or just the container's pi login
docker compose -f docker/compose.yml down
docker volume rm psi-data
docker volume rm psi-pi-home      # next `up` copies credentials from the host again
```

The backup directory must be writable by UID 1000.

## Security

- **What is isolated.** The pi agent and every tool it runs (the web agent is limited to `read` and the
  explicit `psi_*` list in `extension/src/tool-policy.ts`) execute inside the container. They see only the image, `/data`, and the container's own pi dir: no
  host files, no host home directory, no Docker socket.
- **Code challenges** (Python via Pyodide, JavaScript in a Worker, SQL via sql.js) run in *your browser's*
  sandbox, not in the container or on the host.
- **Network exposure.** The port is published on `127.0.0.1` only, so other machines cannot reach it. Inside the
  container the server binds `0.0.0.0` so Docker can forward to it; it still rejects unknown `Host` headers
  (`PSI_STUDIO_ALLOWED_HOSTS=localhost,127.0.0.1`) and non-GET requests without `X-Psi: 1`. To reach psi from
  another device, use an SSH tunnel rather than publishing on `0.0.0.0`.
- **Container hardening.** Non-root user `psi` (UID 1000), read-only root filesystem (tmpfs for `/tmp` and
  `~/.cache`; writable volumes only for `/data` and `~/.pi`), `cap_drop: [ALL]`, `no-new-privileges`, an init
  process to reap agent children, memory (`PSI_WEB_MEMORY`, default `2g`) and pids (512) limits,
  `restart: unless-stopped`, and a healthcheck on `/api/state`. `pi-auth` runs with no network.
- **Credentials** live in the `psi-pi-home` volume (mode 600). The agent can read files in its own container,
  including that copy, as with pi on the host.
- The agent needs outbound HTTPS to reach the model provider; the browser loads KaTeX, Pyodide and sql.js from
  `cdn.jsdelivr.net`.

## Images

Images run as `psi` (UID 1000); Node runs the TypeScript source directly. The entrypoint
(`docker/entrypoint.sh`) syncs pi credentials, then `exec`s the command (default `psi`).

| Image | Includes | Local size |
| --- | --- | --- |
| `psi:latest` | Node 22.23.4, Python 3 with sqlite3, pi 1.4.0, psi source | ~650 MB (estimate) |
| `psi:omp` | Base plus Bun and omp 18.14.0 | ~1 GB (estimate) |
| `psi-manim:latest` | Python 3.12, Manim, FFmpeg, slim TeX set, psi_manim | ~3.0 GB |
| `psi-full:latest` | Base plus Python 3.11 venv and the Manim stack | ~3.5 GB |

Manim defaults to **0.22.1** ([PyPI](https://pypi.org/project/manim/0.22.1/), Python >=3.11). No `texlive-full`.

```sh
docker build -f docker/base.Dockerfile -t psi:latest .
docker build -f docker/base.Dockerfile --build-arg INSTALL_OMP=1 -t psi:omp .
docker build -f docker/manim.Dockerfile -t psi-manim:latest .
# Requires psi:latest from the base build (compose's web-full builds it automatically).
docker build -f docker/full.Dockerfile -t psi-full:latest .
```

Override pins with `--build-arg NODE_TAG=...`, `PI_VERSION=...`, `OMP_VERSION=...` on the base image, or
`MANIM_VERSION=...` on either Manim-enabled image. The full image accepts `--build-arg BASE=psi:omp` (or a
registry base image). Bun is installed from npm when requested; its version is currently unpinned.

### Plain `docker run`

```sh
docker volume create psi-pi-home
docker run --rm -it --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -v psi-data:/data -v psi-pi-home:/home/psi/.pi -v "$HOME/.pi/agent:/run/pi-host:ro" psi:latest
docker run --rm -it -v psi-data:/data -e XAI_API_KEY psi:latest          # key only
docker run --rm -it -v psi-data:/data -e ANTHROPIC_API_KEY -e PSI_HOST=omp psi:omp
docker run -d --name psi-web -p 127.0.0.1:4173:4173 -v psi-data:/data -v psi-pi-home:/home/psi/.pi \
  -v "$HOME/.pi/agent:/run/pi-host:ro" -e PSI_WEB_MODEL=xai/grok-4.6 psi:latest psi web
```

With `docker run`, the entrypoint itself copies from `/run/pi-host` when it is mounted. `psi web` inside the
image binds `0.0.0.0` (`PSI_STUDIO_HOST`), so always publish with `127.0.0.1:`.

## Manim from the host renderer

Build `psi-manim:latest` before using the host-side Docker renderer. Its image name can be overridden with
`PSI_MANIM_IMAGE` in the host environment.

```sh
# Replace these absolute paths; put scene.py inside the work directory.
docker run --rm -v /absolute/tmp:/work -v /absolute/out:/out \
  psi-manim:latest manim -ql scene.py Hello --media_dir /out
```

Bind mounts retain host permissions: both directories must be writable by UID 1000. The image supplies writable
`/work`, `/out`, and `/home/psi/.cache`, but a mount overrides the corresponding directory's ownership.

CI publishes amd64 images to GHCR. The full-image job waits for the base-image matrix and consumes the base tagged
with the same commit SHA.
