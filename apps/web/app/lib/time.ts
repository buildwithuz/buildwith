import { type Lang, translate } from '@buildwith/i18n'

/** Short relative time ("5 daq", "3h"); the full date goes in the title attribute. */
export function ago(iso: string, lang: Lang, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 60) return translate(lang, 'time.now')
  if (s < 3600) return translate(lang, 'time.minutes', { count: Math.floor(s / 60) })
  if (s < 86400) return translate(lang, 'time.hours', { count: Math.floor(s / 3600) })
  if (s < 86400 * 30) return translate(lang, 'time.days', { count: Math.floor(s / 86400) })
  return formatDate(iso, lang)
}

// Tashkent is UTC+5 all year. Dates are formatted by hand rather than with Intl
// because browsers and Node ship different Uzbek locale data, which would make
// the server and client render different text.
const TASHKENT_MS = 5 * 60 * 60 * 1000

/** "27 noy 2026" (and "· 14:05" with time), in Tashkent time. */
export function formatDate(iso: string, lang: Lang, withTime = false): string {
  const d = new Date(new Date(iso).getTime() + TASHKENT_MS)
  const month = translate(lang, `month.${d.getUTCMonth() + 1}`)
  const date = lang === 'en' ? `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`
  if (!withTime) return date
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${date}, ${hh}:${mm}`
}
