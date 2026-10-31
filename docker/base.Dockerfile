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

# User setup before COPY so source edits only invalidate the final layers.
RUN groupmod -n psi node \
	&& usermod -l psi -d /home/psi -m node \
	&& mkdir -p /data /home/psi/.pi/agent /home/psi/.cache \
	&& chmod 0700 /home/psi/.pi /home/psi/.pi/agent \
	&& chown -R psi:psi /data /home/psi

COPY . /opt/psi/
RUN chmod -R a+rX,go-w /opt/psi \
	&& chmod 0755 /opt/psi/cli/src/psi.ts /opt/psi/docker/entrypoint.sh \
	&& ln -s /opt/psi/cli/src/psi.ts /usr/local/bin/psi

# Credentials: mount the host's ~/.pi/agent read-only at /run/pi-host (the entrypoint copies auth/settings into the
# writable ~/.pi/agent), or pass XAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY. See docker/README.md.
# PSI_STUDIO_HOST=0.0.0.0 only binds inside the container; compose publishes the port on host loopback only.
ENV PSI_HOME=/data PSI_STUDIO_HOST=0.0.0.0 PSI_STUDIO_PORT=4173 NODE_ENV=production
VOLUME ["/data"]
EXPOSE 4173
WORKDIR /data
USER psi
ENTRYPOINT ["/opt/psi/docker/entrypoint.sh"]
# Web UI: `psi web`. Interactive terminal tutor: the default `psi`.
CMD ["psi"]
