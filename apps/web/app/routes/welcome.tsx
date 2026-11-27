import { buttonClass, Field } from '@buildwith/ui'
import { data, Form, redirect, useNavigation } from 'react-router'
import { AuthCard, FormError } from '../components/account/AuthCard'
import { CsrfField } from '../components/forms'
import { actionError, api, readForm, safePath, viewer } from '../lib/api.server'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/welcome'

const PATTERN = '[A-Za-z0-9][A-Za-z0-9_\\-]{1,29}'

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const next = safePath(url.searchParams.get('next'))
  const v = viewer(context)
  if (!v.me) throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`)
  if (!v.needsUsername) throw redirect(next)
  return { next, suggestion: v.me.username }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf } = await readForm(request)
  const next = safePath(get('next'))
  const username = get('username').trim().replace(/^@/, '')
  const res = await api(context, csrf).POST('/auth/username', { body: { username } })
  if (!res.data) return data({ ...actionError(res), username }, { status: res.response.status })
  throw redirect(next)
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'auth.welcome_title', noindex: true })
}

export default function Welcome({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT()
  const busy = useNavigation().state !== 'idle'
  const error = actionData?.error
  return (
    <AuthCard title={t('auth.welcome_title')} subtitle={t('auth.welcome_body')}>
      <Form method="post" className="flex flex-col gap-4">
        <CsrfField />
        <input type="hidden" name="next" value={loaderData.next} />
        {error && error !== 'invalid' && error !== 'username_taken' && (
          <FormError>{t(`error.${error}`)}</FormError>
        )}
        <Field
          label={t('settings.username')}
          hint={`${t('welcome.hint')} ${t('welcome.later')}`}
          error={error === 'invalid' || error === 'username_taken' ? t(`error.${error}`) : undefined}
        >
          {(p) => (
            <div
              className="flex h-11 items-center rounded-control border border-line bg-surface focus-within:border-lapis aria-[invalid=true]:border-danger"
              aria-invalid={p['aria-invalid']}
            >
              <span translate="no" className="select-none pl-3 font-mono text-sm text-muted">
                buildwith.uz/@
              </span>
              <input
                {...p}
                name="username"
                required
                // biome-ignore lint/a11y/noAutofocus: choosing a username is the only thing on this page
                autoFocus
                pattern={PATTERN}
                minLength={2}
                maxLength={30}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                translate="no"
                defaultValue={actionData?.username ?? loaderData.suggestion}
                className="h-full min-w-0 flex-1 bg-transparent pr-3 font-mono text-[15px] text-ink outline-none"
              />
            </div>
          )}
        </Field>
        <button type="submit" className={buttonClass('primary', 'md', 'h-11 w-full')} disabled={busy}>
          {t('auth.continue')}
        </button>
      </Form>
    </AuthCard>
  )
}
