import { cx } from '@buildwith/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { useT } from '../lib/i18n'
import { FormFields } from './forms'

const PILL =
  'flex w-10 shrink-0 flex-col items-center gap-0 self-start rounded-control border border-line bg-surface py-1 transition-colors duration-150'

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
  // Hooks first, every render: React requires the same hook order whatever the branch.
  const f = useFetcher<{ points: number; viewer_vote: -1 | 0 | 1 }>()
  const [bump, setBump] = useState(0)
  const shell = layout === 'column' ? PILL : 'flex items-center gap-1'
  if (!signedIn) {
    return (
      <a
        href="/login"
        aria-label={t('action.upvote')}
        className={cx(shell, 'text-muted hover:border-lapis hover:text-lapis')}
      >
        <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
        <span className="font-mono text-xs tabular-nums text-ink">{points}</span>
      </a>
    )
  }
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
        onClick={() => !active && setBump((b) => b + 1)}
        aria-label={t(active ? 'action.unvote' : value === 1 ? 'action.upvote' : 'action.downvote')}
        className={cx(
          'rounded-control p-0.5 transition-colors duration-150 disabled:cursor-default disabled:opacity-40',
          active ? (value === 1 ? 'text-lapis' : 'text-danger') : 'text-muted hover:text-lapis',
        )}
      >
        <Icon
          key={active ? bump : -1}
          size={16}
          strokeWidth={active ? 2.75 : 2}
          aria-hidden="true"
          className={active && bump ? 'anim-bump' : ''}
        />
      </button>
    )
  }
  return (
    <f.Form
      method="post"
      action="/actions/vote"
      className={cx(shell, layout === 'column' && shownVote === 1 && 'border-lapis/40 bg-lapis-soft')}
    >
      <FormFields />
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="id" value={id} />
      {btn(1)}
      <span
        className={cx(
          'font-mono text-xs tabular-nums',
          shownVote === 1 ? 'font-semibold text-lapis' : 'text-ink',
        )}
        aria-live="polite"
      >
        {shownPoints}
      </span>
      {canDown && btn(-1)}
    </f.Form>
  )
}
