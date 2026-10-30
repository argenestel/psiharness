# Docker

Run all commands from the repository root. Rendering is CPU-only; no GPU is needed.
Images run as `psi` (UID 1000). Node runs the TypeScript source directly.

| Image | Includes | Approximate local size (unmeasured) |
| --- | --- | --- |
| `psi:latest` | Node 22.23.4, pi 1.4.0, psi source | ~600 MB |
| `psi:omp` | Base plus Bun and omp 18.14.0 | ~1 GB |
| `psi-manim:latest` | Python 3.12, Manim, FFmpeg, slim TeX set, psi_manim | ~3 GB |
| `psi-full:latest` | Base plus Python 3.11 venv and the Manim stack | ~3.5 GB |

Manim defaults to **0.22.1** ([PyPI](https://pypi.org/project/manim/0.22.1/), Python >=3.11).
Sizes are estimates; measure after building. No `texlive-full` is installed.

```sh
docker build -f docker/manim.Dockerfile -t psi-manim:latest .
docker build -f docker/base.Dockerfile -t psi:latest .
docker build -f docker/base.Dockerfile --build-arg INSTALL_OMP=1 -t psi:omp .
# Requires psi:latest from the preceding base build.
docker build -f docker/full.Dockerfile -t psi-full:latest .
```

Override pins with `--build-arg NODE_TAG=...`, `PI_VERSION=...`, `OMP_VERSION=...`
on the base image, or `MANIM_VERSION=...` on either Manim-enabled image.
The full image accepts `--build-arg BASE=psi:omp` (or a registry base image).
Bun is installed from npm when requested; its version is currently unpinned.

## Interactive use and authentication

Mount an existing pi auth directory read-only, or pass provider API keys:

```sh
docker run --rm -it -v psi-data:/data -v "$HOME/.pi:/home/psi/.pi:ro" psi:latest
docker run --rm -it -v psi-data:/data -e ANTHROPIC_API_KEY psi:latest
docker run --rm -it -v psi-data:/data -e OPENAI_API_KEY psi:latest
docker run --rm -it -v psi-data:/data -e ANTHROPIC_API_KEY -e PSI_HOST=omp psi:omp
```

Export keys in your shell first. A read-only auth mount cannot persist login or
token refresh changes; refresh credentials on the host. Ensure UID 1000 can read it.
Learning data persists in the `psi-data` volume (`PSI_HOME=/data`).

## Studio

```sh
docker run --rm -p 4173:4173 -v psi-data:/data \
  -e PSI_STUDIO_HOST=0.0.0.0 -e PSI_STUDIO_PORT=4173 \
  psi:latest node /opt/psi/studio/src/server.ts
```

Open http://localhost:4173. The full image sets `PSI_MANIM_RUNNER=local` for
in-container rendering; the base image has no Manim or Docker client.
Use the same server command with `psi-full:latest` for local rendering support.
The current `psi studio --port 4173` subcommand hardcodes loopback, so the
container examples invoke the server directly to honor `PSI_STUDIO_HOST`.

## Manim from the host renderer

Build `psi-manim:latest` before using the host-side Docker renderer. Its image name
can be overridden with `PSI_MANIM_IMAGE` in the host environment.

```sh
# Replace these absolute paths; put scene.py inside the work directory.
docker run --rm -v /absolute/tmp:/work -v /absolute/out:/out \
  psi-manim:latest manim -ql scene.py Hello --media_dir /out
```

Bind mounts retain host permissions: both directories must be writable by UID 1000.
The image supplies writable `/work`, `/out`, and `/home/psi/.cache`, but a mount
overrides the corresponding directory's ownership.

## Compose

```sh
mkdir -p "$HOME/.pi"
docker compose -f docker/compose.yml build
docker compose -f docker/compose.yml run --rm psi
docker compose -f docker/compose.yml up -d studio
# The Manim build-only service is opt-in:
docker compose -f docker/compose.yml --profile build build manim
```

Compose passes through API keys and mounts `~/.pi` read-only. Studio binds to
`0.0.0.0:4173`; only the studio service publishes a port.
CI publishes amd64 images to GHCR. The full-image job waits for the base-image
matrix and consumes the base tagged with the same commit SHA.
