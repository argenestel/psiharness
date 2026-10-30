# syntax=docker/dockerfile:1
# Build psi:latest first, or override BASE with a registry image from the same commit.
ARG BASE=psi:latest
FROM ${BASE} AS base

FROM base AS manim-deps
USER root
ARG MANIM_VERSION=0.22.1
# Bookworm's Python 3.11 runs this Manim release; build and run the venv here
# to avoid copying a Python 3.12 venv into an incompatible interpreter image.
ENV PIP_NO_CACHE_DIR=1 MPLBACKEND=Agg PYTHONUNBUFFERED=1 \
	XDG_CACHE_HOME=/home/psi/.cache PYTHONPATH=/src/python
ENV PATH="/opt/venv/bin:${PATH}"
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		python3 python3-pip python3-venv python3-dev build-essential \
		libcairo2-dev libpango1.0-dev pkg-config ffmpeg \
		texlive-latex-base texlive-latex-extra texlive-fonts-recommended \
		texlive-science dvisvgm cm-super fonts-dejavu-core \
	&& rm -rf /var/lib/apt/lists/* \
	&& python3 -m venv /opt/venv \
	&& pip install "manim==${MANIM_VERSION}"

COPY python/ /src/python/
RUN if [ -f /src/python/psi_manim/pyproject.toml ] || [ -f /src/python/psi_manim/setup.py ]; then \
		pip install /src/python/psi_manim; \
	fi \
	&& chmod -R a+rX /src/python \
	&& mkdir -p /work /out /home/psi/.cache \
	&& chown -R psi:psi /work /out /home/psi/.cache

FROM manim-deps AS final
ENV PSI_MANIM_RUNNER=local
EXPOSE 4173
WORKDIR /data
USER psi
# Studio: docker run --rm -p 4173:4173 psi-full:latest node /opt/psi/studio/src/server.ts
# The server reads PSI_STUDIO_HOST=0.0.0.0 inherited from the base image.
CMD ["psi"]
