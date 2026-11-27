# Contributing to buildwith.uz

Thank you for helping! This page explains how work gets into the project. Please read it fully before opening a PR.

> 🇺🇿 Savollar bo'lsa, [Discussions → Q&A](https://github.com/buildwithuz/buildwith/discussions/categories/q-a) yoki Telegram guruhida so'rang.

## The flow

```
Idea  ──►  Discussion (Ideas)  ──►  Accepted → issue created by a maintainer  ──►  PR  ──►  Review  ──►  Squash merge
Bug   ──►  Issue  ──────────────────────────────────────────────────────────────►  PR  ──►  Review  ──►  Squash merge
```

1. **Bugs** go in Issues, using the bug form.
2. **Features, changes to behaviour, and design changes** start in [Discussions → Ideas](https://github.com/buildwithuz/buildwith/discussions/categories/ideas).
   Large changes (new format, data model change, new dependency) use **Discussions → RFC**.
   Don't write code for a feature until a maintainer marks the discussion **accepted** and opens an issue for it.
3. **Comment on the issue** to claim it ("I'll take this"). A maintainer assigns it. Unassigned work may be done twice.
4. **Open a PR** that links the issue (`Closes #123`).
5. **Review:** every PR needs an approval from a code owner and green CI. Nobody merges their own PR, maintainers included.
6. **Merge:** squash merge only. The PR title becomes the commit message.

## What gets accepted

**Likely:** small bug fixes, accessibility fixes, performance improvements, translations, tests, accepted issues.

**Unlikely:** large PRs nobody asked for, drive-by features, rewrites, new dependencies without discussion, style-only reformatting.

**Size:** keep PRs under ~400 changed lines (generated files and lockfiles don't count). PRs are labelled `size:XS…XL` automatically.
`size:XL` PRs will usually be asked to split.

Opening a PR doesn't oblige anyone to merge it. Maintainers may ask you to shrink it, change direction, or close it, and will always say why.

## PR requirements

- **Title** follows [Conventional Commits](https://www.conventionalcommits.org): `feat(notes): add quote posts`, `fix(web): …`, `docs: …`.
  Scopes: `web`, `api`, `ui`, `i18n`, `translit`, `notes`, `links`, `articles`, `profiles`, `mod`, `infra`, `deps`.
- **Description:** what changed and why, how you tested it.
- **UI changes:** before/after screenshots in light **and** dark mode. Motion or interaction changes: a short video.
- **Tests** for new behaviour. CI must pass.
- **Strings** added in all three locales (`uz`, `ru`, `en`). If you can't translate, add `uz` or `en` and tick "needs translation".
- **No unrelated changes.** One concern per PR.
- **No planning files** (`TODO.md`, `NOTES.md`, `PLAN.md`, task lists) in the repo. Keep them in `.local/`, which is gitignored.

## AI-assisted contributions

You may use AI tools (Claude Code, Cursor, Copilot…). The repo includes agent instructions (`AGENTS.md`) and skills (`.claude/skills/`) so they follow our conventions.
You are responsible for every line: read it, understand it, test it. Tick the AI checkbox in the PR template.
PRs that look unreviewed by their author (huge, unrelated changes, made-up APIs, failing tests) will be closed.

## Trust labels

New contributors' PRs get `vouch:new`. After a few good merged PRs, a maintainer adds you to `.github/VOUCHED`, and your PRs get `vouch:trusted`.
This only helps reviewers prioritise; everyone's PRs get the same review rules.

## Reviews

- Reviewers aim to respond within a week. Ping in the PR after 7 days if you hear nothing.
- Be kind and specific. Suggest, don't command. Assume good intent.
- Reviewers use the checklist in `.claude/skills/review-pr/SKILL.md`.

## Other ways to help

- **Translations:** edit `packages/i18n/locales/*.json` (no coding needed).
- **Design:** propose UI improvements in Discussions with mockups.
- **Testing:** try preview builds, report bugs with steps.
- **Moderation:** active, trusted members can apply to be moderators.

## Development

See [docs/development.md](./docs/development.md).

## Code of Conduct

By participating you agree to our [Code of Conduct](./CODE_OF_CONDUCT.md).
