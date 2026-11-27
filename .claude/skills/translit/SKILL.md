---
name: translit
description: Change Uzbek Latin/Cyrillic transliteration or apostrophe normalization, keeping the Go (apps/api/internal/translit) and TypeScript (packages/translit) implementations identical via shared test vectors. Use for any translit bug or rule change.
---

# Transliteration

Two implementations, one behaviour:
- TypeScript: `packages/translit/src/` (used by the web app for display)
- Go: `apps/api/internal/translit/` (used for search normalization, bot messages, feeds)
- Shared truth: `packages/translit/testdata/vectors.json`, an array of `{ "latin": "...", "cyrillic": "...", "note": "..." }`
  plus `normalize` cases. **Both test suites read this file.**

## Steps for any change
1. Add failing cases to `vectors.json` first (include a `note` explaining the rule).
2. Fix the TS implementation → `pnpm --filter translit test`.
3. Fix the Go implementation → `cd apps/api && go test ./internal/translit/...`.
4. Both must pass on the same vectors. CI runs both whenever `vectors.json` changes.

## Rules to preserve
- Normalize apostrophes: `' ’ ‘ ` ʼ ʻ` after `o`/`g` → `ʻ` (U+02BB); elsewhere as separator → `ʼ` (U+02BC).
- Digraphs: `sh ch` → `ш ч`; `ng` stays `нг`; `s'h` (with separator) is `сҳ`, not `ш`.
- `ye yo yu ya` → `е ё ю я` at word start and after vowels; `e` at word start → `э`.
- `ts` → `ц` only in known loanwords (list in `loanwords.json`), otherwise `тс`.
- Case: `Sh`→`Ш`, `SH`→`Ш` in all-caps words.
- **Never transliterate:** inside code/pre, URLs, emails, `@usernames`, `#tags`, and text wrapped in `<span translate="no">`.
- `forSearch()`: lowercase Latin, apostrophes removed, so "oʻzbek", "o'zbek" and "ўзбек" match.
