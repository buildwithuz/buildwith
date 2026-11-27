# Development guide

## Requirements
- Node (see `.nvmrc`) and pnpm (`corepack enable`)
- Go (see `apps/api/go.mod`)
- Docker (for Postgres)

Or use the Dev Container / GitHub Codespaces: everything is preinstalled.

## First run
```bash
pnpm setup:dev   # install deps, start Postgres, run migrations, seed fake data
pnpm dev         # web http://localhost:5173 · api http://localhost:8080 · storybook: pnpm --filter @buildwith/ui storybook
```
Seeded users can log in with **Dev login** (local only) at `/login`, e.g. `@aziz`, `@malika`, `@moderator`.

OAuth and Telegram login need keys only if you want to test them: copy `.env.example` to `.env` and fill in the values.

## Everyday commands
| Command | Does |
|---|---|
| `pnpm dev` | web + api + worker with reload |
| `pnpm gen` | regenerate API stubs, TS client and sqlc code |
| `pnpm check` | lint, format check, typecheck, unit tests (TS + Go) |
| `pnpm e2e` | Playwright tests against the local stack |
| `pnpm --filter api migrate:new <name>` | new migration |
| `pnpm db:reset` | drop, migrate, seed |

## Working on a change
1. Pick an accepted issue and comment to claim it.
2. Branch from `main`: `feat/…`, `fix/…`.
3. Make the change following [AGENTS.md](../AGENTS.md) (it's written for AI agents but is the shortest summary of our rules for humans too).
4. `pnpm gen && pnpm check`.
5. Open a PR with a Conventional Commit title. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Personal notes
Keep your own TODOs, plans and scratch files in `.local/` at the repo root. It's gitignored, so it never ends up in a PR.

## Troubleshooting
- **Port 5432 in use:** stop your local Postgres or set `BUILDWITH_DB_PORT` in `.env`.
- **Generated code diff in CI:** run `pnpm gen` and commit the result.
- **Cyrillic looks wrong:** add a case to `packages/translit/testdata/vectors.json` and open an issue.
