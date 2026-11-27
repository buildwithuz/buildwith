import type { Comment, Schemas } from '@buildwith/api-client'
import { buttonClass, EmptyState, NavTabs } from '@buildwith/ui'
import { ArrowRight, Search as SearchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Form, useNavigation } from 'react-router'
import { ArticleCard } from '../components/ArticleCard'
import { PersonCard } from '../components/account/PersonCard'
import { FollowButton } from '../components/FollowButton'
import { LinkRow } from '../components/LinkRow'
import { LoadMore } from '../components/LoadMore'
import { NoteCard } from '../components/NoteCard'
import { TimeAgo, UserAvatar } from '../components/UserLine'
import { api, viewer } from '../lib/api.server'
import { useMe, useSignedIn } from '../lib/hooks'
import { Html, useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/search'

type Kind = Schemas['SearchKind']
const KINDS: Kind[] = ['link', 'note', 'article', 'user', 'comment']
const PAGE = 20

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120)
  const k = url.searchParams.get('kind')
  const kind = KINDS.find((x) => x === k) ?? null
  // LoadMore passes "cursor"; search pages by offset, so the cursor is the offset.
  const offset = kind ? Math.min(1000, Math.max(0, Number(url.searchParams.get('cursor')) || 0)) : 0
  if ([...q].length < 2)
    return { q, kind, offset, results: null, following: {} as Record<string, boolean>, next: null }
  const client = api(context)
  const res = await client.GET('/search', {
    params: { query: { q, kind: kind ?? undefined, offset, limit: PAGE } },
  })
  const results = res.data ?? { links: [], notes: [], articles: [], comments: [], users: [], total: 0 }

  // Users carry no relation, so ask for it for the handful of people shown.
  const me = viewer(context).me
  const following: Record<string, boolean> = {}
  if (me) {
    const people = results.users.filter((u) => u.username !== me.username).slice(0, 12)
    const rel = await Promise.all(
      people.map((u) => client.GET('/users/{username}', { params: { path: { username: u.username } } })),
    )
    rel.forEach((r, i) => {
      following[people[i]!.username] = Boolean(r.data?.relation?.following)
    })
  }
  const count = kind
    ? {
        link: results.links,
        note: results.notes,
        article: results.articles,
        user: results.users,
        comment: results.comments,
      }[kind].length
    : 0
  const next = kind && kind !== 'user' && count >= PAGE ? String(offset + PAGE) : null
  return { q, kind, offset, results, following, next }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'nav.search', title: loaderData?.q || undefined, noindex: true })
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const { q, kind, results, following, next } = loaderData
  const signedIn = useSignedIn()
  const me = useMe()
  const searching = useNavigation().location?.pathname === '/search'
  const tab = (k: Kind | null, label: string) => ({
    href: `/search?${new URLSearchParams({ ...(q ? { q } : {}), ...(k ? { kind: k } : {}) })}`,
    label,
    active: kind === k,
  })
  const empty = results && results.total === 0
  const show = (k: Kind) => !kind || kind === k
  const seeAll = (k: Kind, n: number) =>
    !kind && n >= 3 ? (
      <a
        href={`/search?${new URLSearchParams({ q, kind: k })}`}
        className="inline-flex items-center gap-1 text-sm text-lapis hover:underline"
      >
        {t('feed.see_all')} <ArrowRight size={14} aria-hidden="true" />
      </a>
    ) : null

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="sr-only">{t('nav.search')}</h1>
      <Form method="get" action="/search" role="search" className="relative">
        {kind && <input type="hidden" name="kind" value={kind} />}
        <label htmlFor="search-q" className="sr-only">
          {t('nav.search')}
        </label>
        <SearchIcon
          size={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          id="search-q"
          name="q"
          type="search"
          defaultValue={q}
          key={q}
          // biome-ignore lint/a11y/noAutofocus: the search page exists to type into this field
          autoFocus
          enterKeyHint="search"
          placeholder={t('search.placeholder')}
          aria-describedby="search-hint"
          className="h-14 w-full rounded-card border border-line bg-surface pl-12 pr-28 text-lg text-ink shadow-[0_1px_0_rgb(0_0_0/0.02)] placeholder:text-muted focus:border-lapis focus:outline-none sm:pr-32"
        />
        <button
          type="submit"
          className={buttonClass('primary', 'sm', 'absolute right-2.5 top-1/2 -translate-y-1/2')}
        >
          {t('nav.search')}
        </button>
      </Form>
      <p id="search-hint" className="mt-2 px-1 text-xs text-muted">
        {t('search.hint')}
      </p>

      <NavTabs
        label={t('nav.search')}
        className="mt-5"
        tabs={[
          tab(null, t('search.all')),
          tab('link', t('search.posts')),
          tab('note', t('nav.notes')),
          tab('article', t('nav.articles')),
          tab('user', t('search.people')),
          tab('comment', t('search.comments')),
        ]}
      />

      <div
        aria-busy={searching}
        aria-live="polite"
        className={searching ? 'opacity-60 transition-opacity duration-150' : undefined}
      >
        {!results ? (
          <EmptyState title={q ? t('search.too_short') : t('search.start_title')}>
            {t('search.hint')}
          </EmptyState>
        ) : empty ? (
          <EmptyState title={t('search.none')}>{t('search.none_body')}</EmptyState>
        ) : (
          <div className="flex flex-col gap-8 pt-5">
            <h2 className="sr-only">{t('search.results', { q })}</h2>
            {show('user') && results.users.length > 0 && (
              <Group title={t('search.people')} action={null}>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {results.users.map((u) => (
                    <li key={u.id}>
                      <PersonCard
                        user={u}
                        showOpen
                        action={
                          me && me.username !== u.username ? (
                            <FollowButton username={u.username} following={following[u.username] ?? false} />
                          ) : !signedIn ? (
                            <a
                              href={`/login?next=${encodeURIComponent(`/@${u.username}`)}`}
                              className={buttonClass('secondary', 'sm')}
                            >
                              {t('common.follow')}
                            </a>
                          ) : null
                        }
                      />
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            {show('link') && results.links.length > 0 && (
              <Group title={t('search.posts')} action={seeAll('link', results.links.length)}>
                <ol className="divide-y divide-line">
                  {results.links.map((l) => (
                    <li key={l.id}>
                      <LinkRow link={l} signedIn={signedIn} />
                    </li>
                  ))}
                </ol>
              </Group>
            )}
            {show('note') && results.notes.length > 0 && (
              <Group title={t('nav.notes')} action={seeAll('note', results.notes.length)}>
                <ol className="divide-y divide-line">
                  {results.notes.map((n) => (
                    <li key={n.id}>
                      <NoteCard note={n} signedIn={signedIn} />
                    </li>
                  ))}
                </ol>
              </Group>
            )}
            {show('article') && results.articles.length > 0 && (
              <Group title={t('nav.articles')} action={seeAll('article', results.articles.length)}>
                <ol className="divide-y divide-line">
                  {results.articles.map((a) => (
                    <li key={a.id}>
                      <ArticleCard a={a} />
                    </li>
                  ))}
                </ol>
              </Group>
            )}
            {show('comment') && results.comments.length > 0 && (
              <Group title={t('search.comments')} action={seeAll('comment', results.comments.length)}>
                <ol className="divide-y divide-line">
                  {results.comments.map((c) => (
                    <li key={c.id}>
                      <CommentHit c={c} />
                    </li>
                  ))}
                </ol>
              </Group>
            )}
            {kind && <LoadMore cursor={next} />}
          </div>
        )}
      </div>
    </div>
  )
}

function Group({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function CommentHit({ c }: { c: Comment }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  return (
    <article className="flex gap-3 py-3">
      <UserAvatar user={c.author} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <a href={`/@${c.author.username}`} className="font-medium text-ink hover:underline">
            {tx.text(c.author.display_name || c.author.username)}
          </a>
          <TimeAgo iso={c.created_at} lang={lang} />
          <a
            href={`/c/${c.id}`}
            className="ml-auto inline-flex items-center gap-1 text-xs text-lapis hover:underline"
          >
            {t('notify.open')} <ArrowRight size={12} aria-hidden="true" />
          </a>
        </div>
        {c.killed ? (
          <p className="mt-1 text-sm italic text-muted">{t('common.removed')}</p>
        ) : c.deleted ? (
          <p className="mt-1 text-sm italic text-muted">{t('common.deleted')}</p>
        ) : (
          <Html html={c.body_html} className="prose-bw mt-1 line-clamp-4 text-[15px] text-ink" />
        )}
      </div>
    </article>
  )
}
