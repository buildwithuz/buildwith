#!/usr/bin/env bash
# Back up the database (pg_dump, custom format) and the media folder into
#   backups/<UTC timestamp>[-<label>]/{db.dump,media.tar,SHA256SUMS,info}
# Keeps the newest 14 unlabelled (scheduled) backups and the newest 5 labelled ones
# (deploy.sh labels its backups "predeploy-<tag>"). Optional offsite copy with rsync.
#
#   deploy/backup.sh            scheduled backup (systemd timer / cron)
#   deploy/backup.sh <label>    labelled backup
#
# Settings (environment or .env.production):
#   BUILDWITH_BACKUP_KEEP=14              scheduled backups to keep
#   BUILDWITH_BACKUP_KEEP_LABELLED=5      labelled backups to keep
#   BUILDWITH_BACKUP_RSYNC_TARGET=        e.g. backup@nas.example.uz:/backups/buildwith/
#   BUILDWITH_BACKUP_RSYNC_SSH=           e.g. "ssh -i /home/deploy/.ssh/backup_ed25519"
set -euo pipefail
BW_LOG_TAG=backup
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

setting() { local v="${!1:-}"; [[ -n "$v" ]] || v="$(env_get "$1")"; printf '%s' "${v:-$2}"; }
keep="$(setting BUILDWITH_BACKUP_KEEP 14)"
keep_labelled="$(setting BUILDWITH_BACKUP_KEEP_LABELLED 5)"
rsync_target="$(setting BUILDWITH_BACKUP_RSYNC_TARGET '')"
rsync_ssh="$(setting BUILDWITH_BACKUP_RSYNC_SSH '')"

label="${1:-}"
[[ -z "$label" || "$label" =~ ^[A-Za-z0-9._-]+$ ]] || die "label may only contain letters, digits, '.', '_' and '-'"

umask 077
mkdir -p "$BW_BACKUP_DIR"
exec 8>"$BW_BACKUP_DIR/.lock"
flock -n 8 || die "another backup is running"

[[ -n "$(dc ps --status running --quiet db)" ]] || die "the db container is not running"

name="$(date -u +%Y%m%dT%H%M%SZ)${label:+-$label}"
dest="$BW_BACKUP_DIR/$name"
partial="$dest.partial"
rm -rf "$partial"
mkdir -p "$partial"
trap 'rm -rf "$partial"' EXIT

log "dumping database → $name/db.dump"
dc exec -T db pg_dump --username=buildwith --dbname=buildwith --format=custom --compress=6 >"$partial/db.dump"
# A truncated or corrupt dump fails to list.
dc exec -T db pg_restore --list <"$partial/db.dump" >/dev/null || die "pg_dump output is not a valid archive"

media="$BW_DATA_DIR/media"
if [[ -d "$media" ]]; then
  log "archiving media → $name/media.tar"
  # Images are already compressed; plain tar is as small and much faster.
  tar -C "$BW_DATA_DIR" -cf "$partial/media.tar" media
else
  log "no media folder at $media, skipping"
fi

{
  echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host=$(hostname)"
  echo "git=$(git -C "$BW_ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
  echo "image_tag=$(cat "$BW_STATE_DIR/current_tag" 2>/dev/null || echo unknown)"
  echo "migration_version=$(dc exec -T db psql -U buildwith -d buildwith -tAc \
    'select max(version_id) from goose_db_version where is_applied' 2>/dev/null || echo unknown)"
} >"$partial/info"
(cd "$partial" && sha256sum -- * >SHA256SUMS)

mv "$partial" "$dest"
trap - EXIT
log "backup complete: $dest ($(du -sh "$dest" | cut -f1))"

prune() { # prune <keep> <find -name pattern> [<find -not -name pattern>]
  local n="$1"; shift
  find "$BW_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d "$@" -not -name '*.partial' -printf '%f\n' \
    | sort -r | tail -n +"$((n + 1))" | while read -r old; do
      log "removing old backup $old"
      rm -rf -- "${BW_BACKUP_DIR:?}/$old"
    done
}
prune "$keep" -name '????????T??????Z'
prune "$keep_labelled" -name '????????T??????Z-*'

if [[ -n "$rsync_target" ]]; then
  log "copying offsite → $rsync_target"
  rsync -a --partial ${rsync_ssh:+-e "$rsync_ssh"} "$dest" "$rsync_target" || die "offsite copy failed (local backup is fine)"
fi
