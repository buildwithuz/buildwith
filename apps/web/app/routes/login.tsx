import { Badge, buttonClass, cx, Input } from '@buildwith/ui'
import { ArrowRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { data, Form, redirect, useNavigation } from 'react-router'
import { AuthCard, FormError } from '../components/account/AuthCard'
import { GitHubIcon, GoogleIcon, TelegramIcon } from '../components/account/BrandIcons'
import { CsrfField } from '../components/forms'
import { actionError, api, cookiesFrom, readForm, safePath, viewer } from '../lib/api.server'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/login'

const SEEDED = ['aziz', 'malika', 'moderator'] as const

function afterSignIn(next: string, needsUsername: boolean) {
  return needsUsername ? `/welcome?next=${encodeURIComponent(next)}` : next
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const q = url.searchParams
  const next = safePath(q.get('next'))
  const v = viewer(context)
  let error: string | null = null

  // The Telegram widget sends the browser back here with its signed payload.
  if (q.has('hash') && q.has('id') && q.has('auth_date')) {
    const opt = (k: string) => q.get(k) || undefined
    const res = await api(context).POST('/auth/telegram', {
      body: {
        id: Number(q.get('id')),
        auth_date: Number(q.get('auth_date')),
        hash: q.get('hash') ?? '',
        first_name: opt('first_name'),
        last_name: opt('last_name'),
        username: opt('username'),
        photo_url: opt('photo_url'),
      },
    })
    if (res.data)
      throw redirect(afterSignIn(next, res.data.needs_username), { headers: cookiesFrom(res.response) })
    error = actionError(res).error
  } else if (v.me) {
    throw redirect(afterSignIn(next, v.needsUsername))
  }

  const env = process.env
  const bot = env.BUILDWITH_TELEGRAM_BOT_USERNAME?.trim() || null
  const origin = env.BUILDWITH_PUBLIC_ORIGIN?.replace(/\/$/, '') || url.origin
  return {
    next,
    error,
    github: Boolean(env.BUILDWITH_GITHUB_CLIENT_ID),
    google: Boolean(env.BUILDWITH_GOOGLE_CLIENT_ID),
    telegram: bot ? { bot, authUrl: `${origin}/login?next=${encodeURIComponent(next)}` } : null,
    devLogin: v.devLogin,
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf } = await readForm(request)
  const next = safePath(new URL(request.url).searchParams.get('next') ?? get('next'))
  // A quick button carries its user in "as"; the text field is "username".
  const username = (get('as') || get('username')).trim().replace(/^@/, '')
  if (!username) return data({ error: 'invalid', username }, { status: 422 })
  const res = await api(context, csrf).POST('/auth/dev-login', { body: { username } })
  if (!res.data) return data({ ...actionError(res), username }, { status: res.response.status })
  throw redirect(afterSignIn(next, res.data.needs_username), { headers: cookiesFrom(res.response) })
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'nav.login', noindex: true })
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT()
  const { next, github, google, telegram, devLogin } = loaderData
  const nav = useNavigation()
  const pending = nav.state !== 'idle' && nav.formMethod === 'POST'
  const pendingAs = pending ? String(nav.formData?.get('as') ?? '') : ''
  const error = actionData?.error ?? loaderData.error
  const redirectTo = encodeURIComponent(next)

  return (
    <AuthCard
      title={t('auth.title')}
      subtitle={next !== '/' ? t('auth.sign_in_to_continue') : t('auth.subtitle')}
      footer={t.rich('auth.terms', {
        guidelines: (c) => (
          <a
            href="/guidelines"
            className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
          >
            {c}
          </a>
        ),
        privacy: (c) => (
          <a
            href="/privacy"
            className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
          >
            {c}
          </a>
        ),
      })}
    >
      <div className="flex flex-col gap-2.5">
        {error && <FormError>{t(`error.${error}`)}</FormError>}
        <Provider
          href={`/v1/auth/github/start?redirect_to=${redirectTo}`}
          enabled={github}
          icon={<GitHubIcon />}
          label={t('auth.github')}
        />
        <Provider
          href={`/v1/auth/google/start?redirect_to=${redirectTo}`}
          enabled={google}
          icon={<GoogleIcon />}
          label={t('auth.google')}
        />
        {telegram ? (
          <TelegramWidget bot={telegram.bot} authUrl={telegram.authUrl} label={t('auth.telegram')} />
        ) : (
          <Provider enabled={false} icon={<TelegramIcon />} label={t('auth.telegram')} />
        )}
        {!github && !google && !telegram && (
          <p className="pt-1 text-center text-xs text-muted">{t('auth.not_configured')}</p>
        )}
      </div>

      {devLogin && (
        <section aria-labelledby="dev-login" className="mt-7">
          <div className="mb-4 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="rounded-card border border-dashed border-saffron/60 bg-saffron-soft/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="dev-login" className="text-sm font-semibold text-ink">
                {t('auth.dev')}
              </h2>
              <Badge tone="saffron">dev</Badge>
            </div>
            <Form method="post" className="flex gap-2">
              <CsrfField />
              <input type="hidden" name="next" value={next} />
              <label htmlFor="dev-username" className="sr-only">
                {t('settings.username')}
              </label>
              <Input
                id="dev-username"
                name="username"
                size="sm"
                defaultValue={actionData?.username ?? ''}
                placeholder="aziz"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                translate="no"
                aria-invalid={actionData?.error ? true : undefined}
                className="min-w-0 flex-1 font-mono"
              />
              <button type="submit" className={buttonClass('primary', 'sm')} disabled={pending}>
                {t('auth.continue')}
              </button>
            </Form>
            <Form method="post" className="mt-3">
              <CsrfField />
              <input type="hidden" name="next" value={next} />
              <p className="mb-2 text-xs text-muted">{t('auth.quick')}</p>
              <div className="flex flex-wrap gap-1.5">
                {SEEDED.map((u) => (
                  <button
                    key={u}
                    type="submit"
                    name="as"
                    value={u}
                    disabled={pending}
                    translate="no"
                    className={cx(
                      'inline-flex h-7 items-center rounded-full border border-line bg-surface px-2.5 font-mono text-xs text-ink',
                      'transition-colors duration-150 hover:border-muted disabled:opacity-60',
                      pendingAs === u && 'border-lapis text-lapis',
                    )}
                  >
                    @{u}
                  </button>
                ))}
              </div>
            </Form>
          </div>
        </section>
      )}
    </AuthCard>
  )
}

function Provider({
  href,
  enabled,
  icon,
  label,
}: {
  href?: string
  enabled: boolean
  icon: React.ReactNode
  label: string
}) {
  const t = useT()
  const cls = buttonClass('secondary', 'md', 'relative h-11 w-full justify-center text-[15px]')
  if (!enabled || !href) {
    return (
      <span
        aria-disabled="true"
        className={cx(cls, 'pointer-events-none cursor-not-allowed flex-col gap-0 opacity-60')}
      >
        <span className="flex items-center gap-2.5">
          {icon}
          {label}
        </span>
        <span className="sr-only">: {t('auth.not_configured')}</span>
      </span>
    )
  }
  return (
    <a href={href} className={cls}>
      {icon}
      {label}
      <ArrowRight size={16} className="absolute right-3.5 text-muted" aria-hidden="true" />
    </a>
  )
}

/**
 * Telegram's own login button. It must run Telegram's script, which draws an
 * iframe next to itself, so it is inserted after hydration (React would
 * otherwise see the iframe as a mismatch). It needs JavaScript by design.
 */
function TelegramWidget({ bot, authUrl, label }: { bot: string; authUrl: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = document.createElement('script')
    s.async = true
    s.src = 'https://telegram.org/js/telegram-widget.js?22'
    s.setAttribute('data-telegram-login', bot)
    s.setAttribute('data-size', 'large')
    s.setAttribute('data-radius', '6')
    s.setAttribute('data-request-access', 'write')
    s.setAttribute('data-auth-url', authUrl)
    el.replaceChildren(s)
    return () => el.replaceChildren()
  }, [bot, authUrl])
  return (
    <div className="flex min-h-11 flex-col items-center justify-center gap-1">
      <div ref={ref} className="flex min-h-10 items-center justify-center" />
      <noscript>
        <Provider enabled={false} icon={<TelegramIcon />} label={label} />
      </noscript>
    </div>
  )
}
