---
name: api-endpoint
description: Add or change an HTTP API endpoint in apps/api (contract-first with OpenAPI, sqlc queries, handler, tests, regenerated TS client). Use for any backend route work.
---

# Add or change an API endpoint

The OpenAPI file is the contract. Web and API never drift because both are generated from it.

## Steps

1. **Contract.** Edit `packages/api-spec/openapi.yaml`:
   - Path under `/v1/...`, `operationId` in camelCase (`createNote`), tag = domain (`notes`).
   - Request/response schemas in `components/schemas`, reuse existing ones (`User`, `Note`, `Page`, `Error`).
   - List endpoints use keyset pagination: `?cursor=&limit=` → `{ items, nextCursor }`. Never offset pagination.
   - Errors: `Error { code, message }` with codes from the existing enum; add new codes to the enum.
   - Mutations require the session cookie and `X-CSRF-Token`.
2. **Generate.** `pnpm gen` (oapi-codegen strict server stubs + TS client + sqlc).
3. **Query.** Add SQL to `apps/api/db/queries/<domain>.sql` with sqlc annotations. If it lists user content, join the
   shared visibility filter (blocks, mutes, killed items) — see existing `-- name: ListTimeline` for the pattern.
   Need a schema change? Use the `db-migration` skill first.
4. **Handler.** Implement the generated interface in `apps/api/internal/<domain>/`. Keep handlers thin:
   parse → call a service function → map errors. Business logic lives in the service, takes a `clock.Clock` and the `db.Querier`.
5. **Rules to apply:** auth check, ownership check, rate limit group, new-account limits, ban check, input length limits,
   Markdown sanitized server-side, outbound HTTP only via `internal/fetch`.
6. **Tests** in `<domain>_test.go`:
   - Table tests for the service logic.
   - `httptest` tests against the real test DB (transaction rolled back): happy path, unauthenticated (401), forbidden (403),
     CSRF missing (403), validation (422), blocked user cannot see/interact, rate limit hit (429).
7. **Web.** Use the generated client from `@buildwith/api-client` in a React Router `loader`/`action`. No hand-written fetch calls.
8. `pnpm check`, then the `pr-ready` skill.

## Don't
- Don't hand-edit generated code (`*.gen.go`, `packages/api-client/src/generated/`).
- Don't return internal errors to clients; log with `slog` and return a coded error.
- Don't add an endpoint the web app doesn't need yet.
