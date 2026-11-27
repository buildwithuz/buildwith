import type { Schemas } from '@buildwith/api-client'
import {
  Avatar,
  Badge,
  Button,
  buttonClass,
  Checkbox,
  cx,
  EmptyState,
  Field,
  Girih,
  Input,
  NavTabs,
  useToast,
} from '@buildwith/ui'
import { ArrowUpRight, Ban, Check, EyeOff, Pencil } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { data, useActionData, useFetcher } from 'react-router'
import { FormFields } from '../components/forms'
import { TimeAgo } from '../components/UserLine'
import { actionError, api, finish, orThrow, readForm, requireMe } from '../lib/api.server'
import { useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/mod'

type Tab = 'reports' | 'holds' | 'domains'
type Result = { intent?: string; ok?: boolean; error?: string; field?: string }

export async function loader({ request, context }: Route.LoaderArgs) {
  const me = requireMe(context, request)
  if (!me.is_moderator) throw data({ code: 'forbidden' }, { status: 403 })
  const url = new URL(request.url)
  const t = url.searchParams.get('tab')
  const tab: Tab = t === 'holds' || t === 'domains' ? t : 'reports'
  const client = api(context)
  const [reports, holds, rules] = await Promise.all([
    client.GET('/mod/reports', { params: { query: { limit: 50 } } }),
    client.GET('/mod/holds', { params: { query: { limit: 50 } } }),
    tab === 'domains' ? client.GET('/mod/domain-rules') : null,
  ])
  return {
    tab,
    reports: orThrow(reports),
    holds: orThrow(holds).items,
    rules: rules ? orThrow(rules).items : [],
    editing: url.searchParams.get('domain') ?? '',
  }
}

/** Page-specific moderation: hide-and-resolve for a report, and domain rules. */
export async function action({ request, context }: Route.ActionArgs) {
  const { get, form, csrf, js, intent } = await readForm(request)
  const client = api(context, csrf)
  if (intent === 'hide-report') {
    const subject = {
      subject_type: get('subject_type') as Schemas['FlagSubject'],
      subject_id: Number(get('subject_id')),
    }
    const kill = await client.POST('/mod/kill', {
      body: { ...subject, killed: true, reason: get('reason').trim() },
    })
    if (!kill.response.ok)
      return data<Result>({ intent, ...actionError(kill) }, { status: kill.response.status })
    const done = await client.POST('/mod/reports/{id}', {
      params: { path: { id: Number(get('report_id')) } },
      body: { status: 'actioned', reason: get('reason').trim() },
    })
    if (!done.response.ok)
      return data<Result>({ intent, ...actionError(done) }, { status: done.response.status })
    return finish(request, js, { intent, ok: true } as Result, '/mod')
  }
  if (intent === 'domain-rule') {
    const multiplier = Number(get('multiplier'))
    const res = await client.PUT('/mod/domain-rules', {
      body: {
        domain: get('domain').trim(),
        multiplier: Number.isFinite(multiplier) ? Math.min(2, Math.max(0, multiplier)) : 1,
        banned: form.get('banned') === 'on',
        note: get('note').trim(),
      },
    })
    if (!res.data) return data<Result>({ intent, ...actionError(res) }, { status: res.response.status })
    return data<Result>({ intent, ok: true })
  }
  return data<Result>({ intent, error: 'bad_request' }, { status: 400 })
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'mod.title', noindex: true })
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const t = useT()
  const forbidden = (error as { status?: number } | undefined)?.status === 403
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <Girih className="text-line" size={120} />
      <p className="font-mono text-sm text-muted">{forbidden ? 403 : 500}</p>
      <h1 className="text-2xl font-semibold text-ink">{t(forbidden ? 'mod.title' : 'error.title')}</h1>
      <p className="text-muted">{t(forbidden ? 'mod.forbidden' : 'error.internal')}</p>
      <div className="flex gap-2">
        <a href="/modlog" className={buttonClass('secondary')}>
          {t('mod.log_title')}
        </a>
        <a href="/" className={buttonClass('ghost')}>
          {t('error.go_home')}
        </a>
      </div>
    </div>
  )
}

const SUBJECT_PATH: Record<string, string> = { link: '/l/', comment: '/c/', note: '/n/', article: '/a/' }

function SubjectLink({ type, id }: { type: string; id: number }) {
  const t = useT()
  const label = t(`mod.subject.${type}`, { id })
  const base = SUBJECT_PATH[type]
  if (!base) return <span className="font-medium text-ink">{label}</span>
  return (
    <a
      href={`${base}${id}`}
      className="inline-flex items-center gap-0.5 font-medium text-ink hover:underline"
    >
      {label}
      <ArrowUpRight size={14} className="text-muted" aria-hidden="true" />
    </a>
  )
}

/** A fetcher that toasts its result; without JavaScript the form posts and comes back. */
function useModFetcher() {
  const t = useT()
  const toast = useToast()
  const f = useFetcher<Result>()
  const seen = useRef<Result | undefined>(undefined)
  useEffect(() => {
    if (f.state !== 'idle' || !f.data || seen.current === f.data) return
    seen.current = f.data
    toast(f.data.error ? t(`error.${f.data.error}`) : t('mod.done'), f.data.error ? 'error' : 'info')
  }, [f.state, f.data, t, toast])
  return f
}

export default function Mod({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const { tab, reports, holds } = loaderData
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('mod.title')}</h1>
        <a href="/modlog" className="text-sm text-lapis hover:underline">
          {t('mod.log_title')} →
        </a>
      </header>
      <NavTabs
        label={t('mod.title')}
        tabs={[
          { href: '/mod', label: t('mod.reports'), active: tab === 'reports', count: reports.open_count },
          { href: '/mod?tab=holds', label: t('mod.holds'), active: tab === 'holds', count: holds.length },
          { href: '/mod?tab=domains', label: t('mod.domains'), active: tab === 'domains' },
        ]}
      />
      <div className="pt-5">
        {tab === 'reports' && <Reports items={reports.items} />}
        {tab === 'holds' && <Holds items={holds} />}
        {tab === 'domains' && <Domains rules={loaderData.rules} editing={loaderData.editing} />}
      </div>
    </div>
  )
}

function ItemCard({ children }: { children: ReactNode }) {
  return <article className="rounded-card border border-line bg-surface p-4">{children}</article>
}

function ReasonInput({ id }: { id: string }) {
  const t = useT()
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {t('mod.reason')}
      </label>
      <Input
        id={id}
        name="reason"
        size="sm"
        required
        minLength={3}
        maxLength={500}
        placeholder={t('mod.reason')}
        className="min-w-0 flex-1"
      />
    </>
  )
}

function Reports({ items }: { items: Schemas['Report'][] }) {
  const t = useT()
  if (!items.length) return <EmptyState title={t('mod.no_reports')} />
  return (
    <ol className="flex flex-col gap-3">
      {items.map((r) => (
        <li key={r.id}>
          <ReportItem r={r} />
        </li>
      ))}
    </ol>
  )
}

function ReportItem({ r }: { r: Schemas['Report'] }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const hide = useModFetcher()
  const dismiss = useModFetcher()
  const actionData = useActionData<Result>()
  const busy = hide.state !== 'idle' || dismiss.state !== 'idle'
  if ((hide.data?.ok || dismiss.data?.ok) && !busy) return null
  const pageError = actionData?.intent === 'hide-report' ? actionData.error : undefined
  return (
    <ItemCard>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SubjectLink type={r.subject_type} id={r.subject_id} />
        <Badge
          tone={r.reason === 'spam' || r.reason === 'illegal' || r.reason === 'abuse' ? 'danger' : 'neutral'}
        >
          {t(`report.${r.reason}`)}
        </Badge>
        <span className="ml-auto">
          <TimeAgo iso={r.created_at} lang={lang} />
        </span>
      </div>
      {r.note && (
        <p className="mt-2 border-l-2 border-line pl-3 text-[15px] text-ink/90">{tx.text(r.note)}</p>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        {t('mod.reporter')}:
        <Avatar
          name={r.reporter.display_name || r.reporter.username}
          src={r.reporter.avatar_url}
          accent={r.reporter.accent}
          size={16}
        />
        <a href={`/@${r.reporter.username}`} translate="no" className="font-mono hover:underline">
          @{r.reporter.username}
        </a>
      </p>
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
        {r.subject_type !== 'user' && (
          <hide.Form method="post" className="flex min-w-0 flex-1 gap-2">
            <FormFields />
            <input type="hidden" name="report_id" value={r.id} />
            <input type="hidden" name="subject_type" value={r.subject_type} />
            <input type="hidden" name="subject_id" value={r.subject_id} />
            <ReasonInput id={`reason-${r.id}`} />
            <button
              type="submit"
              name="intent"
              value="hide-report"
              className={buttonClass('danger', 'sm')}
              disabled={busy}
            >
              <EyeOff size={14} aria-hidden="true" /> {t('mod.kill')}
            </button>
          </hide.Form>
        )}
        <dismiss.Form
          method="post"
          action="/actions/mod"
          className={cx('flex gap-2', r.subject_type === 'user' && 'flex-1')}
        >
          <FormFields />
          <input type="hidden" name="report_id" value={r.id} />
          {r.subject_type === 'user' && (
            <button
              type="submit"
              name="intent"
              value="actioned"
              className={buttonClass('secondary', 'sm')}
              disabled={busy}
            >
              <Check size={14} aria-hidden="true" /> {t('mod.handled')}
            </button>
          )}
          <button
            type="submit"
            name="intent"
            value="dismiss"
            className={buttonClass('ghost', 'sm')}
            disabled={busy}
          >
            {t('mod.dismiss')}
          </button>
        </dismiss.Form>
      </div>
      {pageError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {t(`error.${pageError}`)}
        </p>
      )}
    </ItemCard>
  )
}

function Holds({ items }: { items: Schemas['Hold'][] }) {
  const t = useT()
  if (!items.length) return <EmptyState title={t('mod.no_holds')} />
  return (
    <ol className="flex flex-col gap-3">
      {items.map((h) => (
        <li key={`${h.subject_type}-${h.subject_id}`}>
          <HoldItem h={h} />
        </li>
      ))}
    </ol>
  )
}

function HoldItem({ h }: { h: Schemas['Hold'] }) {
  const t = useT()
  const { lang } = useLang()
  const release = useModFetcher()
  const hide = useModFetcher()
  const busy = release.state !== 'idle' || hide.state !== 'idle'
  if ((release.data?.ok || hide.data?.ok) && !busy) return null
  const subject = (
    <>
      <FormFields />
      <input type="hidden" name="subject_type" value={h.subject_type} />
      <input type="hidden" name="subject_id" value={h.subject_id} />
    </>
  )
  return (
    <ItemCard>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SubjectLink type={h.subject_type} id={h.subject_id} />
        <span className="ml-auto">
          <TimeAgo iso={h.created_at} lang={lang} />
        </span>
      </div>
      {/* Hold reasons are written by the server for moderators, in English. */}
      <p className="mt-1.5 font-mono text-xs text-muted" translate="no">
        {h.reason}
      </p>
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
        <release.Form method="post" action="/actions/mod">
          {subject}
          <button
            type="submit"
            name="intent"
            value="release"
            className={buttonClass('primary', 'sm')}
            disabled={busy}
          >
            <Check size={14} aria-hidden="true" /> {t('mod.release')}
          </button>
        </release.Form>
        <hide.Form method="post" action="/actions/mod" className="flex min-w-0 flex-1 gap-2">
          {subject}
          <ReasonInput id={`hold-${h.subject_type}-${h.subject_id}`} />
          <button
            type="submit"
            name="intent"
            value="kill"
            className={buttonClass('danger', 'sm')}
            disabled={busy}
          >
            <EyeOff size={14} aria-hidden="true" /> {t('mod.kill')}
          </button>
        </hide.Form>
      </div>
    </ItemCard>
  )
}

function Domains({ rules, editing }: { rules: Schemas['DomainRule'][]; editing: string }) {
  const t = useT()
  const tx = useTx()
  const f = useModFetcher()
  const actionData = useActionData<Result>()
  const result = f.data ?? (actionData?.intent === 'domain-rule' ? actionData : undefined)
  const current = rules.find((r) => r.domain === editing)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok && !editing) formRef.current?.reset()
  }, [f.state, f.data, editing])
  const fieldError = (name: string) =>
    result?.error && result.field === name ? t(`error.${result.error}`) : undefined
  return (
    <div className="flex flex-col gap-6">
      <f.Form
        ref={formRef}
        method="post"
        key={editing}
        className="rounded-card border border-line bg-surface p-4 sm:p-5"
      >
        <FormFields />
        <input type="hidden" name="intent" value="domain-rule" />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label={t('mod.domain')} hint={t('mod.rule_hint')} error={fieldError('domain')}>
            {(p) => (
              <Input
                {...p}
                name="domain"
                required
                maxLength={253}
                defaultValue={editing}
                placeholder="example.com"
                translate="no"
                spellCheck={false}
                autoCapitalize="none"
                className="font-mono"
              />
            )}
          </Field>
          <Field label={t('mod.multiplier')} hint={t('mod.multiplier_hint')} error={fieldError('multiplier')}>
            {(p) => (
              <Input
                {...p}
                name="multiplier"
                type="number"
                inputMode="decimal"
                min={0}
                max={2}
                step={0.1}
                defaultValue={current?.multiplier ?? 1}
                className="font-mono"
              />
            )}
          </Field>
        </div>
        <Field label={t('mod.note')} className="mt-4" error={fieldError('note')}>
          {(p) => <Input {...p} name="note" maxLength={500} defaultValue={current?.note ?? ''} />}
        </Field>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Checkbox name="banned" label={t('mod.ban_domain')} defaultChecked={current?.banned} />
          <div className="flex items-center gap-3">
            {result?.error && !result.field && (
              <span role="alert" className="text-sm text-danger">
                {t(`error.${result.error}`)}
              </span>
            )}
            {editing && (
              <a href="/mod?tab=domains" className={buttonClass('ghost', 'md')}>
                {t('common.cancel')}
              </a>
            )}
            <Button type="submit" disabled={f.state !== 'idle'}>
              {t('mod.save_rule')}
            </Button>
          </div>
        </div>
      </f.Form>

      {rules.length === 0 ? (
        <EmptyState title={t('mod.no_rules')} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t('mod.domain')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  ×
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t('mod.note')}
                </th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">{t('common.edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rules.map((r) => (
                <tr key={r.domain} className={r.domain === editing ? 'bg-lapis-soft/40' : undefined}>
                  <td className="px-4 py-2.5">
                    <span translate="no" className="font-mono text-ink">
                      {r.domain}
                    </span>
                    {r.banned && (
                      <Badge tone="danger" icon={<Ban size={11} aria-hidden="true" />} className="ml-2">
                        {t('mod.banned')}
                      </Badge>
                    )}
                  </td>
                  <td
                    className={cx(
                      'px-4 py-2.5 font-mono',
                      r.multiplier < 1 ? 'text-danger' : r.multiplier > 1 ? 'text-moss' : 'text-muted',
                    )}
                  >
                    {r.multiplier.toFixed(2)}
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-2.5 text-muted">
                    {r.note ? tx.text(r.note) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={`/mod?tab=domains&domain=${encodeURIComponent(r.domain)}`}
                      aria-label={`${t('common.edit')}: ${r.domain}`}
                      className="inline-flex size-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink"
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
