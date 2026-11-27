#!/usr/bin/env bash
# Shared helpers for deploy.sh and backup.sh. Source it, don't run it.
# shellcheck disable=SC2034 # variables are used by the scripts that source this file

BW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BW_ENV_FILE="${BUILDWITH_ENV_FILE:-$BW_ROOT/.env.production}"
BW_STATE_DIR="${BUILDWITH_STATE_DIR:-$BW_ROOT/.deploy}"
BW_BACKUP_DIR="${BUILDWITH_BACKUP_DIR:-$BW_ROOT/backups}"

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${BW_LOG_TAG:-deploy}" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[[ -f "$BW_ENV_FILE" ]] || die "missing $BW_ENV_FILE (copy deploy/env.production.example)"

# Read one variable from the env file without sourcing it (values may hold shell metacharacters).
env_get() { sed -n "s/^$1=//p" "$BW_ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

BW_DATA_DIR="${BUILDWITH_DATA_DIR:-$(env_get BUILDWITH_DATA_DIR)}"
BW_DATA_DIR="${BW_DATA_DIR:-$BW_ROOT/data}"
BW_DOMAIN="${BUILDWITH_DOMAIN:-$(env_get BUILDWITH_DOMAIN)}"
BW_DOMAIN="${BW_DOMAIN:-buildwith.uz}"
export BUILDWITH_DATA_DIR="$BW_DATA_DIR" BUILDWITH_ENV_FILE="$BW_ENV_FILE"

# The bot only runs when Telegram is configured.
if [[ -n "$(env_get BUILDWITH_TELEGRAM_BOT_TOKEN)" ]]; then
  export COMPOSE_PROFILES=telegram
else
  export COMPOSE_PROFILES=
fi

# Behind another reverse proxy (a shared server): join its Docker network instead of taking :80/:443.
BW_EDGE_NETWORK="${BUILDWITH_EDGE_NETWORK:-$(env_get BUILDWITH_EDGE_NETWORK)}"
BW_COMPOSE_FILES=(-f "$BW_ROOT/deploy/compose.prod.yml")
[[ -n "$BW_EDGE_NETWORK" ]] && BW_COMPOSE_FILES+=(-f "$BW_ROOT/deploy/compose.shared.yml")

dc() { docker compose --env-file "$BW_ENV_FILE" "${BW_COMPOSE_FILES[@]}" "$@"; }
