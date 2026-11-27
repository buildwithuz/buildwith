import { describe, expect, it } from 'vitest'
import vectors from '../testdata/vectors.json' with { type: 'json' }
import { displayHTML, forSearch, normalize, toCyrillic, toLatin } from './index'

type Vector = { in: string; out: string; note: string }

const suites: Record<string, (s: string) => string> = { normalize, toCyrillic, toLatin, forSearch }

for (const [name, fn] of Object.entries(suites)) {
  describe(name, () => {
    const cases = (vectors as unknown as Record<string, Vector[]>)[name] ?? []
    it('has vectors', () => expect(cases.length).toBeGreaterThan(0))
    for (const c of cases) {
      it(`${JSON.stringify(c.in)} — ${c.note}`, () => expect(fn(c.in)).toBe(c.out))
    }
  })
}

describe('displayHTML', () => {
  it('transliterates text but not tags, code or translate="no"', () => {
    const html =
      '<p>Salom <a href="https://x.uz/yangi">dunyo</a></p><pre><code>shahar := 1</code></pre>' +
      '<span translate="no">Toshkent</span><p>soʻng &amp; keyin</p>'
    expect(displayHTML(html, 'cyrl')).toBe(
      '<p>Салом <a href="https://x.uz/yangi">дунё</a></p><pre><code>shahar := 1</code></pre>' +
        '<span translate="no">Toshkent</span><p>сўнг &amp; кейин</p>',
    )
  })

  it('is a no-op for Latin readers', () => {
    expect(displayHTML('<p>salom</p>', 'latn')).toBe('<p>salom</p>')
  })
})
