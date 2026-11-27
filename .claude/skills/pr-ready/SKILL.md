---
name: pr-ready
description: Prepare a branch for a pull request to buildwith.uz (checks, size, Conventional Commit title, PR description, screenshots, hygiene). Use before opening or updating any PR.
---

# Getting a PR ready

1. **Branch** from fresh `main`: `git switch -c <type>/<short-desc>` (e.g. `feat/note-quotes`, `fix/translit-ng`).
2. **Run** `pnpm gen` then `pnpm check`. Fix everything. If you touched a user flow, run `pnpm e2e`.
3. **Size:** `git diff --stat main...` excluding lockfiles and generated files should be under ~400 lines.
   If bigger, split into stacked PRs (e.g. 1: migration + queries, 2: API, 3: UI).
4. **Hygiene:** `git status` shows no stray files. Nothing from `.local/`, no TODO/PLAN/NOTES markdown, no debug logs,
   no commented-out code, no `console.log`, no `fmt.Println`.
5. **Title** (Conventional Commits, becomes the squash commit): `type(scope): imperative summary`, ≤ 72 chars.
   Types: `feat fix perf refactor docs test chore ci build revert`. Scopes: `web api ui i18n translit notes links articles profiles mod infra deps`.
6. **Description** using the template: what & why, `Closes #<issue>`, how tested, screenshots (light + dark; mobile + desktop)
   for UI, short video for motion, migration notes if any, AI-assisted checkbox.
7. **Open as draft** if you want early feedback; mark ready when CI is green.
8. After review comments: push new commits (don't force-push during review, so reviewers can see what changed). Squash happens on merge.
