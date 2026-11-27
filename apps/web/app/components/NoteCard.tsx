import type { Note } from '@buildwith/api-client'
import { cx } from '@buildwith/ui'
import { Bookmark, Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react'
import { useFetcher } from 'react-router'
import { Html, useLang, useT, useTx } from '../lib/i18n'
import { FormFields } from './forms'
import { TimeAgo, UserAvatar, UserName } from './UserLine'

type NoteState = { like_count: number; repost_count: number; liked: boolean; reposted: boolean; bookmarked: boolean }

/**
 * A note: avatar, name, @username, age; body; media; one action row with mono
 * counts. Reposts show the original with a "reposted by" line.
 */
export function NoteCard({
  note,
  signedIn,
  compact = false,
  focused = false,
}: {
  note: Note
  signedIn: boolean
  compact?: boolean
  focused?: boolean
}) {
  const t = useT()
  const tx = useTx()
  if (note.repost_of) {
    return (
      <div>
        <p className="flex items-center gap-1.5 pl-12 pt-2 text-xs text-muted">
          <Repeat2 size={13} aria-hidden="true" />
          <a href={`/@${note.author.username}`} className="hover:underline">
            {t('action.reposted_by', { name: tx.text(note.author.display_name || note.author.username) })}
          </a>
        </p>
        <NoteCard note={note.repost_of} signedIn={signedIn} compact={compact} />
      </div>
    )
  }
  return (
    <article className={cx('flex gap-3 py-3', focused && 'text-lg')} aria-labelledby={`note-${note.id}-by`}>
      <UserAvatar user={note.author} size={compact ? 32 : 40} />
      <div className="min-w-0 flex-1">
        <div id={`note-${note.id}-by`}>
          <UserName user={note.author} at={note.created_at} href={note.path} />
        </div>
        {note.killed ? (
          <p className="mt-1 text-sm italic text-muted">{t('common.removed')}</p>
        ) : (
          <NoteBody note={note} />
        )}
        {!compact && <NoteActions note={note} signedIn={signedIn} />}
      </div>
    </article>
  )
}

export function NoteBody({ note }: { note: Note }) {
  const { lang } = useLang()
  const t = useT()
  return (
    <>
      {note.body_html && (
        <Html html={note.body_html} className="prose-bw mt-1 text-[15px] text-ink" />
      )}
      {note.edited_at && <span className="text-xs text-muted">{t('common.edited')}</span>}
      {note.code && (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: highlighted and escaped on the server
        <div className="prose-bw mt-2" translate="no" dangerouslySetInnerHTML={{ __html: note.code.html }} />
      )}
      {note.media.length > 0 && (
        <div className={cx('mt-2 grid gap-1 overflow-hidden rounded-card', note.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {note.media.map((m) => (
            <a key={m.media.id} href={m.media.url} className="block">
              <img
                src={m.media.url}
                alt={m.alt}
                width={m.media.width}
                height={m.media.height}
                loading="lazy"
                className="h-full max-h-96 w-full bg-sunken object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {note.preview && (
        <a
          href={note.preview.url}
          rel="ugc noopener"
          className="mt-2 flex overflow-hidden rounded-card border border-line bg-surface hover:bg-sunken"
        >
          {note.preview.image && (
            <img src={note.preview.image.url} alt="" loading="lazy" className="h-24 w-24 shrink-0 object-cover" />
          )}
          <span className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
            <span translate="no" className="font-mono text-xs text-muted">
              {note.preview.domain}
            </span>
            {note.preview.title && <span className="truncate text-sm font-medium text-ink">{note.preview.title}</span>}
            {note.preview.description && (
              <span className="line-clamp-2 text-xs text-muted">{note.preview.description}</span>
            )}
          </span>
        </a>
      )}
      {note.quote_of && (
        <a href={note.quote_of.path} className="mt-2 block rounded-card border border-line p-3 hover:bg-sunken">
          <UserName user={note.quote_of.author} />
          <Html html={note.quote_of.body_html} className="prose-bw mt-1 line-clamp-4 text-sm" />
          <TimeAgo iso={note.quote_of.created_at} lang={lang} />
        </a>
      )}
    </>
  )
}

function NoteActions({ note, signedIn }: { note: Note; signedIn: boolean }) {
  const t = useT()
  const f = useFetcher<NoteState>()
  let s: NoteState = {
    like_count: note.like_count,
    repost_count: note.repost_count,
    liked: Boolean(note.liked),
    reposted: Boolean(note.reposted),
    bookmarked: Boolean(note.bookmarked),
  }
  if (f.data && 'like_count' in f.data) s = f.data
  const pending = f.formData?.get('intent')
  if (pending === 'like') s = { ...s, liked: true, like_count: s.like_count + (s.liked ? 0 : 1) }
  if (pending === 'unlike') s = { ...s, liked: false, like_count: Math.max(0, s.like_count - (s.liked ? 1 : 0)) }
  if (pending === 'repost') s = { ...s, reposted: true, repost_count: s.repost_count + (s.reposted ? 0 : 1) }
  if (pending === 'unrepost') s = { ...s, reposted: false, repost_count: Math.max(0, s.repost_count - (s.reposted ? 1 : 0)) }
  if (pending === 'bookmark') s = { ...s, bookmarked: true }
  if (pending === 'unbookmark') s = { ...s, bookmarked: false }

  const item = 'inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 font-mono text-xs transition-colors duration-150'
  if (!signedIn) {
    return (
      <div className="mt-1.5 flex items-center gap-4 text-muted">
        <a href={note.path} className={cx(item, 'hover:text-ink')} aria-label={t('common.reply')}>
          <MessageCircle size={16} strokeWidth={1.75} /> {note.reply_count}
        </a>
        <a href="/login" className={cx(item, 'hover:text-ink')} aria-label={t('action.repost')}>
          <Repeat2 size={16} strokeWidth={1.75} /> {note.repost_count}
        </a>
        <a href="/login" className={cx(item, 'hover:text-ink')} aria-label={t('action.like')}>
          <Heart size={16} strokeWidth={1.75} /> {note.like_count}
        </a>
      </div>
    )
  }
  const btn = (intent: string, label: string, active: boolean, activeClass: string, icon: React.ReactNode, count?: number) => (
    <button
      type="submit"
      name="intent"
      value={intent}
      aria-label={label}
      aria-pressed={active}
      className={cx(item, active ? activeClass : 'text-muted hover:text-ink')}
    >
      {icon}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </button>
  )
  return (
    <f.Form method="post" action="/actions/note" className="mt-1.5 flex items-center gap-4">
      <FormFields />
      <input type="hidden" name="id" value={note.id} />
      <a href={note.path} className={cx(item, 'text-muted hover:text-ink')} aria-label={t('common.reply')}>
        <MessageCircle size={16} strokeWidth={1.75} /> <span className="tabular-nums">{note.reply_count}</span>
      </a>
      {btn(s.reposted ? 'unrepost' : 'repost', t(s.reposted ? 'action.unrepost' : 'action.repost'), s.reposted, 'text-turquoise',
        <Repeat2 size={16} strokeWidth={1.75} />, s.repost_count)}
      {btn(s.liked ? 'unlike' : 'like', t(s.liked ? 'action.unlike' : 'action.like'), s.liked, 'text-danger',
        <Heart size={16} strokeWidth={1.75} fill={s.liked ? 'currentColor' : 'none'} />, s.like_count)}
      <a href={`/notes?quote=${note.id}`} className={cx(item, 'text-muted hover:text-ink')} aria-label={t('action.quote')}>
        <Quote size={15} strokeWidth={1.75} />
      </a>
      {btn(s.bookmarked ? 'unbookmark' : 'bookmark', t(s.bookmarked ? 'action.unbookmark' : 'action.bookmark'), s.bookmarked,
        'text-lapis', <Bookmark size={16} strokeWidth={1.75} fill={s.bookmarked ? 'currentColor' : 'none'} />)}
    </f.Form>
  )
}
