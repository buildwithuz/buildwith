import { describe, expect, it } from 'vitest'
import { negotiate, translate, translateParts } from './index'

describe('translate', () => {
  it('formats plurals per language', () => {
    expect(translate('en', 'count.points', { count: 1 })).toBe('1 point')
    expect(translate('en', 'count.points', { count: 5 })).toBe('5 points')
    expect(translate('ru', 'count.points', { count: 2 })).toBe('2 балла')
    expect(translate('ru', 'count.points', { count: 5 })).toBe('5 баллов')
    expect(translate('uz', 'count.points', { count: 5 })).toBe('5 ball')
  })
  it('falls back to the key when missing', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })
  it('renders rich tags through handlers', () => {
    const parts = translateParts('en', 'auth.terms', {
      guidelines: (c) => `[${c.join('')}]`,
      privacy: (c) => `{${c.join('')}}`,
    })
    expect(parts.join('')).toBe('By signing in you agree to the [guidelines] and {privacy policy}.')
  })
})

describe('negotiate', () => {
  it('prefers the highest-ranked supported language', () => {
    expect(negotiate('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru')
    expect(negotiate('de-DE,en;q=0.5')).toBe('en')
    expect(negotiate('fr')).toBe('uz')
    expect(negotiate(null)).toBe('uz')
  })
})
