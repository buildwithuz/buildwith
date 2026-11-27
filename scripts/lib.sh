#!/usr/bin/env bash
# Shared helpers for the scripts in this folder. Source it, don't run it.

repo_root() { cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd; }

load_env() {
  local root; root="$(repo_root)"
  if [[ -f "$root/.env" ]]; then set -a; . "$root/.env"; set +a; fi
}

# The race detector and parts of the toolchain need a C compiler. Machines without
# one (a plain Nix or Alpine shell) still get everything else.
have_cc() { command -v cc >/dev/null || command -v gcc >/dev/null || command -v clang >/dev/null; }

use_cgo_if_possible() { have_cc || export CGO_ENABLED=0; }
