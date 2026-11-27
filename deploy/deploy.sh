#!/usr/bin/env bash
# Deploy the commit checked out in /srv/buildwith:
#   build images → back up → migrate → restart → health check → roll back on failure.
# Safe to re-run. The deploy workflow calls it after `git checkout --detach <tag>`.
#
# Environment:
#   REF                         name for the images (default: exact git tag, else short commit)
#   DEPLOY_HEALTH_TIMEOUT=60    seconds to wait for the new version to become healthy
#   DEPLOY_SKIP_PUBLIC_CHECK=1  only check inside the containers (first deploy, before DNS points here)
#   DEPLOY_SKIP_BACKUP=1        skip the pre-deploy backup (not recommended)
#   DEPLOY_SKIP_BUILD=1         use images already loaded for this tag (built elsewhere, see README)
set -euo pipefail
BW_LOG_TAG=deploy
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$BW_ROOT"

mkdir -p "$BW_STATE_DIR"
exec 9>"$BW_STATE_DIR/lock"
flock -n 9 || die "another deploy is running"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  die "tracked files have local changes on the server; commit them upstream or 'git checkout -- .' first"
fi

ref="${REF:-$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short=12 HEAD)}"
tag="$(printf '%s' "$ref" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-120)"
prev="$(cat "$BW_STATE_DIR/current_tag" 2>/dev/null || true)"
# Re-deploying the live tag: a failure rolls back to the one before it.
[[ "$prev" == "$tag" ]] && prev="$(cat "$BW_STATE_DIR/previous_tag" 2>/dev/null || true)"
health_timeout="${DEPLOY_HEALTH_TIMEOUT:-60}"

services=(api worker web caddy)
[[ "$COMPOSE_PROFILES" == *telegram* ]] && services+=(bot)

log "deploying $tag (commit $(git rev-parse --short=12 HEAD), previous: ${prev:-none}, services: ${services[*]})"

# --- build ---------------------------------------------------------------------------------------
export BUILDWITH_IMAGE_TAG="$tag"
if [[ "${DEPLOY_SKIP_BUILD:-}" == 1 ]]; then
  for image in "buildwith-api:$tag" "buildwith-web:$tag"; do
    docker image inspect "$image" >/dev/null 2>&1 || die "DEPLOY_SKIP_BUILD=1 but $image is not loaded"
  done
  log "using the loaded images buildwith-api:$tag and buildwith-web:$tag"
else
  log "building images buildwith-api:$tag and buildwith-web:$tag"
  dc build --pull api web
fi

if [[ -n "$BW_EDGE_NETWORK" ]] && ! docker network inspect "$BW_EDGE_NETWORK" >/dev/null 2>&1; then
  log "creating the network $BW_EDGE_NETWORK for the front proxy"
  docker network create "$BW_EDGE_NETWORK" >/dev/null
fi

# The API image runs as uid 10001 and writes uploads here; Caddy reads them.
media="$BW_DATA_DIR/media"
mkdir -p "$media"
# Checked inside a container so the uid is the one Docker sees (rootless/userns setups differ from the host).
docker run --rm --user 0 --entrypoint sh -v "$media:/m" "buildwith-api:$tag" -c \
  '[ "$(stat -c %u /m)" = 10001 ] || { echo "giving the media folder to uid 10001"; chown -R 10001:10001 /m; }'


# --- back up -------------------------------------------------------------------------------------
# After the build, so the backup is as close to the migration as possible.
if [[ "${DEPLOY_SKIP_BACKUP:-}" == 1 ]]; then
  log "skipping backup (DEPLOY_SKIP_BACKUP=1)"
elif [[ -n "$(dc ps --status running --quiet db)" ]]; then
  "$BW_ROOT/deploy/backup.sh" "predeploy-$tag"
else
  log "db is not running yet (first deploy?), nothing to back up"
fi

# --- migrate -------------------------------------------------------------------------------------
log "starting db"
dc up -d --wait db
log "running migrations"
# Nothing has been restarted yet, so a failed migration leaves the old version serving.
dc run --rm --no-deps migrate || die "migrations failed; nothing was restarted, the running version is unchanged"

# --- restart -------------------------------------------------------------------------------------
check() { # check <label> <command...>: true when the command succeeds
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then return 0; fi
  log "  waiting: $label"
  return 1
}

healthy() {
  check "api /v1/health (in container)" dc exec -T api wget -qO- http://127.0.0.1:8080/v1/health || return 1
  check "web /healthz (in container)" dc exec -T web node -e \
    "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" || return 1
  if [[ "${DEPLOY_SKIP_PUBLIC_CHECK:-}" != 1 ]]; then
    # Through TLS on this machine (Caddy, or the front proxy on a shared server), independent of DNS.
    local c=(curl -fsS --max-time 5 --resolve "$BW_DOMAIN:443:127.0.0.1")
    check "https://$BW_DOMAIN/healthz" "${c[@]}" "https://$BW_DOMAIN/healthz" || return 1
    check "https://$BW_DOMAIN/v1/health" "${c[@]}" "https://$BW_DOMAIN/v1/health" || return 1
  fi
}

wait_healthy() {
  local deadline=$((SECONDS + health_timeout))
  until healthy; do
    ((SECONDS < deadline)) || return 1
    sleep 3
  done
}

start() { # start <tag>
  BUILDWITH_IMAGE_TAG="$1" dc up -d --no-build --remove-orphans "${services[@]}" || return 1
  [[ " ${services[*]} " == *" bot "* ]] || dc rm --stop --force bot >/dev/null 2>&1 || true
  # deploy/ is mounted as a directory, so Caddy sees the checked-out Caddyfile; reload is a no-op if unchanged.
  dc exec -T caddy sh -c 'caddy reload --config "$BUILDWITH_CADDYFILE" --adapter caddyfile' >/dev/null 2>&1 \
    || log "warning: caddy reload failed; it keeps serving the previous config"
}

rollback() {
  log "deploy of $tag FAILED"
  dc ps --all >&2 || true
  dc logs --tail 50 api web >&2 || true
  if [[ -z "$prev" || "$prev" == "$tag" ]]; then
    die "no previous version to roll back to; leaving $tag running for inspection"
  fi
  log "rolling back to $prev"
  if start "$prev" && wait_healthy; then
    log "rolled back to $prev and it is healthy"
  else
    log "WARNING: $prev is not healthy either; check 'docker compose logs'"
  fi
  log "note: migrations from $tag stay applied; if $prev can't work with them, restore the predeploy-$tag backup (deploy/restore.md)"
  exit 1
}

# Record the version we're replacing before switching, so a later manual rollback knows it too.
[[ -n "$prev" && "$prev" != "$tag" ]] && printf '%s\n' "$prev" >"$BW_STATE_DIR/previous_tag"

log "starting $tag"
start "$tag" || rollback
log "health check (up to ${health_timeout}s)"
wait_healthy || rollback

printf '%s\n' "$tag" >"$BW_STATE_DIR/current_tag"
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tag" "$(git rev-parse HEAD)" >>"$BW_STATE_DIR/history"
log "$tag is live"

# --- clean up ------------------------------------------------------------------------------------
# Keep the images of the last three deployed versions for rollbacks.
keep="$( (awk '{print $2}' "$BW_STATE_DIR/history" | tac | awk '!seen[$0]++' | head -n 3; echo "$tag") | sort -u)"
for repo in buildwith-api buildwith-web; do
  docker image ls "$repo" --format '{{.Tag}}' | while read -r t; do
    grep -qxF -- "$t" <<<"$keep" || { log "removing old image $repo:$t"; docker image rm "$repo:$t" >/dev/null || true; }
  done
done
docker image prune --force >/dev/null || true
