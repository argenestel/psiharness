#!/bin/sh
# psi container entrypoint.
#
# pi needs a *writable* config dir (~/.pi/agent): it takes lock files and rewrites auth.json when it refreshes
# OAuth tokens, so a read-only mount of the host's ~/.pi breaks it. Instead the host dir is mounted read-only at
# $PSI_PI_HOST_DIR (default /run/pi-host) and its credentials/settings are copied into the container's own pi dir
# (the `pi-home` volume in compose): on first start, or every start when PSI_SYNC_AUTH=1.
#
#   entrypoint.sh sync-auth   copy, then exit (the compose `pi-auth` one-shot service)
#   entrypoint.sh <cmd...>    copy if a host dir is mounted, then exec <cmd...>
#
# Never prints file contents or secrets — only file names and provider-key presence.
set -eu

src="${PSI_PI_HOST_DIR:-/run/pi-host}"
dest="${PI_CODING_AGENT_DIR:-${HOME:-/home/psi}/.pi/agent}"
log() { printf 'psi-entrypoint: %s\n' "$*" >&2; }

sync_pi() {
	[ -d "$src" ] || return 0
	umask 077
	mkdir -p "$dest"
	copied=""
	# auth.json: OAuth tokens + stored API keys. settings/models: default provider/model and custom models.
	for name in auth.json settings.json models.json models-store.json; do
		[ -f "$src/$name" ] || continue
		if [ ! -r "$src/$name" ]; then
			log "cannot read $name in the host pi dir (container runs as UID $(id -u)); skipped"
			continue
		fi
		# Copy when forced, missing, or the host copy is newer: OAuth providers rotate refresh tokens, so a
		# container copy older than the host's is usually dead (invalid_grant). A copy the container refreshed
		# itself is newer than the host's and is kept.
		if [ "${PSI_SYNC_AUTH:-0}" = "1" ] || [ ! -s "$dest/$name" ] || [ "$src/$name" -nt "$dest/$name" ]; then
			tmp="$(mktemp "$dest/.$name.XXXXXX")"
			cat "$src/$name" >"$tmp"
			chmod 600 "$tmp"
			mv -f "$tmp" "$dest/$name"
			copied="$copied $name"
		fi
	done
	if [ -n "$copied" ]; then log "copied from host pi config:$copied"; fi
}

check_creds() {
	if [ -s "$dest/auth.json" ]; then return 0; fi
	for key in XAI_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY OPENROUTER_API_KEY; do
		eval "val=\${$key:-}"
		if [ -n "$val" ]; then return 0; fi
	done
	log "warning: no pi credentials (no $dest/auth.json and no provider API key in the environment)."
	log "         mount your host ~/.pi/agent at $src, or set XAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY."
}

if [ "${1:-}" = "sync-auth" ]; then
	sync_pi
	check_creds
	exit 0
fi

sync_pi
check_creds
if [ "$#" -eq 0 ]; then set -- psi; fi
exec "$@"
