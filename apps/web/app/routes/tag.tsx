import type { Article, Link } from '@buildwith/api-client'
import { buttonClass, EmptyState, NavTabs } from '@buildwith/ui'
import { ArticleCard } from '../components/ArticleCard'
import { TagFollowButton } from '../components/FollowButton'
import { LinkRow } from '../components/LinkRow'
import { LoadMore } from '../components/LoadMore'
import { api, orThrow } from '../lib/api.server'
import { useSignedIn } from '../lib/hooks'
import { useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/tag'

type List =
  | { tab: 'posts'; items: Link[]; next: string | null }
  | { tab: 'articles'; items: Article[]; next: string | null }

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const slug = params.tag.toLowerCase()
  const q = new URL(request.url).searchParams
  const tab = q.get('tab') === 'articles' ? 'articles' : 'posts'
  const sort = q.get('sort') === 'top' ? 'top' : 'new'
  const cursor = q.get('cursor') ?? undefined
  const client = api(context)
  const [tag, list] = await Promise.all([
    client.GET('/tags/{slug}', { params: { path: { slug } } }).then(orThrow),
    tab === 'articles'
      ? client.GET('/articles', { params: { query: { tag: slug, cursor, limit: 20 } } }).then(orThrow)
      : client.GET('/links', { params: { query: { tag: slug, sort, cursor, limit: 30 } } }).then(orThrow),
  ])
  return {
    tag,
    sort,
    list: { tab, items: list.items, next: list.nextCursor ?? null } as List,
  }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return pageMeta(matches, { titleKey: 'error.not_found_title' })
  return pageMeta(matches, {
    title: `#${loaderData.tag.slug}`,
    description: loaderData.tag.description || undefined,
  })
}

export default function TagPage({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const tx = useTx()
  const signedIn = useSignedIn()
  const { tag, list, sort } = loaderData
  const base = `/t/${tag.slug}`
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 translate="no" className="break-all font-mono text-[28px] font-semibold leading-tight text-ink">
            <span className="text-muted">#</span>
            {tag.slug}
          </h1>
          {tag.name && tag.name !== tag.slug && (
            <p className="mt-1 text-sm font-medium text-ink">{tx.text(tag.name)}</p>
          )}
          {tag.description && (
            <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">
              {tx.text(tag.description)}
            </p>
          )}
          <p className="mt-2 font-mono text-xs text-muted">{t('tag.posts', { count: tag.post_count })}</p>
        </div>
        {signedIn ? (
          <TagFollowButton slug={tag.slug} following={tag.following ?? false} />
        ) : (
          <a href={`/login?next=${encodeURIComponent(base)}`} className={buttonClass('primary', 'sm')}>
            {t('common.follow')}
          </a>
        )}
      </header>

      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <NavTabs
          label={t('tag.sections', { tag: tag.slug })}
          className="flex-1"
          tabs={[
            { href: base, label: t('profile.tab_posts'), active: list.tab === 'posts' },
            {
              href: `${base}?tab=articles`,
              label: t('profile.tab_articles'),
              active: list.tab === 'articles',
            },
          ]}
        />
      </div>
      {list.tab === 'posts' && (
        <nav aria-label={t('tag.sort')} className="mt-3 flex gap-3 text-xs">
          <a
            href={base}
            aria-current={sort === 'new' ? 'page' : undefined}
            className={sort === 'new' ? 'font-semibold text-ink' : 'text-muted hover:text-ink'}
          >
            {t('nav.new')}
          </a>
          <a
            href={`${base}?sort=top`}
            aria-current={sort === 'top' ? 'page' : undefined}
            className={sort === 'top' ? 'font-semibold text-ink' : 'text-muted hover:text-ink'}
          >
            {t('nav.top')}
          </a>
        </nav>
      )}

      {list.items.length === 0 ? (
        <EmptyState
          title={t('tag.empty')}
          action={
            list.tab === 'articles' ? (
              <a href="/write/new" className={buttonClass('secondary', 'sm')}>
                {t('compose.write_article')}
              </a>
            ) : (
              <a href="/submit" className={buttonClass('secondary', 'sm')}>
                {t('compose.submit_link')}
              </a>
            )
          }
        />
      ) : list.tab === 'posts' ? (
        <ol className="divide-y divide-line">
          {list.items.map((l) => (
            <li key={l.id}>
              <LinkRow link={l} signedIn={signedIn} />
            </li>
          ))}
        </ol>
      ) : (
        <ol className="divide-y divide-line">
          {list.items.map((a) => (
            <li key={a.id}>
              <ArticleCard a={a} />
            </li>
          ))}
        </ol>
      )}
      <LoadMore cursor={list.next} />
    </div>
  )
}
