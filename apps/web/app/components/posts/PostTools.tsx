import { Button, cx, Select, Textarea } from '@buildwith/ui'
import { Flag, Info, Trash2 } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useFetcher } from 'react-router'
import { useT } from '../../lib/i18n'
import { FormFields } from '../forms'

const REASONS = ['spam', 'abuse', 'off_topic', 'illegal', 'duplicate', 'other'] as const

/** The small text-button look shared by the tools under a post. */
export const toolClass =
  'inline-flex cursor-pointer list-none items-center gap-1.5 rounded-control px-1.5 py-1 text-xs text-muted ' +
  'transition-colors duration-150 hover:bg-sunken hover:text-ink [&::-webkit-details-marker]:hidden'

/**
 * Delete with a second step. A <details> disclosure is the confirmation, so it
 * needs no JavaScript and no dialog.
 */
export function DeleteButton({
  kind,
  id,
  redirectTo,
}: {
  kind: 'link' | 'note' | 'comment'
  id: number
  redirectTo: string
}) {
  const t = useT()
  return (
    <details className="group relative">
      <summary className={toolClass}>
        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('common.delete')}
      </summary>
      <form
        method="post"
        action="/actions/delete"
        className="absolute left-0 top-full z-20 mt-1 flex w-64 flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
      >
        <FormFields />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <p className="text-sm text-ink">{t('post.delete_confirm')}</p>
        <Button type="submit" variant="danger" size="sm" className="self-start">
          {t('post.delete_yes')}
        </Button>
      </form>
    </details>
  )
}

/** Report to the moderators: a disclosure with a reason and an optional note. */
export function ReportButton({
  subjectType,
  subjectId,
  signedIn,
  loginHref,
}: {
  subjectType: 'link' | 'note' | 'comment'
  subjectId: number
  signedIn: boolean
  loginHref: string
}) {
  const t = useT()
  const f = useFetcher<{ ok?: boolean; error?: string }>()
  const id = useId()
  if (!signedIn) {
    return (
      <a href={loginHref} className={toolClass}>
        <Flag size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('common.report')}
      </a>
    )
  }
  if (f.data?.ok) {
    return (
      <p role="status" className="px-1.5 py-1 text-xs text-muted">
        {t('report.sent')}
      </p>
    )
  }
  return (
    <details className="relative">
      <summary className={toolClass}>
        <Flag size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('common.report')}
      </summary>
      <f.Form
        method="post"
        action="/actions/report"
        className="absolute right-0 top-full z-20 mt-1 flex w-72 max-w-[calc(100vw-32px)] flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
      >
        <FormFields />
        <input type="hidden" name="subject_type" value={subjectType} />
        <input type="hidden" name="subject_id" value={subjectId} />
        <p className="text-sm font-semibold text-ink">{t('report.title')}</p>
        <label htmlFor={`${id}-reason`} className="-mb-2 text-xs text-muted">
          {t('report.reason')}
        </label>
        <Select id={`${id}-reason`} name="reason" size="sm" defaultValue="spam">
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`report.${r}`)}
            </option>
          ))}
        </Select>
        <label htmlFor={`${id}-note`} className="-mb-2 text-xs text-muted">
          {t('report.note')}
        </label>
        <Textarea id={`${id}-note`} name="note" rows={2} maxLength={500} className="min-h-0 text-sm" />
        {f.data?.error && (
          <p role="alert" className="text-xs text-danger">
            {t(`error.${f.data.error}`)}
          </p>
        )}
        <Button type="submit" size="sm" className="self-start" disabled={f.state !== 'idle'}>
          {t('report.send')}
        </Button>
      </f.Form>
    </details>
  )
}

/** A quiet inline notice: moderation state, reply policy, errors from a no-JS post. */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warn' | 'danger'
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2.5 rounded-card border px-3.5 py-3 text-sm',
        tone === 'info' && 'border-line bg-sunken text-ink',
        tone === 'warn' && 'border-transparent bg-saffron-soft text-saffron',
        tone === 'danger' && 'border-line bg-surface text-danger',
        className,
      )}
    >
      <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** A segmented control made of links, so every state has a URL and works without JS. */
export function Segmented({
  label,
  items,
  className,
}: {
  label: string
  items: { href: string; label: ReactNode; active: boolean; icon?: ReactNode }[]
  className?: string
}) {
  return (
    <nav
      aria-label={label}
      className={cx('inline-flex rounded-control border border-line bg-sunken p-0.5', className)}
    >
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          aria-current={it.active ? 'page' : undefined}
          className={cx(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors duration-150',
            it.active
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
              : 'text-muted hover:text-ink',
          )}
        >
          {it.icon}
          {it.label}
        </a>
      ))}
    </nav>
  )
}
