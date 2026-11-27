# AGENTS.md

Instructions for AI coding agents (and a quick orientation for humans). Keep this file short and true.

## Project

buildwith.uz: a home for Uzbek engineers. Four surfaces sharing one account: **links** (Hacker News-style), **notes** (X-style),
**articles** (Medium-style), **profiles**. Open source, AGPL-3.0, runs on one server.

## Monorepo

```
apps/web/            React Router v8 (framework mode, SSR), Tailwind CSS; routes in app/routes/
apps/api/            Go: cmd/{server,worker,bot,migrate,seed}, internal/<domain>/, db/{migrations,queries}
packages/ui/         Design system: tokens, components (Radix primitives), Storybook
packages/api-spec/   openapi.yaml: the single source of truth for the HTTP API
packages/api-client/ TypeScript client generated from api-spec (never edit by hand)
packages/i18n/       locales/{uz,ru,en}.json shared by web and api (bot, emails)
packages/translit/   Uzbek Latin <-> Cyrillic in TS; testdata/vectors.json shared with the Go implementation
docs/                architecture.md, development.md (user-facing guides only)
```
Tooling: pnpm workspaces + Turborepo, Biome (lint + format for TS/JSON/CSS), Vitest, Playwright; Go with sqlc, goose, oapi-codegen, staticcheck.
TypeScript is pinned to 5.9 because openapi-typescript and parts of the toolchain use the TypeScript 5 compiler API.

## Commands (run from repo root)

```
pnpm setup:dev       # deps, Postgres (docker), migrate, seed
pnpm dev             # web + api with reload
pnpm gen             # regenerate: OpenAPI → Go server stubs + TS client, sqlc
pnpm check           # everything CI runs: biome, typecheck, vitest, go vet, staticcheck, go test
pnpm e2e             # Playwright against a local stack
```

## Rules

- **API is contract-first.** Change `packages/api-spec/openapi.yaml`, run `pnpm gen`, then implement. Generated files are committed and CI fails if they're stale.
- **SQL only in `apps/api/db/queries/*.sql`** (sqlc). Migrations are goose, always reversible.
- **Blocks and mutes are enforced in SQL** for every query that lists or allows interaction with user content. Add a test each time.
- **UI only from `packages/ui`.** Need a new component? Add it there with a story. No ad-hoc colors or spacing: use tokens.
- **Every user-facing string goes through i18n**, in all three locales; `uz` is the source of truth.
- **Content display goes through translit** (Latin/Cyrillic preference); never transliterate code, URLs or usernames.
- **Core flows work without JavaScript** (reading, voting, commenting, posting) using React Router forms; JS enhances.
- **Security:** CSRF on mutations, sanitize Markdown on the server, all outbound HTTP through `internal/fetch` (SSRF-safe),
  re-encode every uploaded image, no secrets in code.
- **Dependencies:** don't add one without an accepted discussion; prefer the standard library / existing deps.
- **No paid APIs, third-party trackers, external CDNs or third-party embed scripts.** One exception: Telegram's
  official login widget on `/login`, loaded only when a bot is configured (Telegram sign-in is a core feature).
- **No email addresses.** buildwith.uz has no mailbox: support and reports go to the Telegram bot (one bot does sign-in,
  notifications and support) or GitHub. Link the bot via `supportUrl()`/`{{contact}}`, never a hard-coded address.
- **Time:** store UTC, inject clocks in logic, display Asia/Tashkent by default. Format dates with `app/lib/time.ts`,
  not `Intl` directly: browsers and Node ship different Uzbek locale data, which breaks hydration.
- **Routing:** React Router has no partial segments, so `/@user` routes match `:handle` and check the `@` in the loader.

## Repo hygiene

- **Never commit planning or scratch files** (TODO.md, PLAN.md, NOTES.md, task lists, logs, screenshots for yourself).
  Put them in `.local/` (gitignored).
- Docs in `docs/` are for users and contributors only: how to run, how it's built. Decisions go in the PR description or the Discussion.
- Don't add comments that restate the code. Comment _why_, not _what_.

## Before finishing any change

1. `pnpm gen` and `pnpm check` pass.
2. Tests cover the new behaviour (Go: table tests + httptest against real Postgres; TS: Vitest; flows: Playwright).
3. UI checked in light + dark, 360 px width, Cyrillic mode, keyboard only.
4. PR title is Conventional Commits; PR < ~400 changed lines (excluding generated/lock files).

## Skills

Task-specific playbooks live in `.claude/skills/`: `api-endpoint`, `db-migration`, `ui-component`, `i18n`, `translit`, `pr-ready`, `review-pr`.
