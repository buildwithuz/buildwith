import type { Comment } from '@buildwith/api-client'
import { Button, cx, Textarea } from '@buildwith/ui'
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { Html, useLang, useT } from '../lib/i18n'
import { FormFields } from './forms'
import { TimeAgo } from './UserLine'
import { VoteButton } from './VoteButton'

/** Comment or answer form. Posts to the page's own action. */
export function CommentForm({
  subjectType,
  subjectId,
  parentId,
  placeholder,
  onDone,
  autoFocus,
}: {
  subjectType: 'link' | 'article'
  subjectId: number
  parentId?: number
  placeholder: string
  onDone?: () => void
  autoFocus?: boolean
}) {
  const t = useT()
  const f = useFetcher<{ ok?: boolean; error?: string }>()
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) {
      ref.current?.reset()
      onDone?.()
    }
  }, [f.state, f.data, onDone])
  return (
    <f.Form ref={ref} method="post" action="/actions/comment" className="flex flex-col gap-2">
      <FormFields />
      <input type="hidden" name="subject_type" value={subjectType} />
      <input type="hidden" name="subject_id" value={subjectId} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <Textarea name="body_md" required placeholder={placeholder} aria-label={placeholder} rows={parentId ? 3 : 4} autoFocus={autoFocus} />
      {f.data?.error && (
        <p role="alert" className="text-sm text-danger">
          {t(`error.${f.data.error}`)}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{t('compose.markdown_hint')}</span>
        <div className="flex gap-2">
          {onDone && parentId && (
            <Button variant="ghost" size="sm" onClick={onDone}>
              {t('common.cancel')}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={f.state !== 'idle'}>
            {t(parentId ? 'common.reply' : 'common.post')}
          </Button>
        </div>
      </div>
    </f.Form>
  )
}

/**
 * A thread: comments arrive in order with a depth, so it renders as a flat list
 * indented by depth. Each comment can be folded with <details>, which works
 * without JavaScript.
 */
export function CommentThread({
  items,
  subjectType,
  subjectId,
  signedIn,
  canDownvote,
}: {
  items: Comment[]
  subjectType: 'link' | 'article'
  subjectId: number
  signedIn: boolean
  canDownvote: boolean
}) {
  return (
    <ol className="flex flex-col">
      {items.map((c) => (
        <li key={c.id} style={{ paddingLeft: `${Math.min(c.depth, 8) * 18}px` }}>
          <CommentItem
            c={c}
            subjectType={subjectType}
            subjectId={subjectId}
            signedIn={signedIn}
            canDownvote={canDownvote}
          />
        </li>
      ))}
    </ol>
  )
}

function CommentItem({
  c,
  subjectType,
  subjectId,
  signedIn,
  canDownvote,
}: {
  c: Comment
  subjectType: 'link' | 'article'
  subjectId: number
  signedIn: boolean
  canDownvote: boolean
}) {
  const t = useT()
  const { lang } = useLang()
  const [replying, setReplying] = useState(false)
  const gone = c.deleted || (c.killed && !c.body_html) || (c.collapsed && !c.body_html)
  const label = c.deleted ? t('common.deleted') : c.killed ? t('common.removed') : t('common.hidden')
  return (
    <details open={!c.collapsed} id={`c${c.id}`} className={cx('group border-l border-line py-2 pl-3', c.depth > 0 && 'mt-0')}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted marker:hidden">
        {!gone && (
          <a href={`/@${c.author.username}`} translate="no" className="font-mono font-medium text-ink hover:underline">
            @{c.author.username}
          </a>
        )}
        <a href={`#c${c.id}`} className="hover:underline">
          <TimeAgo iso={c.created_at} lang={lang} />
        </a>
        {c.edited_at && <span>· {t('common.edited')}</span>}
        <span className="hidden font-mono group-[:not([open])]:inline">[+]</span>
      </summary>
      {gone ? (
        <p className="py-1 text-sm italic text-muted">{label}</p>
      ) : (
        <div className="flex gap-2 pt-1">
          <VoteButton
            subject="comment"
            id={c.id}
            points={c.points}
            vote={c.viewer_vote}
            canDown={canDownvote}
            signedIn={signedIn}
            disabled={c.can_edit}
          />
          <div className="min-w-0 flex-1">
            <Html html={c.body_html} className="prose-bw text-[15px] text-ink" />
            {signedIn && !c.killed && (
              <div className="mt-1 flex gap-3 text-xs">
                <button type="button" onClick={() => setReplying((v) => !v)} className="text-muted hover:text-ink">
                  {t('common.reply')}
                </button>
              </div>
            )}
            {replying && (
              <div className="mt-2">
                <CommentForm
                  subjectType={subjectType}
                  subjectId={subjectId}
                  parentId={c.id}
                  placeholder={t('compose.reply_placeholder')}
                  onDone={() => setReplying(false)}
                  autoFocus
                />
              </div>
            )}
          </div>
        </div>
      )}
    </details>
  )
}
