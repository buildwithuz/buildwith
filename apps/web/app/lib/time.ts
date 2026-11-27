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

/**
 * A date in Tashkent time: "27.11.2026" in Uzbek (the local convention, and the
 * same in Latin and Cyrillic), "27 ноя 2026" in Russian, "Nov 27, 2026" in English.
 */
export function formatDate(iso: string, lang: Lang, withTime = false): string {
  const d = new Date(new Date(iso).getTime() + TASHKENT_MS)
  const day = d.getUTCDate()
  const monthNum = d.getUTCMonth() + 1
  const month = translate(lang, `month.${monthNum}`)
  const date =
    lang === 'uz'
      ? `${String(day).padStart(2, '0')}.${String(monthNum).padStart(2, '0')}.${d.getUTCFullYear()}`
      : lang === 'en'
        ? `${month} ${day}, ${d.getUTCFullYear()}`
        : `${day} ${month} ${d.getUTCFullYear()}`
  if (!withTime) return date
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${date}, ${hh}:${mm}`
}
