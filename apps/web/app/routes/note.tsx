import { buttonClass, cx } from '@buildwith/ui'
import { ArrowLeft, History } from 'lucide-react'
import { data, redirect } from 'react-router'
import { Composer } from '../components/Composer'
import { useHydrated } from '../components/forms'
import { NoteCard } from '../components/NoteCard'
import { DeleteButton, Notice, ReportButton, toolClass } from '../components/posts/PostTools'
import { api, orThrow } from '../lib/api.server'
import { usernameFrom } from '../lib/handle'
import { useMe } from '../lib/hooks'
import { useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import { formatDate } from '../lib/time'
import type { Route } from './+types/note'

export async function loader({ params, context }: Route.LoaderArgs) {
  const username = usernameFrom(params.handle)
  const id = Number(params.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw data(null, { status: 404 })
  const client = api(context)
  const thread = orThrow(
    await client.GET('/notes/{id}/thread', { params: { path: { id }, query: { limit: 100 } } }),
  )
  // Compare params, not request.url: data requests carry a .data suffix.
  if (thread.note.author.username !== username) {
    throw redirect(thread.note.path, 301)
  }
  const edits = thread.note.edited_at
    ? await client.GET('/notes/{id}/edits', { params: { path: { id } } })
    : null
  return { ...thread, edits: edits?.data?.items ?? [] }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return pageMeta(matches, { titleKey: 'error.not_found_title', noindex: true })
  const n = loaderData.note
  const name = n.author.display_name || n.author.username
  const text = (n.body_md ?? '').replace(/\s+/g, ' ').trim()
  return pageMeta(matches, {
    title: `${name}: “${text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text || '…'}”`,
    description: text.slice(0, 200) || undefined,
    image: n.media[0]?.media.url,
    noindex: n.killed,
  })
}

export default function NoteThread({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const me = useMe()
  const { note, ancestors, replies, edits } = loaderData
  const signedIn = Boolean(me)
  const hydrated = useHydrated()
  const name = tx.text(note.author.display_name || note.author.username)

  return (
    <div className="mx-auto max-w-[640px]">
      <a
        href="/notes"
        className="-ml-1.5 mb-1 inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        {t('nav.notes')}
      </a>
      <h1 className="sr-only">{t('notes.note_by', { name })}</h1>

      {ancestors.length > 0 && (
        <ol aria-label={t('notes.in_thread')} className="pl-1">
          {ancestors.map((a) => (
            <li key={a.id} className="relative">
              {/* The thread line: from under this avatar down into the next one. */}
              <span aria-hidden="true" className="absolute -bottom-3 left-[15.5px] top-[48px] w-px bg-line" />
              <NoteCard note={a} signedIn={signedIn} compact />
            </li>
          ))}
        </ol>
      )}

      <article aria-label={t('notes.note_by', { name })} className="border-b border-line pb-2">
        <div className="[&_.prose-bw]:text-[17px] [&_.prose-bw]:leading-relaxed">
          <NoteCard note={note} signedIn={signedIn} focused />
        </div>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pl-[52px] text-xs text-muted">
          <time dateTime={note.created_at} className="mr-1 font-mono">
            {formatDate(note.created_at, lang, true)}
          </time>
          {edits.length > 0 && (
            <details className="group w-full order-last">
              <summary className={toolClass}>
                <History size={14} strokeWidth={1.75} aria-hidden="true" />
                {t('post.edit_history')} <span className="font-mono">({edits.length})</span>
              </summary>
              <ol className="mt-2 flex flex-col gap-2 border-l border-line pl-3">
                {edits.map((e) => (
                  <li key={e.created_at}>
                    <p className="font-mono text-[11px] text-muted">{formatDate(e.created_at, lang, true)}</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{e.body_md}</p>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {/* With JavaScript the note's own menu has Delete and Report; these forms are the no-JS path. */}
          <span
            className={cx('ml-auto flex items-center gap-0.5', hydrated && 'invisible')}
            aria-hidden={hydrated || undefined}
          >
            {note.can_edit ? (
              <DeleteButton kind="note" id={note.id} redirectTo="/notes" />
            ) : (
              <ReportButton
                subjectType="note"
                subjectId={note.id}
                signedIn={signedIn}
                loginHref={`/login?next=${encodeURIComponent(note.path)}`}
              />
            )}
          </span>
        </div>
      </article>

      <div id="reply" className="scroll-mt-20 border-b border-line">
        {!me ? (
          <div className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-muted">{t('notes.login_to_reply')}</p>
            <a
              href={`/login?next=${encodeURIComponent(note.path)}`}
              className={buttonClass('primary', 'sm', 'shrink-0')}
            >
              {t('nav.login')}
            </a>
          </div>
        ) : note.can_reply && !note.killed ? (
          <Composer me={me} replyTo={note.id} placeholder={t('notes.reply_placeholder')} />
        ) : (
          <Notice className="my-4">
            {t(
              note.reply_policy === 'following'
                ? 'notes.policy_following'
                : note.reply_policy === 'mentioned'
                  ? 'notes.policy_mentioned'
                  : 'notes.policy_blocked',
            )}
          </Notice>
        )}
      </div>

      <section aria-labelledby="replies-title" className="mt-6">
        <h2 id="replies-title" className="text-base font-semibold text-ink">
          {t('notes.replies_title')}{' '}
          <span className="font-mono text-sm font-normal text-muted">({replies.length})</span>
        </h2>
        {replies.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{t('notes.no_replies')}</p>
        ) : (
          <ol className="divide-y divide-line">
            {replies.map((r) => (
              <li key={r.id}>
                <NoteCard note={r} signedIn={signedIn} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
