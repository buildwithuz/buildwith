---

name: review-pr
description: Review a pull request to buildwith.uz against the project's checklist (scope, security, privacy, blocks/mutes, tests, UI, i18n, hygiene). Use when asked to review a PR or a diff.
---

# Reviewing a PR

Fetch it: `gh pr checkout <n>` and `gh pr diff <n>`. Read the linked issue/discussion first: does the PR do what was agreed, and only that?

## Checklist

**Scope & hygiene**

- [ ] Linked to an accepted issue; no unrelated changes; size reasonable (split if `size:XL`).
- [ ] No planning/scratch files, no stray debug code, generated files up to date.
- [ ] Conventional Commit title that will read well in the changelog.

**Correctness**

- [ ] Logic matches the API contract in `openapi.yaml`; error codes sensible.
- [ ] Edge cases: empty, very long, Unicode (oʻ gʻ, Cyrillic, emoji), concurrent requests, deleted/killed items.
- [ ] Migrations reversible and safe on a live DB (see `db-migration` skill).

**Security & privacy**

- [ ] Auth + ownership checks on every mutation; CSRF enforced.
- [ ] **Blocks, mutes and killed content filtered** in every new list/query/notification.
- [ ] User input length-limited; Markdown sanitized server-side; no `dangerouslySetInnerHTML` except sanitized server HTML.
- [ ] Outbound HTTP only via `internal/fetch`; uploads go through the media pipeline.
- [ ] No new personal data collected without a reason; nothing sensitive in logs.

**Tests**

- [ ] New behaviour tested; tests would fail without the change; no sleeping/flaky tests.

**UI** (if touched)

- [ ] Uses `packages/ui` tokens/components only; screenshots in light + dark, mobile + desktop.
- [ ] Keyboard and screen-reader usable; works without JS for core flows; Cyrillic mode looks right.
- [ ] Strings in uz/ru/en with natural Uzbek.

**Performance**

- [ ] No N+1 queries (check loaders/handlers that loop); lists paginated with cursors; indexes exist for new queries.

## Tone

Start with what's good. Mark each comment **blocking**, **suggestion**, or **nit**. Explain why, link to the rule.
Approve only when every blocking comment is resolved. Never approve your own PR.
