import { describe, expect, it } from 'vitest'
import { createClient, isApiError } from './index'

function capture() {
  const seen: Request[] = []
  const fetch = async (input: Request | string | URL, init?: RequestInit) => {
    seen.push(input instanceof Request ? input : new Request(input, init))
    return new Response(JSON.stringify({ status: 'ok', version: 'test' }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  return { seen, fetch: fetch as typeof globalThis.fetch }
}

describe('createClient', () => {
  it('acts as the browser: forwards cookie, CSRF token and the visitor address', async () => {
    const { seen, fetch } = capture()
    const client = createClient({
      baseUrl: 'http://api.test',
      cookie: 'bw_session=abc',
      csrf: 'tok',
      forwardedFor: '203.0.113.7',
      fetch,
    })
    const res = await client.GET('/health')
    expect(res.data?.status).toBe('ok')
    const req = seen[0]!
    expect(req.url).toBe('http://api.test/v1/health')
    expect(req.headers.get('cookie')).toBe('bw_session=abc')
    expect(req.headers.get('x-csrf-token')).toBe('tok')
    expect(req.headers.get('x-forwarded-for')).toBe('203.0.113.7')
  })

  it('sends nothing it was not given', async () => {
    const { seen, fetch } = capture()
    await createClient({ baseUrl: 'http://api.test', fetch }).GET('/health')
    const req = seen[0]!
    expect(req.headers.get('cookie')).toBeNull()
    expect(req.headers.get('x-csrf-token')).toBeNull()
  })
})

describe('isApiError', () => {
  it('recognises the API error shape only', () => {
    expect(isApiError({ code: 'not_found', message: 'x' })).toBe(true)
    expect(isApiError({ message: 'x' })).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})
