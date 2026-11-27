import type { Article, Profile } from '@buildwith/api-client'
import { Avatar, Badge, buttonClass, Tag } from '@buildwith/ui'
import { Pencil } from 'lucide-react'
import { useLocation } from 'react-router'
import { Toc, TocInline } from '../components/article/Toc'
import { CommentForm, CommentThread } from '../components/Comments'
import { FollowButton } from '../components/FollowButton'
import { VoteButton } from '../components/VoteButton'
import { api, orThrow, viewer } from '../lib/api.server'
import { usernameFrom } from '../lib/handle'
import { useMe } from '../lib/hooks'
import { Html, useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import { formatDate } from '../lib/time'
import type { Route } from './+types/article'

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const author = usernameFrom(params.handle)
  const client = api(context)
  const article = orThrow(
    await client.GET('/articles/by-slug', { params: { query: { author, slug: params.slug } } }),
  )
  const me = viewer(context).me
  const [comments, profile, series] = await Promise.all([
    article.status === 'published'
      ? client.GET('/comments', {
          params: { query: { subject_type: 'article', subject_id: article.id, limit: 500 } },
        })
      : null,
    client.GET('/users/{username}', { params: { path: { username: article.author.username } } }),
    article.series
      ? client.GET('/articles', { params: { query: { series_id: article.series.id, limit: 50 } } })
      : null,
  ])
  const url = new URL(request.url)
  return {
    article,
    comments: comments?.data?.items ?? [],
    profile: (profile.data ?? null) as Profile | null,
    series: (series?.data?.items ?? []).slice().sort((a, b) => (a.series_sort ?? 0) - (b.series_sort ?? 0)),
    origin: url.origin,
    isAuthor: me?.id === article.author.id,
    canDownvote: (me?.karma ?? 0) >= 100,
    error: url.searchParams.get('error'),
  }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return pageMeta(matches, { titleKey: 'error.not_found_title' })
  const { article: a, origin } = loaderData
  const image = a.cover ? new URL(a.cover.url, origin).toString() : undefined
  const tags = pageMeta(matches, {
    title: a.title,
    description: a.subtitle || undefined,
    image,
    noindex: a.status !== 'published',
  })
  const out: Record<string, string>[] = [
    ...tags,
    { property: 'og:type', content: 'article' },
    { property: 'og:url', content: origin + a.path },
    { tagName: 'link', rel: 'canonical', href: a.canonical_url || origin + a.path },
    { name: 'author', content: a.author.display_name || a.author.username },
  ]
  if (a.published_at) out.push({ property: 'article:published_time', content: a.published_at })
  for (const t of a.tags) out.push({ property: 'article:tag', content: t.slug })
  return out
}

export default function ArticlePage({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const tx = useTx()
  const { lang, script } = useLang()
  const me = useMe()
  const loc = useLocation()
  const { article: a, comments, profile, series, isAuthor, canDownvote, error } = loaderData
  const author = a.author
  const name = tx.text(author.display_name || author.username)
  const published = a.status === 'published'
  const toc = a.toc ?? []
  const showToc = toc.length >= 2
  const following = profile?.relation?.following ?? false
  const bodyLang = a.lang === 'uz' && script === 'cyrl' ? 'uz-Cyrl' : a.lang

  const follow = me && !isAuthor ? <FollowButton username={author.username} following={following} /> : null

  return (
    <div className="mx-auto w-full max-w-[680px] lg:grid lg:max-w-none lg:grid-cols-[minmax(0,680px)_200px] lg:justify-center lg:gap-14">
      <article className="min-w-0" aria-labelledby="article-title">
        {!published && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-saffron/40 bg-saffron-soft px-4 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-ink">
              <Badge tone="saffron">{t(`article.${a.status}`)}</Badge>
              {a.status === 'scheduled' && a.scheduled_at
                ? t('article.scheduled_for', { date: formatDate(a.scheduled_at, lang, true) })
                : t('article.draft_preview')}
            </p>
            {a.can_edit && (
              <a href={`/write/${a.id}`} className={buttonClass('secondary', 'sm')}>
                <Pencil size={14} aria-hidden="true" /> {t('common.edit')}
              </a>
            )}
          </div>
        )}

        <header className="mb-10">
          {a.cover && (
            <img
              src={a.cover.url}
              alt=""
              width={a.cover.width}
              height={a.cover.height}
              className="mb-8 aspect-[2/1] w-full rounded-card border border-line bg-sunken object-cover"
            />
          )}
          {a.tags.length > 0 && (
            <p className="mb-4 flex flex-wrap gap-1.5">
              {a.tags.map((tag) => (
                <Tag key={tag.slug} slug={tag.slug} />
              ))}
            </p>
          )}
          <h1
            id="article-title"
            lang={bodyLang}
            className="font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink sm:text-[40px]"
          >
            {tx.text(a.title)}
          </h1>
          {a.subtitle && (
            <p lang={bodyLang} className="mt-3 font-serif text-xl leading-snug text-muted sm:text-[22px]">
              {tx.text(a.subtitle)}
            </p>
          )}

          <div className="mt-7 flex items-center gap-3 border-y border-line py-4">
            <a href={`/@${author.username}`} className="shrink-0" tabIndex={-1} aria-label={name}>
              <Avatar
                name={author.display_name || author.username}
                src={author.avatar_url}
                size={44}
                accent={author.accent}
              />
            </a>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <a href={`/@${author.username}`} className="font-semibold text-ink hover:underline">
                  {name}
                </a>
                <a
                  href={`/@${author.username}`}
                  translate="no"
                  className="font-mono text-xs text-muted hover:underline"
                >
                  @{author.username}
                </a>
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted">
                {a.published_at && (
                  <>
                    <time dateTime={a.published_at}>{formatDate(a.published_at, lang)}</time>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span>{t('count.minutes_read', { count: a.reading_minutes })}</span>
              </p>
            </div>
            {follow}
            {isAuthor && published && (
              <a href={`/write/${a.id}`} className={buttonClass('secondary', 'sm')}>
                <Pencil size={14} aria-hidden="true" /> {t('common.edit')}
              </a>
            )}
          </div>
        </header>

        {a.series && series.length > 1 && <SeriesBox current={a} items={series} />}
        {showToc && <TocInline toc={toc} />}

        <div data-lightbox>
          <Html html={a.body_html} className="prose-bw prose-article text-ink" />
        </div>

        {a.canonical_url && (
          <p className="mt-10 border-l-2 border-line pl-4 font-serif text-[15px] italic text-muted">
            {t('article.canonical')}{' '}
            <a
              href={a.canonical_url}
              rel="canonical noopener"
              translate="no"
              className="break-all not-italic text-lapis underline underline-offset-2"
            >
              {a.canonical_url.replace(/^https?:\/\//, '')}
            </a>
          </p>
        )}

        <footer className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-4">
            <div className="flex items-center gap-3">
              {published && (
                <VoteButton
                  subject="article"
                  id={a.id}
                  points={a.points}
                  vote={a.viewer_vote ?? 0}
                  signedIn={Boolean(me)}
                  disabled={isAuthor}
                  layout="row"
                />
              )}
              <span className="text-sm text-muted">{t('count.comments', { count: a.comment_count })}</span>
            </div>
            {a.tags.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {a.tags.map((tag) => (
                  <Tag key={tag.slug} slug={tag.slug} />
                ))}
              </p>
            )}
          </div>

          <section
            aria-labelledby="author-card"
            className="mt-8 flex gap-4 rounded-card border border-line bg-surface p-5"
          >
            <a href={`/@${author.username}`} className="shrink-0" tabIndex={-1} aria-label={name}>
              <Avatar
                name={author.display_name || author.username}
                src={author.avatar_url}
                size={56}
                accent={author.accent}
              />
            </a>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                {t('article.about_author')}
              </p>
              <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="author-card" className="text-lg font-semibold text-ink">
                    <a href={`/@${author.username}`} className="hover:underline">
                      {name}
                    </a>
                  </h2>
                  {(author.role_title || author.company) && (
                    <p className="text-sm text-muted">
                      {tx.text(author.role_title)}
                      {author.role_title && author.company && ' @ '}
                      {tx.text(author.company)}
                    </p>
                  )}
                </div>
                {follow}
              </div>
              {author.bio && (
                <p className="mt-2 text-[15px] leading-relaxed text-ink">{tx.text(author.bio)}</p>
              )}
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {profile && (
                  <span className="text-muted">
                    {t('count.followers', { count: profile.counts.followers })}
                  </span>
                )}
                <a
                  href={`/@${author.username}?tab=articles`}
                  className="font-medium text-lapis hover:underline"
                >
                  {t('article.more_from', { name })}
                </a>
              </p>
            </div>
          </section>
        </footer>

        {published && (
          <section aria-labelledby="comments-title" className="mt-14" id="comments">
            <h2 id="comments-title" className="mb-4 text-xl font-semibold text-ink">
              {t('post.comments_title')}
              <span className="ml-2 font-mono text-sm font-normal text-muted">{a.comment_count}</span>
            </h2>
            {error && (
              <p role="alert" className="mb-3 text-sm text-danger">
                {t(`error.${error}`)}
              </p>
            )}
            {me ? (
              <CommentForm subjectType="article" subjectId={a.id} placeholder={t('post.add_comment')} />
            ) : (
              <p className="rounded-card border border-dashed border-line px-4 py-5 text-center text-sm text-muted">
                <a
                  href={`/login?next=${encodeURIComponent(`${loc.pathname}#comments`)}`}
                  className="font-medium text-lapis hover:underline"
                >
                  {t('post.login_to_comment')}
                </a>
              </p>
            )}
            <div className="mt-6">
              {comments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">{t('article.no_comments')}</p>
              ) : (
                <CommentThread
                  items={comments}
                  subjectType="article"
                  subjectId={a.id}
                  signedIn={Boolean(me)}
                  canDownvote={canDownvote}
                />
              )}
            </div>
          </section>
        )}
      </article>

      {showToc && (
        <aside className="hidden lg:block" aria-label={t('article.toc')}>
          <Toc toc={toc} />
        </aside>
      )}
    </div>
  )
}

function SeriesBox({ current, items }: { current: Article; items: Article[] }) {
  const t = useT()
  const tx = useTx()
  const idx = items.findIndex((x) => x.id === current.id)
  return (
    <nav aria-label={t('article.series')} className="mb-10 rounded-card border border-line bg-surface p-5">
      <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
        {t('article.series_part', { n: idx + 1, total: items.length })}
      </p>
      <p className="mt-1 font-semibold text-ink">{tx.text(current.series?.title)}</p>
      <ol className="mt-3 flex flex-col gap-1 text-sm">
        {items.map((x, i) => (
          <li key={x.id} className="flex gap-3">
            <span className="w-5 shrink-0 text-right font-mono text-xs leading-6 text-muted">{i + 1}</span>
            {x.id === current.id ? (
              <span aria-current="page" className="font-medium leading-6 text-ink">
                {tx.text(x.title)}
              </span>
            ) : (
              <a href={x.path} className="leading-6 text-lapis hover:underline">
                {tx.text(x.title)}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
