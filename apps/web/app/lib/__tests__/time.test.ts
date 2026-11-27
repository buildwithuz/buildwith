import { describe, expect, it } from 'vitest'
import { ago, formatDate } from '../time'

describe('formatDate', () => {
  // 2026-11-27 20:30 UTC is 28 Nov 01:30 in Tashkent (UTC+5): the date must roll over.
  const iso = '2026-11-27T20:30:00Z'
  it('uses Tashkent time and the numeric Uzbek form', () => {
    expect(formatDate(iso, 'uz')).toBe('28.11.2026')
    expect(formatDate(iso, 'uz', true)).toBe('28.11.2026, 01:30')
  })
  it('uses month names in Russian and English', () => {
    expect(formatDate(iso, 'ru')).toBe('28 ноя 2026')
    expect(formatDate(iso, 'en')).toBe('Nov 28, 2026')
  })
})

describe('ago', () => {
  const now = Date.parse('2026-11-27T12:00:00Z')
  it('steps from now to minutes, hours and days', () => {
    expect(ago('2026-11-27T11:59:30Z', 'en', now)).toBe('now')
    expect(ago('2026-11-27T11:55:00Z', 'en', now)).toBe('5m')
    expect(ago('2026-11-27T09:00:00Z', 'uz', now)).toBe('3 soat')
    expect(ago('2026-11-25T12:00:00Z', 'ru', now)).toBe('2 д')
  })
  it('falls back to a date after a month', () => {
    expect(ago('2026-09-01T12:00:00Z', 'uz', now)).toBe('01.09.2026')
  })
})
