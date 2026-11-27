// React Router's default Node entry, plus a per-request CSP nonce so the inline
// scripts React Router writes (loader data, route manifest) run under a strict
// Content-Security-Policy without 'unsafe-inline'.
import { randomBytes } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { createReadableStreamFromReadable } from '@react-router/node'
import { isbot } from 'isbot'
import type { RenderToPipeableStreamOptions } from 'react-dom/server'
import { renderToPipeableStream } from 'react-dom/server'
import { type EntryContext, type RouterContextProvider, ServerRouter } from 'react-router'
import { NonceContext } from './lib/nonce'

export const streamTimeout = 5_000

const PRODUCTION = process.env.NODE_ENV === 'production'

/**
 * The policy. Styles allow 'unsafe-inline' because React style attributes and
 * Radix positioning are inline; scripts never do. Telegram's login widget is the
 * only third party, and only on /login.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://telegram.org`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    'frame-src https://oauth.telegram.org',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders })
  }
  const nonce = randomBytes(16).toString('base64')
  // Vite's dev server injects its own inline scripts, so the policy is enforced in production builds only.
  if (PRODUCTION) responseHeaders.set('Content-Security-Policy', contentSecurityPolicy(nonce))
  responseHeaders.set('X-Content-Type-Options', 'nosniff')
  responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return new Promise((resolve, reject) => {
    let shellRendered = false
    const userAgent = request.headers.get('user-agent')
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady'
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000)

    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId)
              timeoutId = undefined
              callback()
            },
          })
          responseHeaders.set('Content-Type', 'text/html; charset=utf-8')
          pipe(body)
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )
        },
        onShellError(error: unknown) {
          reject(error)
        },
        onError(error: unknown) {
          responseStatusCode = 500
          if (shellRendered) console.error(error)
        },
      },
    )
  })
}
