// A deliberately tiny Markdown renderer for our own static pages (about,
// guidelines, privacy, terms). User content is rendered and sanitized by the
// API; this only ever sees files from app/content, so it supports just the
// subset those files use: headings, paragraphs, lists, one-line quotes and
// inline bold/italic/code/links. Everything is escaped before markup is added.

export interface StaticPage {
  title: string
  lead: string
  html: string
  toc: { id: string; text: string }[]
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s: string): string {
  const code: string[] = []
  let out = esc(s).replace(/`([^`]+)`/g, (_, c: string) => {
    code.push(c)
    return `\uE000${code.length - 1}\uE000`
  })
  out = out
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) => {
      const safe = /^(https?:\/\/|\/|#|mailto:)/.test(href) ? href : '#'
      const external = /^https?:\/\//.test(safe)
      return `<a href="${safe}"${external ? ' rel="noopener"' : ''}>${text}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
  return out.replace(/\uE000(\d+)\uE000/g, (_, i: string) => `<code>${code[Number(i)]}</code>`)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
}

export function renderStatic(md: string): StaticPage {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let title = ''
  let lead = ''
  const html: string[] = []
  const toc: StaticPage['toc'] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  const used = new Set<string>()

  const flushPara = () => {
    if (para.length === 0) return
    const text = para.join(' ')
    if (!lead && title && html.length === 0) lead = inline(text)
    else html.push(`<p>${inline(text)}</p>`)
    para = []
  }
  const closeList = () => {
    if (list) html.push(`</${list}>`)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const ul = /^[-*]\s+(.*)$/.exec(line)
    const ol = /^\d+\.\s+(.*)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    if (!line.trim()) {
      flushPara()
      closeList()
    } else if (h) {
      flushPara()
      closeList()
      const level = h[1]!.length
      const text = h[2]!
      if (level === 1) {
        title = text
        continue
      }
      let id = slugify(text) || `s${html.length}`
      while (used.has(id)) id += '-'
      used.add(id)
      if (level === 2) toc.push({ id, text: text.replace(/[`*_]/g, '') })
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`)
    } else if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (list !== kind) {
        closeList()
        html.push(`<${kind}>`)
        list = kind
      }
      html.push(`<li>${inline((ul ?? ol)![1]!)}</li>`)
    } else if (quote) {
      flushPara()
      closeList()
      const prev = html[html.length - 1]
      if (prev?.startsWith('<aside'))
        html[html.length - 1] = prev.replace('</p></aside>', ` ${inline(quote[1]!)}</p></aside>`)
      else html.push(`<aside class="callout callout-warning"><p>${inline(quote[1]!)}</p></aside>`)
    } else {
      closeList()
      para.push(line.trim())
    }
  }
  flushPara()
  closeList()
  return { title, lead, html: html.join('\n'), toc }
}
