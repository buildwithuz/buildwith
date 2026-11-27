// Verifies the locale files: same keys everywhere, valid ICU, no empty values,
// and correct Uzbek apostrophes (oʻ gʻ with U+02BB, separator U+02BC).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IntlMessageFormat } from 'intl-messageformat'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')
type Tree = { [k: string]: string | Tree }
const flat = (t: Tree, p = '', o: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(t)) {
    const key = p ? `${p}.${k}` : k
    if (typeof v === 'string') o[key] = v
    else flat(v, key, o)
  }
  return o
}
const load = (lang: string) => flat(JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8')))

const problems: string[] = []
const uz = load('uz')
for (const lang of ['uz', 'ru', 'en']) {
  const cat = load(lang)
  for (const key of Object.keys(uz)) if (!(key in cat)) problems.push(`${lang}: missing ${key}`)
  for (const [key, msg] of Object.entries(cat)) {
    if (!(key in uz)) problems.push(`${lang}: ${key} is not in uz.json`)
    if (!msg.trim()) problems.push(`${lang}: ${key} is empty`)
    try {
      new IntlMessageFormat(msg, lang)
    } catch (e) {
      problems.push(`${lang}: ${key} is not valid ICU: ${(e as Error).message}`)
    }
  }
}
for (const [key, msg] of Object.entries(uz)) {
  if (/[A-Za-z]['’‘`][A-Za-z]/.test(msg)) {
    problems.push(`uz: ${key} uses an ASCII or curly apostrophe; use ʻ (after o/g) or ʼ`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`i18n ok: ${Object.keys(uz).length} keys in uz, ru, en`)
