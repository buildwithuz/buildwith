#!/usr/bin/env bash
# Thin wrapper around goose so the database URL comes from .env in one place.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env; use_cgo_if_possible
: "${BUILDWITH_DATABASE_URL:?set BUILDWITH_DATABASE_URL (see .env.example)}"
cd "$(repo_root)/apps/api"
exec go tool goose -dir db/migrations postgres "$BUILDWITH_DATABASE_URL" "$@"
