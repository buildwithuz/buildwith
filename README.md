<div align="center">

# buildwith.uz

**Home for Uzbek engineers.** Share links, post notes, write articles, and build your developer profile, all in one place.

[Website](https://buildwith.uz) · [Discussions](https://github.com/buildwithuz/buildwith/discussions) · [Telegram](https://t.me/buildwith_uz) · [Contributing](./CONTRIBUTING.md)

[![CI](https://github.com/buildwithuz/buildwith/actions/workflows/ci.yml/badge.svg)](https://github.com/buildwithuz/buildwith/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

</div>

---

## What is it?

| | |
|---|---|
| **Links** | A Hacker News-style front page: share links, ask questions (*Savol*), show what you built (*Ko'rsat*), discuss in threads. |
| **Notes** | Short posts like on X: follow people and tags, reply, repost, quote. A chronological *Following* timeline with no algorithm. |
| **Articles** | Long-form writing like on Medium: a clean Markdown editor, drafts, series, beautiful reading pages. |
| **Profiles** | `buildwith.uz/@you`: a developer home page with your README, stack, pinned repos, activity and an *open to work* badge. |

Made for Uzbekistan: the UI is in Uzbek, Russian and English, everything can be shown in **Latin or Cyrillic**, you can log in with **Telegram**, and notifications arrive in Telegram.

## Stack

- **apps/web**: React Router v7 (SSR) + Tailwind CSS, using components from `packages/ui`
- **apps/api**: Go, PostgreSQL, sqlc, OpenAPI-first REST + SSE
- **packages/**: design system, generated API client, i18n strings, Uzbek transliteration (Go + TS, shared test vectors)
- One server, no paid services. See [docs/architecture.md](./docs/architecture.md).

## Run it locally

```bash
git clone https://github.com/buildwithuz/buildwith && cd buildwith
pnpm setup:dev      # installs deps, starts Postgres in Docker, migrates, seeds fake data
pnpm dev            # web on http://localhost:5173, api on http://localhost:8080
```

You need Node (version in `.nvmrc`), pnpm, Go (version in `apps/api/go.mod`) and Docker. Or open the repo in a **Dev Container / Codespace** and everything is ready.

Full guide: [docs/development.md](./docs/development.md).

## Contributing

Everyone is welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first. In short:

- **Bugs** → open an issue.
- **Ideas and features** → start in [Discussions → Ideas](https://github.com/buildwithuz/buildwith/discussions/categories/ideas) *before* writing code.
- **Small, focused PRs** get reviewed fastest. Nothing merges without review.
- New here? Look for [`good first issue`](https://github.com/buildwithuz/buildwith/labels/good%20first%20issue).
- Not a coder? Help with **translations**, **design**, or **moderation**.

## Community

Built by the [FLOSS.uz](https://floss.uz) and [Gopher Uzbekistan](https://gopher.uz) communities.

<a href="https://github.com/buildwithuz/buildwith/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=buildwithuz/buildwith" alt="Contributors" />
</a>

## License

[AGPL-3.0](./LICENSE). You can self-host and modify it; if you run a modified version for others, publish your changes.
