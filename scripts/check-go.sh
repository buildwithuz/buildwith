#!/usr/bin/env bash
# Everything CI runs for the Go side.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env; use_cgo_if_possible
cd "$(repo_root)/apps/api"

echo "→ gofmt"
unformatted="$(gofmt -l .)"
[[ -z "$unformatted" ]] || { echo "$unformatted"; exit 1; }

echo "→ go vet";     go vet ./...
echo "→ staticcheck"; go tool staticcheck ./...

if have_cc; then
  echo "→ go test -race"; go test -race -count=1 ./...
else
  echo "→ go test (no C compiler: race detector skipped)"; go test -count=1 ./...
fi
