#!/usr/bin/env bash
# First-run setup: deps, Postgres in Docker, migrations, seed data.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
root="$(repo_root)"; cd "$root"

[[ -f .env ]] || { cp .env.example .env; echo "→ created .env from .env.example"; }
load_env; use_cgo_if_possible

echo "→ installing node dependencies"
pnpm install

echo "→ starting Postgres"
docker compose up -d db
until docker compose exec -T db pg_isready -U buildwith -d buildwith >/dev/null 2>&1; do sleep 1; done
docker compose exec -T db psql -qtAX -U buildwith -d postgres \
  -c "select 1 from pg_database where datname = 'buildwith_test'" | grep -q 1 \
  || docker compose exec -T db createdb -U buildwith buildwith_test

echo "→ generating code"
pnpm gen

echo "→ migrating"
bash scripts/migrate.sh up

echo "→ seeding"
(cd apps/api && go run ./cmd/seed)

cat <<'TXT'

Ready. Next:
  pnpm dev                              web http://localhost:5173 · api http://localhost:8080
  pnpm --filter @buildwith/ui storybook storybook http://localhost:6006

Log in at /login with Dev login as @aziz, @malika or @moderator.
TXT
