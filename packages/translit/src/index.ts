// Uzbek Latin ⇄ Cyrillic, mirroring apps/api/internal/translit exactly.
// Both implementations are tested against testdata/vectors.json.
import loanwords from '../testdata/loanwords.json' with { type: 'json' }

export const OKINA = 'ʻ' // ʻ the mark in oʻ and gʻ
export const TUTUQ = 'ʼ' // ʼ the separator in maʼno

const loanStems: readonly string[] = loanwords.stems

const PROTECTED = /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[@#][\w-]+/g
const APOSTROPHES = new Set(["'", '’', '‘', '`', TUTUQ, OKINA])

const isLetter = (c: string | undefined): boolean => c !== undefined && /\p{L}/u.test(c)
const isUpper = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase()
const isMark = (c: string): boolean => c === OKINA || c === TUTUQ
const isWordChar = (c: string): boolean => isLetter(c) || isMark(c)

/** Fixes apostrophes: after o/g before a letter → ʻ; between other letters → ʼ. */
export function normalize(s: string): string {
  const rs = [...s]
  for (let i = 1; i < rs.length - 1; i++) {
    const r = rs[i]!
    if (!APOSTROPHES.has(r)) continue
    const prev = rs[i - 1]!
    const next = rs[i + 1]!
    if (!isLetter(prev) || !isLetter(next)) continue
    rs[i] = prev.toLowerCase() === 'o' || prev.toLowerCase() === 'g' ? OKINA : TUTUQ
  }
  return rs.join('')
}

function mapUnprotected(s: string, f: (part: string) => string): string {
  let out = ''
  let last = 0
  for (const m of s.matchAll(PROTECTED)) {
    out += f(s.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + f(s.slice(last))
}

function eachChunk(s: string, f: (chunk: string[], word: boolean) => string): string {
  const rs = [...s]
  let out = ''
  let start = 0
  for (let i = 1; i <= rs.length; i++) {
    if (i === rs.length || isWordChar(rs[i]!) !== isWordChar(rs[start]!)) {
      out += f(rs.slice(start, i), isWordChar(rs[start]!))
      start = i
    }
  }
  return out
}

const LATIN_SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з',
  c: 'к', w: 'в',
}
const LATIN_Y: Record<string, string> = { e: 'е', o: 'ё', u: 'ю', a: 'я' }

const cased = (model: string, cyr: string): string => (isUpper(model) ? cyr.toUpperCase() : cyr)

function wordToCyrillic(w: string[]): string {
  const lower = w.join('').toLowerCase()
  let loanEnd = 0
  for (const stem of loanStems) if (lower.startsWith(stem)) loanEnd = Math.max(loanEnd, [...stem].length)

  const at = (i: number): string => (i >= 0 && i < w.length ? w[i]!.toLowerCase() : '')
  let out = ''
  for (let i = 0; i < w.length; ) {
    const r = w[i]!
    const c = at(i)
    const n = at(i + 1)
    if ((c === 'o' || c === 'g') && n === OKINA) {
      out += cased(r, c === 'o' ? 'ў' : 'ғ')
      i += 2
    } else if ((c === 's' || c === 'c') && n === 'h') {
      out += cased(r, c === 's' ? 'ш' : 'ч')
      i += 2
    } else if (c === 'y' && LATIN_Y[n] && !(n === 'o' && at(i + 2) === OKINA)) {
      out += cased(r, LATIN_Y[n]!)
      i += 2
    } else if (c === 't' && n === 's' && i + 1 < loanEnd) {
      out += cased(r, 'ц')
      i += 2
    } else if (c === 'e' && i === 0) {
      out += cased(r, 'э')
      i++
    } else if (r === TUTUQ) {
      if (!((at(i - 1) === 's' || at(i - 1) === 'c') && n === 'h')) out += 'ъ'
      i++
    } else if (LATIN_SINGLE[c]) {
      out += cased(r, LATIN_SINGLE[c]!)
      i++
    } else {
      out += r
      i++
    }
  }
  return out
}

const CYR_SINGLE: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: `g${OKINA}`, д: 'd', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', о: 'o', ў: `o${OKINA}`, п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ҳ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', ъ: TUTUQ, ь: '', э: 'e', ю: 'yu',
  я: 'ya', ы: 'i', щ: 'sh',
}
const CYR_VOWELS = 'аеёиоуўэюя'

function wordToLatin(w: string[]): string {
  const allCaps = w.length > 1 && w.every((r) => !isLetter(r) || isUpper(r))
  let out = ''
  w.forEach((r, i) => {
    const c = r.toLowerCase()
    let lat = CYR_SINGLE[c]
    if (c === 'е') lat = i === 0 || CYR_VOWELS.includes(w[i - 1]!.toLowerCase()) ? 'ye' : 'e'
    if (lat === undefined) {
      out += r
    } else if (!isUpper(r) || lat === '') {
      out += lat
    } else if (allCaps) {
      out += lat.toUpperCase()
    } else {
      out += lat.charAt(0).toUpperCase() + lat.slice(1)
    }
  })
  return out
}

/** Latin Uzbek → Cyrillic. URLs, emails, @usernames and #tags are left alone. */
export function toCyrillic(s: string): string {
  return mapUnprotected(normalize(s), (part) => eachChunk(part, (w, word) => (word ? wordToCyrillic(w) : w.join(''))))
}

/** Cyrillic Uzbek → Latin. URLs, emails, @usernames and #tags are left alone. */
export function toLatin(s: string): string {
  return mapUnprotected(s, (part) => eachChunk(part, (w, word) => (word ? wordToLatin(w) : w.join(''))))
}

/** The search key: Latin, lowercase, no apostrophes, single spaces. */
export function forSearch(s: string): string {
  return [...toLatin(normalize(s)).toLowerCase()]
    .filter((c) => !APOSTROPHES.has(c))
    .join('')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

export type Script = 'latn' | 'cyrl'

/** Show text in the reader's script. Stored content is Latin; Cyrillic is made at display time. */
export function display(s: string, script: Script): string {
  return script === 'cyrl' ? toCyrillic(s) : s
}

const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', 'math'])

/**
 * Transliterate the text of server-rendered HTML, skipping code, preformatted
 * blocks and anything marked translate="no". Tags and attributes are untouched.
 * The input must be HTML the server already sanitized.
 */
export function displayHTML(html: string, script: Script): string {
  if (script !== 'cyrl') return html
  let out = ''
  const skip: string[] = []
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g
  let last = 0
  for (const m of html.matchAll(re)) {
    const text = html.slice(last, m.index)
    out += skip.length ? text : toCyrillicText(text)
    out += m[0]
    last = m.index + m[0].length
    const [, closing, rawName, attrs] = m
    const name = rawName!.toLowerCase()
    const selfClosing = attrs!.trimEnd().endsWith('/') || VOID.has(name)
    if (closing) {
      if (skip.at(-1) === name) skip.pop()
    } else if (!selfClosing && (skip.length || SKIP_TAGS.has(name) || /translate\s*=\s*["']?no/i.test(attrs!))) {
      skip.push(name)
    }
  }
  const tail = html.slice(last)
  return out + (skip.length ? tail : toCyrillicText(tail))
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'col', 'embed', 'track'])

// Text between tags may hold entities like &amp; — keep them intact.
function toCyrillicText(text: string): string {
  return text
    .split(/(&[a-zA-Z0-9#]+;)/)
    .map((part, i) => (i % 2 ? part : toCyrillic(part)))
    .join('')
}
