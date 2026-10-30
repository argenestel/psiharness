# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm AS manim

ARG MANIM_VERSION=0.22.1
ENV PIP_NO_CACHE_DIR=1 MPLBACKEND=Agg PYTHONUNBUFFERED=1 \
	XDG_CACHE_HOME=/home/psi/.cache PYTHONPATH=/src/python
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential libcairo2-dev libpango1.0-dev pkg-config ffmpeg \
		texlive-latex-base texlive-latex-extra texlive-fonts-recommended \
		texlive-science dvisvgm cm-super fonts-dejavu-core \
	&& rm -rf /var/lib/apt/lists/* \
	&& pip install "manim==${MANIM_VERSION}"

COPY python/ /src/python/
# Support both an installable package and a plain psi_manim module directory.
RUN if [ -f /src/python/psi_manim/pyproject.toml ] || [ -f /src/python/psi_manim/setup.py ]; then \
		pip install /src/python/psi_manim; \
	fi \
	&& chmod -R a+rX /src/python \
	&& groupadd --gid 1000 psi \
	&& useradd --uid 1000 --gid psi --create-home --home-dir /home/psi psi \
	&& mkdir -p /work /out /home/psi/.cache \
	&& chown -R psi:psi /work /out /home/psi

WORKDIR /work
USER psi
CMD ["manim", "--version"]
