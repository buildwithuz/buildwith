import { buttonClass } from '@buildwith/ui'
import { LogOut } from 'lucide-react'
import { Form, redirect, useNavigation } from 'react-router'
import { AuthCard } from '../components/account/AuthCard'
import { CsrfField } from '../components/forms'
import { api, cookiesFrom, readForm, viewer } from '../lib/api.server'
import { useMe } from '../lib/hooks'
import { useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/logout'

export async function loader({ context }: Route.LoaderArgs) {
  if (!viewer(context).me) throw redirect('/')
  return null
}

/** Signing out is a POST: a GET link (or a prefetch) must never end a session. */
export async function action({ request, context }: Route.ActionArgs) {
  const { csrf } = await readForm(request)
  const res = await api(context, csrf).POST('/auth/logout')
  throw redirect('/', { headers: cookiesFrom(res.response) })
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'nav.logout', noindex: true })
}

export default function Logout() {
  const t = useT()
  const tx = useTx()
  const me = useMe()
  const busy = useNavigation().state !== 'idle'
  return (
    <AuthCard title={t('logout.title')} subtitle={t('logout.body')}>
      {me && (
        <p className="-mt-2 mb-6 text-center text-sm text-muted">
          <span className="text-ink">{tx.text(me.display_name || me.username)}</span>{' '}
          <span translate="no" className="font-mono text-xs">
            @{me.username}
          </span>
        </p>
      )}
      <Form method="post" className="flex flex-col gap-2.5">
        <CsrfField />
        <button type="submit" className={buttonClass('primary', 'md', 'h-11 w-full')} disabled={busy}>
          <LogOut size={16} aria-hidden="true" />
          {t('nav.logout')}
        </button>
        <a href="/" className={buttonClass('ghost', 'md', 'h-11 w-full')}>
          {t('common.cancel')}
        </a>
      </Form>
    </AuthCard>
  )
}
