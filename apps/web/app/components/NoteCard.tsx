import type { Note } from '@buildwith/api-client'
import { cx, Menu, useToast } from '@buildwith/ui'
import {
  ArrowUpRight,
  Bookmark,
  Flag,
  Heart,
  Link as LinkIcon,
  MessageCircle,
  MoreHorizontal,
  Quote,
  Repeat2,
  Share,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { Html, useLang, useT, useTx } from '../lib/i18n'
import { FormFields, useCsrf, useHydrated } from './forms'
import { ReportDialog } from './ReportDialog'
import { TimeAgo, UserAvatar, UserName } from './UserLine'

type NoteState = {
  like_count: number
  repost_count: number
  liked: boolean
  reposted: boolean
  bookmarked: boolean
}

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
          <NoteBody note={note} compact={compact} />
        )}
        {!compact && <NoteActions note={note} signedIn={signedIn} />}
      </div>
    </article>
  )
}

export function NoteBody({ note, compact = false }: { note: Note; compact?: boolean }) {
  const { lang } = useLang()
  const t = useT()
  return (
    <>
      {note.body_html && (
        <Html
          html={note.body_html}
          className={cx('prose-bw mt-1 text-ink', compact ? 'line-clamp-4 text-sm' : 'text-[15px]')}
        />
      )}
      {note.edited_at && <span className="text-xs text-muted">{t('common.edited')}</span>}
      {note.code && !compact && (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: highlighted and escaped on the server
        <div className="prose-bw mt-2" translate="no" dangerouslySetInnerHTML={{ __html: note.code.html }} />
      )}
      {note.media.length > 0 && !compact && (
        <div
          data-lightbox
          className={cx(
            'mt-2 grid gap-1 overflow-hidden rounded-card',
            note.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
          )}
        >
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
      {note.preview && !compact && (
        <a
          href={note.preview.url}
          rel="ugc noopener"
          className="mt-2 flex overflow-hidden rounded-card border border-line bg-surface hover:bg-sunken"
        >
          {note.preview.image && (
            <img
              src={note.preview.image.url}
              alt=""
              loading="lazy"
              className="h-24 w-24 shrink-0 object-cover"
            />
          )}
          <span className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
            <span translate="no" className="font-mono text-xs text-muted">
              {note.preview.domain}
            </span>
            {note.preview.title && (
              <span className="truncate text-sm font-medium text-ink">{note.preview.title}</span>
            )}
            {note.preview.description && (
              <span className="line-clamp-2 text-xs text-muted">{note.preview.description}</span>
            )}
          </span>
        </a>
      )}
      {note.quote_of && (
        <div className="relative mt-2 rounded-card border border-line p-3 transition-colors duration-150 hover:bg-sunken">
          {/* The whole card opens the quoted note; links inside sit above this layer. */}
          <a href={note.quote_of.path} className="absolute inset-0 rounded-card">
            <span className="sr-only">{t('action.quote')}</span>
          </a>
          <div className="pointer-events-none relative [&_a]:pointer-events-auto">
            <UserName user={note.quote_of.author} />
            <Html html={note.quote_of.body_html} className="prose-bw mt-1 line-clamp-4 text-sm" />
            <TimeAgo iso={note.quote_of.created_at} lang={lang} />
          </div>
        </div>
      )}
    </>
  )
}

function NoteActions({ note, signedIn }: { note: Note; signedIn: boolean }) {
  const t = useT()
  const toast = useToast()
  const hydrated = useHydrated()
  const csrf = useCsrf()
  const f = useFetcher<NoteState>()
  const del = useFetcher()
  const [pop, setPop] = useState<{ like: number; repost: number }>({ like: 0, repost: 0 })
  const [reporting, setReporting] = useState(false)

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
  if (pending === 'unlike')
    s = { ...s, liked: false, like_count: Math.max(0, s.like_count - (s.liked ? 1 : 0)) }
  if (pending === 'repost') s = { ...s, reposted: true, repost_count: s.repost_count + (s.reposted ? 0 : 1) }
  if (pending === 'unrepost')
    s = { ...s, reposted: false, repost_count: Math.max(0, s.repost_count - (s.reposted ? 1 : 0)) }
  if (pending === 'bookmark') s = { ...s, bookmarked: true }
  if (pending === 'unbookmark') s = { ...s, bookmarked: false }

  const url = () =>
    typeof window === 'undefined' ? note.path : new URL(note.path, window.location.origin).toString()
  async function share() {
    const href = url()
    if (navigator.share) {
      await navigator.share({ url: href }).catch(() => {})
      return
    }
    await navigator.clipboard?.writeText(href)
    toast(t('common.copied'))
  }

  // One 34 px target per action; the tint on hover says what it will do.
  const target =
    'group/a inline-flex items-center gap-1 font-mono text-xs tabular-nums transition-colors duration-150'
  const disc = 'relative grid size-8 place-items-center rounded-full transition-colors duration-150'

  if (!signedIn) {
    return (
      <div className="-ml-2 mt-1 flex items-center gap-5 text-muted">
        <a href={note.path} className={cx(target, 'hover:text-lapis')} aria-label={t('common.reply')}>
          <span className={cx(disc, 'group-hover/a:bg-lapis-soft')}>
            <MessageCircle size={17} strokeWidth={1.75} />
          </span>
          <Count n={note.reply_count} />
        </a>
        <a href="/login" className={cx(target, 'hover:text-turquoise')} aria-label={t('action.repost')}>
          <span className={cx(disc, 'group-hover/a:bg-sunken')}>
            <Repeat2 size={17} strokeWidth={1.75} />
          </span>
          <Count n={note.repost_count} />
        </a>
        <a href="/login" className={cx(target, 'hover:text-danger')} aria-label={t('action.like')}>
          <span className={cx(disc, 'group-hover/a:bg-sunken')}>
            <Heart size={17} strokeWidth={1.75} />
          </span>
          <Count n={note.like_count} />
        </a>
      </div>
    )
  }

  return (
    <div className="-ml-2 mt-1 flex items-center gap-5">
      <a
        href={note.path}
        className={cx(target, 'text-muted hover:text-lapis')}
        aria-label={t('common.reply')}
      >
        <span className={cx(disc, 'group-hover/a:bg-lapis-soft')}>
          <MessageCircle size={17} strokeWidth={1.75} />
        </span>
        <Count n={note.reply_count} />
      </a>
      <f.Form method="post" action="/actions/note" className="contents">
        <FormFields />
        <input type="hidden" name="id" value={note.id} />
        <button
          type="submit"
          name="intent"
          value={s.reposted ? 'unrepost' : 'repost'}
          onClick={() => !s.reposted && setPop((p) => ({ ...p, repost: p.repost + 1 }))}
          aria-label={t(s.reposted ? 'action.unrepost' : 'action.repost')}
          aria-pressed={s.reposted}
          title={t(s.reposted ? 'action.unrepost' : 'action.repost')}
          className={cx(target, s.reposted ? 'text-turquoise' : 'text-muted hover:text-turquoise')}
        >
          <span className={cx(disc, 'group-hover/a:bg-sunken')}>
            <Repeat2
              key={pop.repost}
              size={17}
              strokeWidth={s.reposted ? 2.25 : 1.75}
              className={pop.repost ? 'anim-turn' : ''}
            />
          </span>
          <Count n={s.repost_count} />
        </button>
        <button
          type="submit"
          name="intent"
          value={s.liked ? 'unlike' : 'like'}
          onClick={() => !s.liked && setPop((p) => ({ ...p, like: p.like + 1 }))}
          aria-label={t(s.liked ? 'action.unlike' : 'action.like')}
          aria-pressed={s.liked}
          title={t(s.liked ? 'action.unlike' : 'action.like')}
          className={cx(target, s.liked ? 'text-danger' : 'text-muted hover:text-danger')}
        >
          <span className={cx(disc, 'group-hover/a:bg-sunken')}>
            {pop.like > 0 && s.liked && (
              <span
                key={`b${pop.like}`}
                aria-hidden="true"
                className="anim-burst absolute inset-1 rounded-full border-2 border-danger"
              />
            )}
            <Heart
              key={pop.like}
              size={17}
              strokeWidth={1.75}
              fill={s.liked ? 'currentColor' : 'none'}
              className={pop.like && s.liked ? 'anim-pop' : ''}
            />
          </span>
          <Count n={s.like_count} />
        </button>
        <button
          type="submit"
          name="intent"
          value={s.bookmarked ? 'unbookmark' : 'bookmark'}
          aria-label={t(s.bookmarked ? 'action.unbookmark' : 'action.bookmark')}
          aria-pressed={s.bookmarked}
          title={t(s.bookmarked ? 'action.unbookmark' : 'action.bookmark')}
          className={cx(target, s.bookmarked ? 'text-lapis' : 'text-muted hover:text-lapis')}
        >
          <span className={cx(disc, 'group-hover/a:bg-lapis-soft')}>
            <Bookmark
              size={17}
              strokeWidth={1.75}
              fill={s.bookmarked ? 'currentColor' : 'none'}
              className={s.bookmarked ? 'anim-pop' : ''}
            />
          </span>
        </button>
      </f.Form>
      {hydrated && (
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={share}
            aria-label={t('common.share')}
            title={t('common.share')}
            className={cx(target, 'text-muted hover:text-lapis')}
          >
            <span className={cx(disc, 'group-hover/a:bg-lapis-soft')}>
              <Share size={16} strokeWidth={1.75} />
            </span>
          </button>
          <Menu
            trigger={
              <button
                type="button"
                aria-label={t('note.actions')}
                className={cx(target, 'text-muted hover:text-ink')}
              >
                <span className={cx(disc, 'group-hover/a:bg-sunken')}>
                  <MoreHorizontal size={17} strokeWidth={1.75} />
                </span>
              </button>
            }
            items={[
              {
                label: t('action.quote'),
                href: `/notes?quote=${note.id}#compose`,
                icon: <Quote size={15} />,
              },
              {
                label: t('note.copy_link'),
                icon: <LinkIcon size={15} />,
                onSelect: () => {
                  navigator.clipboard?.writeText(url())
                  toast(t('common.copied'))
                },
              },
              ...(note.can_edit && !note.promoted_link_id && note.preview
                ? [
                    {
                      label: t('action.promote'),
                      href: `/submit?kind=link&url=${encodeURIComponent(note.preview.url)}`,
                      icon: <ArrowUpRight size={15} />,
                    },
                  ]
                : []),
              ...(note.can_edit
                ? [
                    'separator' as const,
                    {
                      label: t('common.delete'),
                      danger: true,
                      icon: <Trash2 size={15} />,
                      onSelect: () => {
                        if (window.confirm(t('note.delete_confirm'))) {
                          del.submit(
                            { kind: 'note', id: String(note.id), _csrf: csrf, redirectTo: '/notes' },
                            { method: 'post', action: '/actions/delete' },
                          )
                        }
                      },
                    },
                  ]
                : [
                    {
                      label: t('common.report'),
                      icon: <Flag size={15} />,
                      onSelect: () => setReporting(true),
                    },
                  ]),
            ]}
          />
        </span>
      )}
      {reporting && (
        <ReportDialog open={reporting} onOpenChange={setReporting} subjectType="note" subjectId={note.id} />
      )}
    </div>
  )
}

/** A reaction count: blank at zero so the row stays quiet. */
function Count({ n }: { n: number }) {
  return <span className="min-w-4">{n > 0 ? n : ''}</span>
}
