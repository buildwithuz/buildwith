import { buttonClass, cx, EmptyState, NavTabs, useToast } from '@buildwith/ui'
import { NotebookPen } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Composer } from '../components/Composer'
import { LoadMore } from '../components/LoadMore'
import { NoteCard } from '../components/NoteCard'
import { Notice } from '../components/posts/PostTools'
import { Sidebar } from '../components/Sidebar'
import { api, orThrow, viewer } from '../lib/api.server'
import { useMe } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/notes'

export async function loader({ request, context }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams
  const tab = q.get('tab') === 'popular' ? 'popular' : 'latest'
  const client = api(context)
  const me = viewer(context).me
  const quoteId = Number(q.get('quote'))
  const [page, quote, tags, who] = await Promise.all([
    tab === 'popular'
      ? client.GET('/notes/popular', { params: { query: { limit: 30 } } })
      : client.GET('/notes', { params: { query: { cursor: q.get('cursor') ?? undefined, limit: 30 } } }),
    me && Number.isSafeInteger(quoteId) && quoteId > 0
      ? client.GET('/notes/{id}', { params: { path: { id: quoteId } } })
      : null,
    client.GET('/tags', { params: { query: { limit: 14 } } }),
    me ? client.GET('/who-to-follow', { params: { query: { limit: 4 } } }) : null,
  ])
  const notes = orThrow(page)
  const error = q.get('error')
  return {
    tab,
    notes: notes.items,
    next: tab === 'latest' ? (notes.nextCursor ?? null) : null,
    quote: quote?.data && !quote.data.killed ? quote.data : null,
    tags: tags.data?.items ?? [],
    who: who?.data?.items ?? [],
    error: error && /^[a-z_]{2,40}$/.test(error) ? error : null,
  }
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'feed.notes_title' })
}

export default function Notes({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const me = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const { hash, search } = useLocation()
  const { tab, notes, next, quote, tags, who, error } = loaderData
  const signedIn = Boolean(me)

  // "/notes#compose" (the N shortcut, the + button) means "let me write".
  useEffect(() => {
    if (hash === '#compose' || quote)
      document.querySelector<HTMLTextAreaElement>('#compose textarea')?.focus()
  }, [hash, quote])

  const onPosted = useCallback(() => {
    toast(t('compose.posted'))
    // A posted quote (or a cleared ?error) should not stick to the next note.
    if (search.includes('quote=') || search.includes('error='))
      navigate(tab === 'popular' ? '/notes?tab=popular' : '/notes', { replace: true })
  }, [toast, t, search, navigate, tab])

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,640px)_300px] lg:justify-center">
      <section aria-labelledby="notes-title" className="min-w-0">
        <h1 id="notes-title" className="text-xl font-semibold text-ink">
          {t('feed.notes_title')}
        </h1>

        <div id="compose" className={cx('mt-3 scroll-mt-20', me && 'border-b border-line')}>
          {me ? (
            <>
              {quote && (
                <div className="mt-2 rounded-card border border-line bg-surface px-3 pb-1 pt-2.5">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted">
                    <span className="font-medium">{t('notes.quoting')}</span>
                    <a href="/notes#compose" className="hover:text-ink hover:underline">
                      {t('notes.remove_quote')}
                    </a>
                  </div>
                  <NoteCard note={quote} signedIn={signedIn} compact />
                </div>
              )}
              {error && (
                <Notice tone="danger" className="mt-3">
                  {t(`error.${error}`)}
                </Notice>
              )}
              <Composer
                me={me}
                quoteOf={quote?.id}
                placeholder={quote ? t('notes.quote_placeholder') : undefined}
                onPosted={onPosted}
              />
            </>
          ) : (
            <div className="mb-4 flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center">
              <NotebookPen
                size={22}
                strokeWidth={1.5}
                className="hidden shrink-0 text-lapis sm:block"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{t('notes.login_title')}</p>
                <p className="mt-0.5 text-sm text-muted">{t('notes.login_body')}</p>
              </div>
              <a href="/login?next=%2Fnotes%23compose" className={buttonClass('primary', 'sm', 'shrink-0')}>
                {t('nav.login')}
              </a>
            </div>
          )}
        </div>

        <NavTabs
          label={t('notes.tabs_label')}
          className="mt-2"
          tabs={[
            { href: '/notes', label: t('notes.latest'), active: tab === 'latest' },
            { href: '/notes?tab=popular', label: t('notes.popular_today'), active: tab === 'popular' },
          ]}
        />

        {notes.length === 0 ? (
          <EmptyState title={t(tab === 'popular' ? 'notes.popular_empty' : 'notes.empty')}>
            {tab === 'popular' ? t('notes.popular_empty_body') : null}
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {notes.map((n) => (
              <li key={n.id}>
                <NoteCard note={n} signedIn={signedIn} />
              </li>
            ))}
          </ol>
        )}
        <LoadMore cursor={next} />
      </section>
      <div className="hidden lg:block">
        <div className="sticky top-20">
          <Sidebar tags={tags} suggestions={who} signedIn={signedIn} />
        </div>
      </div>
    </div>
  )
}
