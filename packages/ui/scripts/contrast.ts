// Checks every text colour against every background it is used on, in both
// themes, against WCAG 2 AA (4.5:1 for text). Run: pnpm --filter @buildwith/ui contrast
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tokens.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]))
}

const themes = { light: block(':root {'), dark: block(':root[data-theme="dark"]') }

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

const texts = ['ink', 'muted', 'lapis', 'turquoise', 'saffron', 'danger', 'plum', 'moss']
const backgrounds = ['paper', 'surface', 'sunken']
const pairs: [string, string, number][] = []
for (const t of texts) for (const bg of backgrounds) pairs.push([t, bg, 4.5])
pairs.push(['lapis', 'lapis-soft', 4.5], ['saffron', 'saffron-soft', 4.5], ['on-accent', 'lapis', 4.5])

let failed = 0
for (const [name, theme] of Object.entries(themes)) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(theme[fg]!, theme[bg]!)
    const ok = r >= min
    if (!ok) failed++
    if (!ok || process.argv.includes('--all')) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${fg.padEnd(10)} on ${bg.padEnd(12)} ${r.toFixed(2)}:1`)
    }
  }
}
if (failed) {
  console.error(`${failed} pair(s) below WCAG AA`)
  process.exit(1)
}
console.log(`contrast ok: ${pairs.length * 2} pairs meet WCAG AA in light and dark`)
