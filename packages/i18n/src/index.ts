// Shared UI strings for web, bot and emails. `uz` is the source of truth;
// Cyrillic Uzbek is produced at display time by @buildwith/translit.
import { IntlMessageFormat } from 'intl-messageformat'
import en from '../locales/en.json' with { type: 'json' }
import ru from '../locales/ru.json' with { type: 'json' }
import uz from '../locales/uz.json' with { type: 'json' }

export const LANGS = ['uz', 'ru', 'en'] as const
export type Lang = (typeof LANGS)[number]
export const DEFAULT_LANG: Lang = 'uz'

type Tree = { [k: string]: string | Tree }

function flatten(tree: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else flatten(v, key, out)
  }
  return out
}

export const catalogs: Record<Lang, Record<string, string>> = {
  uz: flatten(uz as Tree),
  ru: flatten(ru as Tree),
  en: flatten(en as Tree),
}

export type MessageKey = keyof typeof catalogs.uz & string
export type Vars = Record<string, string | number | ((chunks: unknown[]) => unknown)>

const cache = new Map<string, IntlMessageFormat>()

// ICU locale for plural rules; Uzbek plural rules are in CLDR as "uz".
const icuLocale: Record<Lang, string> = { uz: 'uz', ru: 'ru', en: 'en' }

function formatter(lang: Lang, key: string): IntlMessageFormat | null {
  const id = `${lang}:${key}`
  let f = cache.get(id)
  if (!f) {
    const msg = catalogs[lang][key] ?? catalogs.uz[key]
    if (msg === undefined) return null
    f = new IntlMessageFormat(msg, icuLocale[lang])
    cache.set(id, f)
  }
  return f
}

/** Format a message as a plain string. */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  const f = formatter(lang, key)
  if (!f) return key
  const out = f.format(vars as Record<string, string | number>)
  return Array.isArray(out) ? out.join('') : String(out)
}

/** Format a message that has rich-text tags; tag handlers return nodes. */
export function translateParts(lang: Lang, key: string, vars: Vars): unknown[] {
  const f = formatter(lang, key)
  if (!f) return [key]
  const out = f.format(vars as Record<string, never>)
  return Array.isArray(out) ? out : [out]
}

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v)
}

/** Pick a language from an Accept-Language header, defaulting to Uzbek. */
export function negotiate(acceptLanguage: string | null | undefined): Lang {
  if (!acceptLanguage) return DEFAULT_LANG
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=')
      return { lang: tag.toLowerCase().slice(0, 2), q: q ? Number(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)
  for (const { lang } of ranked) if (isLang(lang)) return lang
  return DEFAULT_LANG
}
