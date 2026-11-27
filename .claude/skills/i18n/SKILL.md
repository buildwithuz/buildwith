---

name: i18n
description: Add or change user-facing text in buildwith.uz (packages/i18n locales uz/ru/en, ICU plurals, used by web and the Go api/bot). Use whenever UI text, emails or bot messages change.
---

# Strings and translations

Locales: `packages/i18n/locales/{uz,ru,en}.json`. **`uz` (Latin) is the source of truth.** Cyrillic Uzbek is generated
at display time by translit, so never add a `uz-Cyrl` file.

## Steps

1. Add the key to all three files, same nesting. Keys are `area.screen.thing`: `notes.compose.placeholder`.
2. Use ICU MessageFormat for variables and plurals:
   `"notes.likes": "{count, plural, one {# ta yoqtirish} other {# ta yoqtirish}}"` (Uzbek doesn't change the noun after numbers;
   Russian needs `one/few/many/other`).
3. Use the key: web `t("notes.compose.placeholder")`; Go `i18n.T(lang, "notes.compose.placeholder", vars)`.
4. `pnpm --filter i18n check` verifies: same keys in all files, valid ICU, no unused keys, no empty values.
5. If you can't translate into a language, copy the English text and add the key to `packages/i18n/needs-translation.txt`;
   tick "needs translation" in the PR.

## Writing style (Uzbek)

- Latin script with correct letters: **oʻ gʻ** use U+02BB (ʻ), separator **ʼ** uses U+02BC. Never ASCII `'` or `‘`.
- Friendly "siz" form, short and direct: "Saqlash", not "Ma'lumotlarni saqlab qo'yish".
- Product nouns stay consistent: post types _Havola_ (link), _Qayd_ (note), _Maqola_ (article); sections _Savol_, _Koʻrsat_, _Ishlar_.
- Technical terms widely used in English (commit, deploy, frontend) can stay English.

## Don't

- Don't build sentences by concatenating keys; use one key with variables.
- Don't put HTML in strings; use rich-text placeholders (`<link>…</link>`) supported by the formatter.
