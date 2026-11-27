import type { Comment } from '@buildwith/api-client'
import { Button, buttonClass, cx } from '@buildwith/ui'
import { useEffect, useState } from 'react'
import { useFetcher, useLocation, useNavigate, useRevalidator, useSearchParams } from 'react-router'
import { Html, useLang, useT } from '../lib/i18n'
import { MarkdownEditor } from './editor/MarkdownEditor'
import { FormFields } from './forms'
import { DeleteButton } from './posts/PostTools'
import { TimeAgo } from './UserLine'
import { VoteButton } from './VoteButton'

/** Comment or answer form. Posts to /actions/comment; the editor is a plain textarea without JS. */
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
  const [generation, setGeneration] = useState(0)
  const [params] = useSearchParams()
  const noJsError = !parentId ? params.get('error') : null
  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) {
      setGeneration((g) => g + 1) // a fresh, empty editor
      onDone?.()
    }
  }, [f.state, f.data, onDone])
  const error = f.data?.error ?? noJsError
  return (
    <f.Form
      method="post"
      action="/actions/comment"
      id={parentId ? undefined : 'comment-form'}
      className="flex flex-col gap-2"
    >
      <FormFields />
      <input type="hidden" name="subject_type" value={subjectType} />
      <input type="hidden" name="subject_id" value={subjectId} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <MarkdownEditor
        key={generation}
        profile="comment"
        label={placeholder}
        placeholder={placeholder}
        minRows={parentId ? 3 : 4}
        maxLength={10000}
        required
        autoFocus={autoFocus}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(`error.${error}`)}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {onDone && parentId && (
          <Button variant="ghost" size="sm" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={f.state !== 'idle'}>
          {t(parentId ? 'common.reply' : 'common.post')}
        </Button>
      </div>
    </f.Form>
  )
}

/** Edit your own comment in place (the API allows it for an hour). */
function CommentEdit({ c, cancelHref }: { c: Comment; cancelHref: string }) {
  const t = useT()
  const f = useFetcher<{ ok?: boolean; error?: string }>()
  const revalidator = useRevalidator()
  const navigate = useNavigate()
  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) {
      navigate(cancelHref, { replace: true, preventScrollReset: true })
      revalidator.revalidate()
    }
  }, [f.state, f.data, navigate, cancelHref, revalidator])
  return (
    <f.Form method="post" action="/actions/comment" className="flex flex-col gap-2 pt-1">
      <FormFields />
      <input type="hidden" name="intent" value="edit" />
      <input type="hidden" name="id" value={c.id} />
      <MarkdownEditor
        profile="comment"
        label={t('common.edit')}
        defaultValue={c.body_md ?? ''}
        minRows={3}
        maxLength={10000}
        required
        autoFocus
      />
      {f.data?.error && (
        <p role="alert" className="text-sm text-danger">
          {t(`error.${f.data.error}`)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <a href={cancelHref} className={buttonClass('ghost', 'sm')}>
          {t('common.cancel')}
        </a>
        <Button type="submit" size="sm" disabled={f.state !== 'idle'}>
          {t('common.save')}
        </Button>
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
  const location = useLocation()
  const [params] = useSearchParams()
  const editing = params.get('editc') === String(c.id)
  const withoutEdit = new URLSearchParams(params)
  withoutEdit.delete('editc')
  const here = `${location.pathname}${withoutEdit.size ? `?${withoutEdit}` : ''}`
  const editHref = `${location.pathname}?${new URLSearchParams([...withoutEdit, ['editc', String(c.id)]])}#c${c.id}`
  // The API allows edits for an hour; checked again on the server.
  const editable = Boolean(c.can_edit) && Date.parse(c.created_at) > Date.now() - 55 * 60 * 1000
  const gone = c.deleted || (c.killed && !c.body_html) || (c.collapsed && !c.body_html)
  const label = c.deleted ? t('common.deleted') : c.killed ? t('common.removed') : t('common.hidden')
  return (
    <details
      open={!c.collapsed}
      id={`c${c.id}`}
      className={cx('group border-l border-line py-2 pl-3', c.depth > 0 && 'mt-0')}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted marker:hidden">
        {!gone && (
          <a
            href={`/@${c.author.username}`}
            translate="no"
            className="font-mono font-medium text-ink hover:underline"
          >
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
            {editing && c.can_edit ? (
              <CommentEdit c={c} cancelHref={`${here}#c${c.id}`} />
            ) : (
              <Html html={c.body_html} className="prose-bw text-[15px] text-ink" />
            )}
            {signedIn && !c.killed && !editing && (
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setReplying((v) => !v)}
                  className="text-muted hover:text-ink"
                >
                  {t('common.reply')}
                </button>
                {editable && (
                  <a href={editHref} className="text-muted hover:text-ink">
                    {t('common.edit')}
                  </a>
                )}
                {c.can_edit && <DeleteButton kind="comment" id={c.id} redirectTo={here} />}
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
