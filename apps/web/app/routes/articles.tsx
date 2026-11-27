import { buttonClass, Card, CardHeader, EmptyState, NavTabs, Tag } from '@buildwith/ui'
import { PenLine, X } from 'lucide-react'
import { ArticleCard } from '../components/ArticleCard'
import { LeadArticle } from '../components/article/LeadArticle'
import { LoadMore } from '../components/LoadMore'
import { api, orThrow } from '../lib/api.server'
import { useSignedIn } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/articles'

type Sort = 'latest' | 'popular' | 'featured'

export async function loader({ request, context }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams
  const sort: Sort =
    q.get('sort') === 'popular' ? 'popular' : q.get('sort') === 'featured' ? 'featured' : 'latest'
  const tag = q.get('tag')?.trim().toLowerCase() || undefined
  const cursor = q.get('cursor') ?? undefined
  const client = api(context)
  const wantLead = sort === 'latest' && !cursor
  const [list, lead, tags] = await Promise.all([
    client.GET('/articles', { params: { query: { sort, tag, cursor, limit: 20 } } }),
    wantLead ? client.GET('/articles', { params: { query: { sort: 'featured', tag, limit: 1 } } }) : null,
    client.GET('/tags', { params: { query: { limit: 20 } } }),
  ])
  const page = orThrow(list)
  const featured = lead?.data?.items[0] ?? null
  return {
    sort,
    tag: tag ?? null,
    lead: featured,
    items: featured ? page.items.filter((a) => a.id !== featured.id) : page.items,
    next: page.nextCursor ?? null,
    tags: tags.data?.items ?? [],
  }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  return pageMeta(matches, {
    titleKey: 'nav.articles',
    description: undefined,
    ...(loaderData?.tag ? { title: `#${loaderData.tag}` } : {}),
  })
}

export default function Articles({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const signedIn = useSignedIn()
  const { sort, tag, lead, items, next, tags } = loaderData
  const href = (s: Sort) => {
    const p = new URLSearchParams()
    if (s !== 'latest') p.set('sort', s)
    if (tag) p.set('tag', tag)
    const qs = p.toString()
    return qs ? `/articles?${qs}` : '/articles'
  }
  const write = signedIn ? (
    <a href="/write/new" className={buttonClass('primary', 'sm')}>
      <PenLine size={15} aria-hidden="true" /> {t('compose.write_article')}
    </a>
  ) : (
    <a href={`/login?next=${encodeURIComponent('/write/new')}`} className={buttonClass('secondary', 'sm')}>
      <PenLine size={15} aria-hidden="true" /> {t('compose.write_article')}
    </a>
  )
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section aria-labelledby="articles-title" className="min-w-0">
        <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="articles-title" className="font-serif text-[28px] font-semibold leading-tight text-ink">
              {t('nav.articles')}
            </h1>
            <p className="mt-1 text-sm text-muted">{t('home.articles_desc')}</p>
          </div>
          {write}
        </div>
        {tag && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            {t('articles.filtered_by')}
            <span className="inline-flex items-center gap-1 rounded-control bg-sunken pl-1.5 font-mono text-xs text-ink">
              <a href={`/t/${tag}`} translate="no" className="hover:text-lapis">
                #{tag}
              </a>
              <a
                href={sort === 'latest' ? '/articles' : `/articles?sort=${sort}`}
                aria-label={t('articles.clear_tag')}
                className="rounded-control p-1 text-muted hover:text-ink"
              >
                <X size={12} aria-hidden="true" />
              </a>
            </span>
          </p>
        )}
        <NavTabs
          label={t('nav.articles')}
          className="mt-4"
          tabs={[
            { href: href('latest'), label: t('article.latest'), active: sort === 'latest' },
            { href: href('popular'), label: t('article.popular_week'), active: sort === 'popular' },
            { href: href('featured'), label: t('article.featured'), active: sort === 'featured' },
          ]}
        />
        {lead && (
          <div className="mt-5">
            <LeadArticle a={lead} />
          </div>
        )}
        {items.length === 0 && !lead ? (
          <EmptyState
            title={t(sort === 'featured' ? 'articles.empty_featured' : 'articles.empty')}
            action={write}
          />
        ) : (
          <ol className="divide-y divide-line">
            {items.map((a) => (
              <li key={a.id}>
                <ArticleCard a={a} />
              </li>
            ))}
          </ol>
        )}
        <LoadMore cursor={next} />
      </section>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        {tags.length > 0 && (
          <Card>
            <CardHeader>{t('articles.topics')}</CardHeader>
            <div className="flex flex-wrap gap-1.5 p-4">
              {tags.map((x) => (
                <Tag
                  key={x.slug}
                  slug={x.slug}
                  href={`/articles?tag=${encodeURIComponent(x.slug)}${sort !== 'latest' ? `&sort=${sort}` : ''}`}
                  aria-current={x.slug === tag ? 'true' : undefined}
                  className={x.slug === tag ? 'bg-lapis-soft text-lapis' : undefined}
                />
              ))}
            </div>
          </Card>
        )}
        <Card className="p-4">
          <p className="font-serif text-lg font-semibold text-ink">{t('articles.cta_title')}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t('articles.cta_body')}</p>
          <div className="mt-3">{write}</div>
        </Card>
      </aside>
    </div>
  )
}
