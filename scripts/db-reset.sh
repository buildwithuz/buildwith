#!/usr/bin/env bash
# Drop every table, migrate from scratch, seed.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env; use_cgo_if_possible
bash "$(repo_root)/scripts/migrate.sh" reset
bash "$(repo_root)/scripts/migrate.sh" up
cd "$(repo_root)/apps/api" && go run ./cmd/seed
