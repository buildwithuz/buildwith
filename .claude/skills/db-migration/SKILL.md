---

name: db-migration
description: Create a PostgreSQL schema change for apps/api with goose (reversible, safe on a live database) and regenerate sqlc. Use whenever a table, column, index or constraint changes.
---

# Database migration

## Steps

1. Create the file: `pnpm --filter api migrate:new <snake_case_name>` → `apps/api/db/migrations/<timestamp>_<name>.sql`.
2. Write both sections:

   ```sql
   -- +goose Up
   ...
   -- +goose Down
   ...
   ```

   `Down` must fully undo `Up`. Test both: `pnpm --filter api migrate:up && pnpm --filter api migrate:down && pnpm --filter api migrate:up`.
3. Run `pnpm gen` to regenerate sqlc models.
4. Update `apps/api/db/seed/` if the new table should have fake data for local development.

## Conventions

- Tables plural snake_case (`notes`, `tag_follows`). Primary keys `id bigint generated always as identity`.
- Every table has `created_at timestamptz not null default now()`; mutable rows also `updated_at`.
- Foreign keys always declared, with explicit `on delete` behaviour (usually `cascade` for join tables, `restrict` otherwise).
- Soft deletion via `deleted_at timestamptz` for user content (so threads keep their shape); hard delete for personal data on account deletion.
- Text columns: `text` + `check (char_length(x) <= N)`. Enums: `text` + `check (x in (...))` (easier to change than Postgres enums).
- Index every foreign key and every column used in `ORDER BY` for lists, e.g. `(author_id, created_at desc)`.
- Search columns: generated `tsvector` with the `simple` config on normalized text + GIN index.

## Safe on a live database

- Adding a column: nullable or with a constant default. Never add `not null` without a default in one step.
- New indexes on big tables: `create index concurrently` in its own migration with `-- +goose NO TRANSACTION`.
- Renames: add new → backfill → switch code → drop old in a later PR. Never rename in place.
- Never edit a migration that's already on `main`. Write a new one.
