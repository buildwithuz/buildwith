import { DEFAULT_LANG, isLang, type Lang, negotiate } from '@buildwith/i18n'
import type { Script } from '@buildwith/translit'

export type Theme = 'system' | 'light' | 'dark'

const YEAR = 60 * 60 * 24 * 365

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

/** Preferences for a signed-out reader: cookies first, then Accept-Language. */
export function anonPrefs(request: Request): { lang: Lang; script: Script; theme: Theme } {
  const c = request.headers.get('cookie')
  const lang = readCookie(c, 'bw_lang')
  const script = readCookie(c, 'bw_script')
  const theme = readCookie(c, 'bw_theme')
  return {
    lang: isLang(lang) ? lang : negotiate(request.headers.get('accept-language')) || DEFAULT_LANG,
    script: script === 'cyrl' ? 'cyrl' : 'latn',
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
  }
}

export function prefCookie(
  name: 'bw_lang' | 'bw_script' | 'bw_theme',
  value: string,
  secure: boolean,
): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure ? '; Secure' : ''}`
}
