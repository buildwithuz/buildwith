import { Button, buttonClass, Dialog, Menu, Select, Textarea, useToast } from '@buildwith/ui'
import { Ban, Ellipsis, Flag, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import { useT } from '../../lib/i18n'
import { CsrfField, FormFields, useCsrf, useHydrated } from '../forms'

const REASONS = ['spam', 'abuse', 'off_topic', 'illegal', 'other'] as const

/**
 * Mute, block and report for someone else's profile. With JavaScript it is a
 * dropdown menu and a report dialog; without, the same actions are plain forms
 * inside a <details>.
 */
export function UserActions({
  username,
  userId,
  muting,
  blocking,
}: {
  username: string
  userId: number
  muting: boolean
  blocking: boolean
}) {
  const t = useT()
  const hydrated = useHydrated()
  const csrf = useCsrf()
  const toast = useToast()
  const rel = useFetcher<{ muting?: boolean; blocking?: boolean; error?: string }>()
  const [reporting, setReporting] = useState(false)

  useEffect(() => {
    if (rel.state === 'idle' && rel.data?.error) toast(t(`error.${rel.data.error}`), 'error')
  }, [rel.state, rel.data, toast, t])

  let mutingNow = muting
  if (rel.formData) {
    const i = rel.formData.get('intent')
    if (i === 'mute' || i === 'unmute') mutingNow = i === 'mute'
  }
  const send = (intent: string) =>
    rel.submit({ _csrf: csrf, _js: '1', username, intent }, { method: 'post', action: '/actions/relation' })

  const trigger = (
    <button
      type="button"
      aria-label={t('profile.more_actions')}
      className={buttonClass('secondary', 'sm', 'w-8 px-0!')}
    >
      <Ellipsis size={16} aria-hidden="true" />
    </button>
  )

  if (!hydrated) {
    return (
      <details className="relative">
        <summary
          className={buttonClass('secondary', 'sm', 'w-8 cursor-pointer list-none px-0! marker:hidden')}
        >
          <Ellipsis size={16} aria-hidden="true" />
          <span className="sr-only">{t('profile.more_actions')}</span>
        </summary>
        <div className="absolute right-0 z-20 mt-1.5 flex w-64 flex-col gap-1 rounded-card border border-line bg-surface p-2 text-sm">
          <form method="post" action="/actions/relation">
            <CsrfField />
            <input type="hidden" name="username" value={username} />
            <button
              type="submit"
              name="intent"
              value={muting ? 'unmute' : 'mute'}
              className="w-full rounded-control px-2 py-1.5 text-left hover:bg-sunken"
            >
              {t(muting ? 'action.unmute' : 'action.mute')}
            </button>
          </form>
          <form method="post" action="/actions/relation">
            <CsrfField />
            <input type="hidden" name="username" value={username} />
            <button
              type="submit"
              name="intent"
              value={blocking ? 'unblock' : 'block'}
              className="w-full rounded-control px-2 py-1.5 text-left text-danger hover:bg-sunken"
            >
              {t(blocking ? 'action.unblock' : 'action.block')}
            </button>
          </form>
          <form
            method="post"
            action="/actions/report"
            className="mt-1 flex flex-col gap-2 border-t border-line px-2 pt-2"
          >
            <CsrfField />
            <input type="hidden" name="subject_type" value="user" />
            <input type="hidden" name="subject_id" value={userId} />
            <label htmlFor="report-reason-nojs" className="text-xs font-medium text-muted">
              {t('report.title')}
            </label>
            <Select id="report-reason-nojs" name="reason" size="sm">
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`report.${r}`)}
                </option>
              ))}
            </Select>
            <button type="submit" className={buttonClass('secondary', 'sm')}>
              {t('common.report')}
            </button>
          </form>
        </div>
      </details>
    )
  }

  return (
    <>
      <Menu
        trigger={trigger}
        items={[
          {
            label: t(mutingNow ? 'action.unmute' : 'action.mute'),
            icon: mutingNow ? (
              <Volume2 size={15} aria-hidden="true" />
            ) : (
              <VolumeX size={15} aria-hidden="true" />
            ),
            onSelect: () => {
              send(mutingNow ? 'unmute' : 'mute')
              toast(t(mutingNow ? 'profile.unmuted' : 'profile.muted', { username }))
            },
          },
          {
            label: t(blocking ? 'action.unblock' : 'action.block'),
            icon: <Ban size={15} aria-hidden="true" />,
            danger: !blocking,
            onSelect: () => send(blocking ? 'unblock' : 'block'),
          },
          'separator',
          {
            label: t('common.report'),
            icon: <Flag size={15} aria-hidden="true" />,
            onSelect: () => setReporting(true),
          },
        ]}
      />
      <ReportDialog open={reporting} onOpenChange={setReporting} userId={userId} username={username} />
    </>
  )
}

function ReportDialog({
  open,
  onOpenChange,
  userId,
  username,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  userId: number
  username: string
}) {
  const t = useT()
  const toast = useToast()
  const f = useFetcher<{ ok?: boolean; error?: string }>()
  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) {
      onOpenChange(false)
      toast(t('report.sent'))
    }
  }, [f.state, f.data, onOpenChange, toast, t])
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('profile.report_title', { username })}
      closeLabel={t('common.close')}
    >
      <f.Form method="post" action="/actions/report" className="flex flex-col gap-4">
        <FormFields />
        <input type="hidden" name="subject_type" value="user" />
        <input type="hidden" name="subject_id" value={userId} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-ink">{t('profile.report_reason')}</legend>
          {REASONS.map((r, i) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-sm text-ink hover:bg-sunken"
            >
              <input
                type="radio"
                name="reason"
                value={r}
                defaultChecked={i === 0}
                className="size-4 accent-[var(--lapis)]"
              />
              {t(`report.${r}`)}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-note" className="text-sm font-medium text-ink">
            {t('profile.report_note')}{' '}
            <span className="font-normal text-muted">({t('common.optional')})</span>
          </label>
          <Textarea id="report-note" name="note" rows={3} maxLength={500} />
        </div>
        {f.data?.error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${f.data.error}`)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={f.state !== 'idle'}>
            {t('common.report')}
          </Button>
        </div>
      </f.Form>
    </Dialog>
  )
}
