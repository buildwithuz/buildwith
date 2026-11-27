// Server-only helpers for talking to the Go API. Every loader and action goes
// through here, so cookies, CSRF and errors are handled in one place.
import { type ApiClient, createClient, isApiError } from '@buildwith/api-client'
import { data, redirect, type RouterContextProvider } from 'react-router'
import { type Viewer, viewerContext } from './session'

export const API_ORIGIN = process.env.BUILDWITH_API_ORIGIN ?? 'http://localhost:8080'

export function viewer(context: Readonly<RouterContextProvider>): Viewer {
  return context.get(viewerContext)
}

/** A client that acts as the browser that made this request. */
export function api(context: Readonly<RouterContextProvider>, csrf?: string): ApiClient {
  const v = viewer(context)
  return createClient({ baseUrl: API_ORIGIN, cookie: v.cookie, csrf: csrf ?? v.csrf })
}

/** Signed-in user or a redirect to /login that comes back here afterwards. */
export function requireMe(context: Readonly<RouterContextProvider>, request: Request) {
  const v = viewer(context)
  if (!v.me) {
    const url = new URL(request.url)
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`)
  }
  return v.me
}

/** Turn an API error response into the right thrown Response for loaders. */
export function orThrow<T>(res: { data?: T; error?: unknown; response: Response }): T {
  if (res.data !== undefined) return res.data
  const status = res.response.status
  if (status === 404) throw data({ code: 'not_found' }, { status: 404 })
  if (status === 401) throw data({ code: 'unauthorized' }, { status: 401 })
  if (status === 403) throw data({ code: isApiError(res.error) ? res.error.code : 'forbidden' }, { status: 403 })
  throw data({ code: isApiError(res.error) ? res.error.code : 'internal' }, { status: status || 500 })
}

/** What an action returns when the API refused: a code the page can translate. */
export interface ActionError {
  error: string
  field?: string
}

export function actionError(res: { error?: unknown; response: Response }): ActionError {
  if (isApiError(res.error)) return { error: res.error.code, field: res.error.field }
  return { error: res.response.status === 429 ? 'rate_limited' : 'internal' }
}

/** Forward the API's Set-Cookie headers (sign-in, sign-out) to the browser. */
export function cookiesFrom(res: Response): Headers {
  const h = new Headers()
  for (const c of res.headers.getSetCookie()) h.append('set-cookie', c)
  return h
}

/**
 * Read a submitted form. Every mutating form carries the CSRF token as _csrf;
 * it becomes the X-CSRF-Token header, which the API checks against the session.
 */
export async function readForm(request: Request) {
  const form = await request.formData()
  const csrf = String(form.get('_csrf') ?? '')
  const get = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' ? v : ''
  }
  return { form, csrf, get, intent: get('intent'), js: get('_js') === '1' }
}

/** Where to go after a no-JS form post: the safe local path in redirectTo, or the referrer. */
export function backTo(request: Request, fallback = '/'): string {
  const ref = request.headers.get('referer')
  if (ref) {
    try {
      const u = new URL(ref)
      if (u.host === new URL(request.url).host) return u.pathname + u.search
    } catch {}
  }
  return fallback
}

export function safePath(p: string | null | undefined, fallback = '/'): string {
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return fallback
  return p
}

/**
 * Finish a mutation: JavaScript submissions (they carry _js, added after
 * hydration) get data back; plain form posts are sent back where they came from.
 */
export function finish<T>(request: Request, js: boolean, value: T, fallback = '/') {
  if (js) return data(value)
  throw redirect(backTo(request, fallback))
}
