import { buttonClass, EmptyState, NavTabs } from '@buildwith/ui'
import { MessageCircleQuestion, Sparkles } from 'lucide-react'
import { Hero, HomeComposer } from '../components/Home'
import { LinkRow } from '../components/LinkRow'
import { LoadMore } from '../components/LoadMore'
import { Sidebar } from '../components/Sidebar'
import { api, orThrow, viewer } from '../lib/api.server'
import { useMe, useSignedIn } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/top'

type Mode = 'top' | 'new' | 'best' | 'savol' | 'korsat'

function modeOf(pathname: string): Mode {
  const m = pathname.replace(/\/$/, '').slice(1)
  return (['new', 'best', 'savol', 'korsat'] as const).find((x) => x === m) ?? 'top'
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const mode = modeOf(url.pathname)
  const client = api(context)
  const q = url.searchParams
  const query = {
    sort: mode === 'new' ? 'new' : mode === 'best' ? 'best' : mode === 'top' ? 'top' : ('new' as const),
    kind: mode === 'savol' ? ('ask' as const) : mode === 'korsat' ? ('show' as const) : undefined,
    domain: q.get('domain') ?? undefined,
    cursor: q.get('cursor') ?? undefined,
    limit: 30,
  } as const
  const sortForKind =
    mode === 'savol' || mode === 'korsat' ? (q.get('sort') === 'top' ? 'top' : 'new') : query.sort
  const me = viewer(context).me
  const [links, popular, latest, tags, who] = await Promise.all([
    client.GET('/links', { params: { query: { ...query, sort: sortForKind } } }),
    mode === 'top' && !query.cursor
      ? client.GET('/notes/popular', { params: { query: { limit: 4 } } })
      : null,
    mode === 'top' && !query.cursor ? client.GET('/notes', { params: { query: { limit: 4 } } }) : null,
    client.GET('/tags', { params: { query: { limit: 16 } } }),
    me && mode === 'top' ? client.GET('/who-to-follow', { params: { query: { limit: 3 } } }) : null,
  ])
  const page = orThrow(links)
  return {
    mode,
    sort: sortForKind,
    domain: query.domain ?? null,
    offset: query.cursor ? Number(q.get('n') ?? 0) : 0,
    links: page.items,
    next: page.nextCursor ?? null,
    // Popular notes when there are any today; otherwise the latest, so notes are always on the home page.
    notes: popular?.data?.items.length ? popular.data.items : (latest?.data?.items ?? []),
    notesTitle: popular?.data?.items.length ? 'feed.popular_notes' : 'feed.latest_notes',
    tags: tags.data?.items ?? [],
    who: who?.data?.items ?? [],
  }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const key = { top: undefined, new: 'nav.new', best: 'nav.best', savol: 'nav.savol', korsat: 'nav.korsat' }[
    loaderData?.mode ?? 'top'
  ]
  return pageMeta(matches, { titleKey: key })
}

export default function Top({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const { mode, links, next, notes, notesTitle, tags, who, domain, sort } = loaderData
  const root = useSignedIn()
  const me = useMe()
  const ListTitle = mode === 'top' && !me ? 'h2' : 'h1'
  const isList = mode === 'top' || mode === 'new' || mode === 'best'
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-labelledby="list-title">
        {mode === 'top' && (me ? <HomeComposer /> : <Hero />)}
        <div className="mb-2 flex items-end justify-between gap-3">
          {/* The visitor hero carries the page's h1; then the list title steps down to h2. */}
          <ListTitle id="list-title" className="text-xl font-semibold text-ink">
            {domain ??
              t(
                mode === 'savol'
                  ? 'feed.savol_title'
                  : mode === 'korsat'
                    ? 'feed.korsat_title'
                    : 'feed.top_title',
              )}
          </ListTitle>
          {mode === 'savol' && (
            <a href="/submit?kind=ask" className={buttonClass('primary', 'sm')}>
              <MessageCircleQuestion size={16} aria-hidden="true" /> {t('compose.question')}
            </a>
          )}
          {mode === 'korsat' && (
            <a href="/submit?kind=show" className={buttonClass('primary', 'sm')}>
              <Sparkles size={16} aria-hidden="true" /> {t('kind.show')}
            </a>
          )}
        </div>
        {isList ? (
          <NavTabs
            label={t('nav.top')}
            tabs={[
              { href: '/', label: t('nav.top'), active: mode === 'top' },
              { href: '/new', label: t('nav.new'), active: mode === 'new' },
              { href: '/best', label: t('nav.best'), active: mode === 'best' },
            ]}
          />
        ) : (
          <NavTabs
            label={t(`nav.${mode}`)}
            tabs={[
              { href: `/${mode}`, label: t('nav.new'), active: sort === 'new' },
              { href: `/${mode}?sort=top`, label: t('nav.top'), active: sort === 'top' },
            ]}
          />
        )}
        {links.length === 0 ? (
          <EmptyState
            title={t('feed.empty')}
            action={
              root ? (
                <a href="/submit" className={buttonClass('secondary', 'sm')}>
                  {t('compose.submit_link')}
                </a>
              ) : undefined
            }
          />
        ) : (
          <ol className="divide-y divide-line">
            {links.map((l, i) => (
              <li key={l.id}>
                <LinkRow
                  link={l}
                  rank={mode === 'top' || mode === 'best' ? i + 1 : undefined}
                  signedIn={root}
                />
              </li>
            ))}
          </ol>
        )}
        <LoadMore cursor={next} />
      </section>
      <Sidebar notes={notes} notesTitle={notesTitle} tags={tags} suggestions={who} signedIn={root} />
    </div>
  )
}
