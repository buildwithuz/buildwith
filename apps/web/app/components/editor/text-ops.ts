// Pure Markdown editing operations on a textarea's value and selection. Each
// returns one Edit: replace [start, end) with `insert`, then select
// [select[0], select[1]) in the new text. Keeping them pure makes them easy to
// test and lets the editor apply them through execCommand so ⌘Z still works.

export interface Edit {
  start: number
  end: number
  insert: string
  select: [number, number]
}

export interface Sel {
  text: string
  start: number
  end: number
}

/** Wrap the selection in `before`/`after`, or unwrap it when it is already wrapped. */
export function wrap({ text, start, end }: Sel, before: string, after: string, placeholder: string): Edit {
  const sel = text.slice(start, end)
  const outerBefore = text.slice(start - before.length, start)
  const outerAfter = text.slice(end, end + after.length)
  if (sel && outerBefore === before && outerAfter === after) {
    const s = start - before.length
    return { start: s, end: end + after.length, insert: sel, select: [s, s + sel.length] }
  }
  if (
    sel.startsWith(before) &&
    sel.endsWith(after) &&
    sel.length >= before.length + after.length &&
    sel.length > 0
  ) {
    const inner = sel.slice(before.length, sel.length - after.length)
    return { start, end, insert: inner, select: [start, start + inner.length] }
  }
  const inner = sel || placeholder
  const s = start + before.length
  return { start, end, insert: before + inner + after, select: [s, s + inner.length] }
}

/** [selection](url) with "url" selected; a selected URL becomes the target instead. */
export function link({ text, start, end }: Sel, placeholder: string): Edit {
  const sel = text.slice(start, end)
  if (/^(https?:\/\/|mailto:)\S+$/.test(sel)) {
    const label = placeholder
    return { start, end, insert: `[${label}](${sel})`, select: [start + 1, start + 1 + label.length] }
  }
  const label = sel || placeholder
  const insert = `[${label}](url)`
  if (!sel) return { start, end, insert, select: [start + 1, start + 1 + label.length] }
  const u = start + label.length + 3
  return { start, end, insert, select: [u, u + 3] }
}

/** A fenced code block around the selected lines, on lines of its own. */
export function codeBlock({ text, start, end }: Sel): Edit {
  const sel = text.slice(start, end)
  const pre = start > 0 && text[start - 1] !== '\n' ? '\n' : ''
  const post = end < text.length && text[end] !== '\n' ? '\n' : ''
  const body = sel.replace(/\n$/, '')
  const insert = `${pre}\`\`\`\n${body}\n\`\`\`${post}`
  const s = start + pre.length + 4
  return { start, end, insert, select: [s, s + body.length] }
}

function lineRange(text: string, start: number, end: number): [number, number] {
  const s = text.lastIndexOf('\n', start - 1) + 1
  let e = end
  if (e > start && text[e - 1] === '\n') e -= 1
  const nl = text.indexOf('\n', e)
  return [s, nl === -1 ? text.length : nl]
}

const LIST_PREFIX = /^(\s*)([-*+]|\d+[.)])\s+/
const PREFIX = {
  quote: /^>\s?/,
  bullet: /^(\s*)[-*+]\s+/,
  numbered: /^(\s*)\d+[.)]\s+/,
  heading: /^#{1,6}\s+/,
} as const

export type LineKind = keyof typeof PREFIX

/** Toggle a line prefix (quote, bullet, numbered, heading) on every selected line. */
export function toggleLines({ text, start, end }: Sel, kind: LineKind): Edit {
  const [s, e] = lineRange(text, start, end)
  const lines = text.slice(s, e).split('\n')
  const filled = lines.filter((l) => l.trim() !== '')
  const on = filled.length > 0 && filled.every((l) => PREFIX[kind].test(l))
  let n = 0
  const out = lines.map((l) => {
    if (on) return l.replace(PREFIX[kind], kind === 'bullet' || kind === 'numbered' ? '$1' : '')
    if (l.trim() === '' && lines.length > 1) return l
    const bare =
      kind === 'bullet' || kind === 'numbered' ? l.replace(LIST_PREFIX, '$1') : l.replace(PREFIX[kind], '')
    n += 1
    const mark = kind === 'quote' ? '> ' : kind === 'bullet' ? '- ' : kind === 'numbered' ? `${n}. ` : '## '
    const indent = /^\s*/.exec(bare)?.[0] ?? ''
    return kind === 'quote' || kind === 'heading' ? mark + bare : indent + mark + bare.slice(indent.length)
  })
  const insert = out.join('\n')
  if (start === end && lines.length === 1) {
    const caret = start + (insert.length - (e - s))
    return { start: s, end: e, insert, select: [Math.max(s, caret), Math.max(s, caret)] }
  }
  return { start: s, end: e, insert, select: [s, s + insert.length] }
}

/** Enter inside a list or quote: continue it, or end it on an empty item. */
export function continueList({ text, start, end }: Sel): Edit | null {
  if (start !== end) return null
  const s = text.lastIndexOf('\n', start - 1) + 1
  const line = text.slice(s, start)
  const m = /^(\s*)([-*+]|(\d+)([.)])|>)(\s+)(\[[ xX]\]\s+)?/.exec(line)
  if (!m) return null
  if (
    line.slice(m[0].length).trim() === '' &&
    text.slice(start, text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start)).trim() ===
      ''
  ) {
    // An empty item ends the list, leaving a blank line so the next paragraph stands apart.
    return { start: s, end: start, insert: '\n', select: [s + 1, s + 1] }
  }
  const indent = m[1] ?? ''
  let mark = m[2] ?? '-'
  if (m[3]) mark = `${Number(m[3]) + 1}${m[4]}`
  const task = m[6] ? '[ ] ' : ''
  const insert = `\n${indent}${mark}${mark === '>' ? ' ' : m[5]}${task}`
  return { start, end, insert, select: [start + insert.length, start + insert.length] }
}

/** True when the caret sits inside a fenced code block. */
export function inCodeBlock(text: string, pos: number): boolean {
  const before = text.slice(0, pos)
  const fences = before.match(/^\s*(```|~~~)/gm)
  return (fences?.length ?? 0) % 2 === 1
}

/** Tab / Shift+Tab inside a code block: indent or outdent the selected lines. */
export function indent({ text, start, end }: Sel, out: boolean): Edit {
  if (!out && start === end) return { start, end, insert: '\t', select: [start + 1, start + 1] }
  const [s, e] = lineRange(text, start, end)
  const lines = text.slice(s, e).split('\n')
  const next = lines.map((l) => (out ? l.replace(/^(\t| {1,4})/, '') : `\t${l}`))
  const insert = next.join('\n')
  const firstDelta = next[0]!.length - lines[0]!.length
  if (start === end) {
    const c = Math.max(s, start + firstDelta)
    return { start: s, end: e, insert, select: [c, c] }
  }
  return { start: s, end: e, insert, select: [s, s + insert.length] }
}
