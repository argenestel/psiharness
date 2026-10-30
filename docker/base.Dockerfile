# syntax=docker/dockerfile:1
ARG NODE_TAG=22.23.4-bookworm-slim
FROM node:${NODE_TAG} AS base

ARG PI_VERSION=1.4.0
ARG INSTALL_OMP=0
ARG OMP_VERSION=18.14.0
ENV BUN_INSTALL=/opt/bun
ENV PATH="/opt/bun/bin:${PATH}"

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm i -g "@earendil-works/pi-coding-agent@${PI_VERSION}" \
	&& npm cache clean --force
RUN if [ "$INSTALL_OMP" = "1" ]; then \
		npm i -g bun \
		&& bun install -g "@oh-my-pi/pi-coding-agent@${OMP_VERSION}" \
		&& chmod -R a+rX /opt/bun \
		&& command -v omp \
		&& npm cache clean --force; \
	fi

COPY . /opt/psi/
RUN chmod -R a+rX /opt/psi \
	&& chmod +x /opt/psi/cli/src/psi.ts \
	&& ln -s /opt/psi/cli/src/psi.ts /usr/local/bin/psi \
	&& groupmod -n psi node \
	&& usermod -l psi -d /home/psi -m node \
	&& mkdir -p /data /home/psi/.pi \
	&& chown -R psi:psi /data /home/psi

# Mount -v ~/.pi:/home/psi/.pi:ro, or pass ANTHROPIC_API_KEY / OPENAI_API_KEY.
ENV PSI_HOME=/data PSI_STUDIO_HOST=0.0.0.0 NODE_ENV=production
VOLUME ["/data"]
WORKDIR /data
USER psi
CMD ["psi"]
