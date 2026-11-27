import type { FeedItem } from '@buildwith/api-client'
import { EmptyState } from '@buildwith/ui'
import { ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRevalidator } from 'react-router'
import { ArticleCard } from '../components/ArticleCard'
import { LinkRow } from '../components/LinkRow'
import { LoadMore } from '../components/LoadMore'
import { NoteCard } from '../components/NoteCard'
import { Sidebar } from '../components/Sidebar'
import { api, orThrow, requireMe } from '../lib/api.server'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/following'

const POLL_MS = 60_000

export async function loader({ request, context }: Route.LoaderArgs) {
  requireMe(context, request)
  const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
  const client = api(context)
  const [page, tags, who] = await Promise.all([
    client.GET('/timeline', { params: { query: { cursor, limit: 30 } } }),
    client.GET('/tags', { params: { query: { limit: 14 } } }),
    client.GET('/who-to-follow', { params: { query: { limit: 5 } } }),
  ])
  const feed = orThrow(page)
  return {
    items: feed.items,
    next: feed.nextCursor ?? null,
    firstPage: !cursor,
    tags: tags.data?.items ?? [],
    who: who.data?.items ?? [],
  }
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'nav.following', noindex: true })
}

export default function Following({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const { items, next, firstPage, tags, who } = loaderData
  const empty = items.length === 0 && firstPage
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,640px)_300px] lg:justify-center">
      <section aria-labelledby="following-title" className="min-w-0">
        <header className="border-b border-line pb-3">
          <h1 id="following-title" className="text-xl font-semibold text-ink">
            {t('nav.following')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('timeline.intro')}</p>
        </header>
        {firstPage && items[0] && <NewPill since={items[0].created_at} />}
        {empty ? (
          <>
            <EmptyState title={t('timeline.empty_title')}>{t('feed.following_empty')}</EmptyState>
            <div className="mx-auto max-w-md lg:hidden">
              <Sidebar tags={tags} suggestions={who} signedIn />
            </div>
          </>
        ) : (
          <ol className="divide-y divide-line">
            {items.map((it) => (
              <li key={`${it.kind}-${itemId(it)}`}>
                <Item item={it} />
              </li>
            ))}
          </ol>
        )}
        <LoadMore cursor={next} />
      </section>
      <div className="hidden lg:block">
        <div className="sticky top-20">
          <Sidebar tags={tags} suggestions={who} signedIn />
        </div>
      </div>
    </div>
  )
}

function itemId(it: FeedItem) {
  return it.note?.id ?? it.link?.id ?? it.article?.id ?? it.created_at
}

function Item({ item }: { item: FeedItem }) {
  if (item.kind === 'note' && item.note) return <NoteCard note={item.note} signedIn />
  if (item.kind === 'link' && item.link) return <LinkRow link={item.link} signedIn />
  if (item.kind === 'article' && item.article) return <ArticleCard a={item.article} />
  return null
}

/**
 * "N new posts": polls the count through the same-origin API proxy once a
 * minute while the tab is visible, and reloads the list on click.
 */
function NewPill({ since }: { since: string }) {
  const t = useT()
  const revalidator = useRevalidator()
  const [count, setCount] = useState(0)

  useEffect(() => {
    setCount(0)
    let stopped = false
    const check = async () => {
      if (document.hidden) return
      try {
        const res = await fetch(`/v1/timeline/count?since=${encodeURIComponent(since)}`, {
          credentials: 'same-origin',
        })
        if (res.ok && !stopped) setCount((await res.json()).count ?? 0)
      } catch {
        // Offline or the API restarted: try again next minute.
      }
    }
    const timer = window.setInterval(check, POLL_MS)
    const onVisible = () => !document.hidden && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [since])

  if (count <= 0) return null
  return (
    <div className="pointer-events-none sticky top-16 z-20 flex justify-center py-2">
      <button
        type="button"
        onClick={() => {
          revalidator.revalidate()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        disabled={revalidator.state !== 'idle'}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-lapis px-3.5 py-1.5 text-sm font-medium text-on-accent shadow-[0_4px_16px_rgba(0,0,0,0.14)] transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <ArrowUp size={15} strokeWidth={2} aria-hidden="true" />
        {t('timeline.new_pill', { count })}
      </button>
    </div>
  )
}
