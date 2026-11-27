import { Button, Dialog, Textarea, useToast } from '@buildwith/ui'
import { useEffect, useId } from 'react'
import { useFetcher } from 'react-router'
import { useT } from '../lib/i18n'
import { FormFields } from './forms'

const REASONS = ['spam', 'abuse', 'off_topic', 'illegal', 'duplicate', 'other'] as const

/** Report anything to the moderators. Opened from a "…" menu. */
export function ReportDialog({
  open,
  onOpenChange,
  subjectType,
  subjectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectType: 'link' | 'article' | 'comment' | 'note' | 'user'
  subjectId: number
}) {
  const t = useT()
  const toast = useToast()
  const f = useFetcher<{ ok?: boolean; error?: string }>()
  const id = useId()
  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) {
      onOpenChange(false)
      toast(t('report.sent'))
    }
  }, [f.state, f.data, onOpenChange, toast, t])
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('report.title')} closeLabel={t('common.close')}>
      <f.Form method="post" action="/actions/report" className="flex flex-col gap-4">
        <FormFields />
        <input type="hidden" name="subject_type" value={subjectType} />
        <input type="hidden" name="subject_id" value={subjectId} />
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">{t('report.title')}</legend>
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
                className="accent-[var(--lapis)]"
              />
              {t(`report.${r}`)}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${id}-note`} className="sr-only">
          {t('compose.details')}
        </label>
        <Textarea
          id={`${id}-note`}
          name="note"
          rows={3}
          maxLength={1000}
          placeholder={t('compose.details')}
        />
        {f.data?.error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${f.data.error}`)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={f.state !== 'idle'}>
            {t('common.report')}
          </Button>
        </div>
      </f.Form>
    </Dialog>
  )
}
