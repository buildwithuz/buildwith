import { isLang } from '@buildwith/i18n'
import { ToastProvider } from '@buildwith/ui'
import {
  data,
  isRouteErrorResponse,
  Links,
  type LinksFunction,
  Meta,
  type MiddlewareFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useRouteLoaderData,
} from 'react-router'
import './app.css'
import { createClient } from '@buildwith/api-client'
import { ErrorPage } from './components/ErrorPage'
import { Shell } from './components/Shell'
import { API_ORIGIN } from './lib/api.server'
import { I18nProvider } from './lib/i18n'
import { anonPrefs } from './lib/prefs.server'
import { type Viewer, viewerContext } from './lib/session'
import type { Route } from './+types/root'

export const links: LinksFunction = () => [
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  { rel: 'icon', href: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
]

// One session lookup per request; every loader reads it from context.
const loadViewer: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const cookie = request.headers.get('cookie')
  const client = createClient({ baseUrl: API_ORIGIN, cookie })
  const res = await client.GET('/auth/me')
  if (!res.data) throw data({ code: 'internal' }, { status: 503 })
  const s = res.data
  const prefs = anonPrefs(request)
  const v: Viewer = {
    me: s.user ?? null,
    csrf: s.csrf_token,
    needsUsername: s.needs_username,
    devLogin: s.dev_login_enabled,
    lang: s.user?.lang && isLang(s.user.lang) ? s.user.lang : prefs.lang,
    script: s.user?.script ?? prefs.script,
    theme: s.user?.theme ?? prefs.theme,
    cookie,
  }
  context.set(viewerContext, v)
  const response = await next()
  // A signed-out browser gets its double-submit CSRF cookie on first visit.
  for (const c of res.response.headers.getSetCookie()) response.headers.append('set-cookie', c)
  return response
}

export const middleware: MiddlewareFunction<Response>[] = [loadViewer]

export async function loader({ context }: Route.LoaderArgs) {
  const v = context.get(viewerContext)
  return {
    me: v.me,
    csrf: v.csrf,
    needsUsername: v.needsUsername,
    devLogin: v.devLogin,
    lang: v.lang,
    script: v.script,
    theme: v.theme,
  }
}

export type RootData = Awaited<ReturnType<typeof loader>>

export function useRoot(): RootData {
  return useRouteLoaderData<RootData>('root')!
}

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<RootData>('root')
  const theme = root?.theme ?? 'system'
  const lang = root?.lang ?? 'uz'
  const htmlLang = lang === 'uz' && root?.script === 'cyrl' ? 'uz-Cyrl' : lang
  return (
    <html lang={htmlLang} data-theme={theme === 'system' ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#faf8f4" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#151413" media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <I18nProvider lang={loaderData.lang} script={loaderData.script}>
      <ToastProvider label="Notifications">
        <Shell>
          <Outlet />
        </Shell>
      </ToastProvider>
    </I18nProvider>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const root = useRouteLoaderData<RootData>('root')
  const status = isRouteErrorResponse(error) ? error.status : 500
  if (!isRouteErrorResponse(error) && import.meta.env.DEV) console.error(error)
  return (
    <I18nProvider lang={root?.lang ?? 'uz'} script={root?.script ?? 'latn'}>
      <ErrorPage status={status} />
    </I18nProvider>
  )
}
