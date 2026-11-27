import { ChevronDown, ChevronUp } from 'lucide-react'
import { useFetcher } from 'react-router'
import { cx } from '@buildwith/ui'
import { useT } from '../lib/i18n'
import { FormFields } from './forms'

/**
 * Upvote (and, for comments, downvote) with an optimistic count. A plain form
 * without JavaScript; a fetcher with it.
 */
export function VoteButton({
  subject,
  id,
  points,
  vote,
  canDown = false,
  disabled = false,
  signedIn = true,
  layout = 'column',
}: {
  subject: 'link' | 'article' | 'comment'
  id: number
  points: number
  vote: -1 | 0 | 1
  canDown?: boolean
  disabled?: boolean
  /** Signed-out readers get a link to sign in instead of a form. */
  signedIn?: boolean
  layout?: 'column' | 'row'
}) {
  const t = useT()
  if (!signedIn) {
    return (
      <div className={cx('flex items-center', layout === 'column' ? 'w-8 flex-col' : 'gap-1')}>
        <a href="/login" aria-label={t('action.upvote')} className="rounded-control p-0.5 text-muted hover:text-ink">
          <ChevronUp size={18} strokeWidth={1.75} />
        </a>
        <span className="font-mono text-xs tabular-nums text-ink">{points}</span>
      </div>
    )
  }
  const f = useFetcher<{ points: number; viewer_vote: -1 | 0 | 1 }>()
  let shownVote = vote
  let shownPoints = points
  if (f.formData) {
    const next = Number(f.formData.get('value')) as -1 | 0 | 1
    shownPoints = points - vote + next
    shownVote = next
  } else if (f.data && 'points' in f.data) {
    shownPoints = f.data.points
    shownVote = f.data.viewer_vote
  }
  const btn = (value: -1 | 1) => {
    const active = shownVote === value
    const Icon = value === 1 ? ChevronUp : ChevronDown
    return (
      <button
        type="submit"
        name="value"
        value={active ? 0 : value}
        disabled={disabled}
        aria-pressed={active}
        aria-label={t(active ? 'action.unvote' : value === 1 ? 'action.upvote' : 'action.downvote')}
        className={cx(
          'rounded-control p-0.5 transition-colors duration-150 disabled:opacity-40',
          active ? (value === 1 ? 'text-lapis' : 'text-danger') : 'text-muted hover:text-ink',
        )}
      >
        <Icon size={18} strokeWidth={active ? 2.5 : 1.75} />
      </button>
    )
  }
  return (
    <f.Form
      method="post"
      action="/actions/vote"
      className={cx('flex items-center', layout === 'column' ? 'w-8 flex-col' : 'gap-1')}
    >
      <FormFields />
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="id" value={id} />
      {btn(1)}
      <span className="font-mono text-xs tabular-nums text-ink" aria-live="polite">
        {shownPoints}
      </span>
      {canDown && btn(-1)}
    </f.Form>
  )
}
