import { describe, expect, it } from 'vitest'
import { backTo, safePath } from '../api.server'

describe('safePath', () => {
  it('keeps local paths and refuses anything that leaves the site', () => {
    expect(safePath('/notes?x=1')).toBe('/notes?x=1')
    expect(safePath('//evil.example/x')).toBe('/')
    expect(safePath('/\\evil.example')).toBe('/')
    expect(safePath('https://evil.example')).toBe('/')
    expect(safePath(null, '/home')).toBe('/home')
  })
})

describe('backTo', () => {
  const req = (referer?: string) =>
    new Request('https://buildwith.uz/actions/vote', { headers: referer ? { referer } : {} })
  it('returns to the same-site page the form was on', () => {
    expect(backTo(req('https://buildwith.uz/l/3/x?sort=new'))).toBe('/l/3/x?sort=new')
  })
  it('ignores a foreign referrer', () => {
    expect(backTo(req('https://evil.example/'), '/fallback')).toBe('/fallback')
    expect(backTo(req(), '/fallback')).toBe('/fallback')
  })
})
