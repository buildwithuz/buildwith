import type { Article, Comment, Link, Note, Profile } from '@buildwith/api-client'
import type { Lang } from '@buildwith/i18n'
import { buttonClass, Card, EmptyState, NavTabs } from '@buildwith/ui'
import { Star } from 'lucide-react'
import { data } from 'react-router'
import { ArticleCard } from '../components/ArticleCard'
import { FormFields } from '../components/forms'
import { LinkRow } from '../components/LinkRow'
import { LoadMore } from '../components/LoadMore'
import { NoteCard } from '../components/NoteCard'
import { renderStatic } from '../components/pages/markdown'
import { StaticPageView } from '../components/pages/StaticPageView'
import { Heatmap } from '../components/profile/Heatmap'
import { ProfileHeader } from '../components/profile/ProfileHeader'
import { TimeAgo } from '../components/UserLine'
import { api, orThrow, viewer } from '../lib/api.server'
import { usernameFrom } from '../lib/handle'
import { useSignedIn } from '../lib/hooks'
import { Html, useLang, useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import { contactSentence } from '../lib/support.server'
import type { Route } from './+types/handle'

const PAGES = ['about', 'guidelines', 'privacy', 'terms'] as const
type PageName = (typeof PAGES)[number]
const TABS = ['notes', 'posts', 'articles', 'replies'] as const
type Tab = (typeof TABS)[number]

const content = import.meta.glob<string>('../content/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function staticPage(name: PageName, lang: Lang) {
  const md = content[`../content/${lang}/${name}.md`] ?? content[`../content/uz/${name}.md`]
  if (!md) throw data(null, { status: 404 })
  return renderStatic(md.replaceAll('{{contact}}', contactSentence(lang)))
}

/** Today's date in Tashkent (UTC+5), so the heatmap ends on the same day for everyone. */
function tashkentToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

type TabData =
  | { tab: 'notes'; items: Note[]; next: string | null }
  | { tab: 'posts'; items: Link[]; next: string | null }
  | { tab: 'articles'; items: Article[]; next: string | null }
  | { tab: 'replies'; items: Comment[]; next: string | null }

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const handle = params.handle
  const v = viewer(context)
  if ((PAGES as readonly string[]).includes(handle)) {
    const name = handle as PageName
    return { kind: 'page' as const, name, page: staticPage(name, v.lang) }
  }
  const username = usernameFrom(handle)
  const url = new URL(request.url)
  const tab: Tab = (TABS as readonly string[]).includes(url.searchParams.get('tab') ?? '')
    ? (url.searchParams.get('tab') as Tab)
    : 'notes'
  const cursor = url.searchParams.get('cursor') ?? undefined
  const client = api(context)
  const path = { params: { path: { username } } }
  const author = { author: username, cursor, limit: 20 }

  const loadTab = async (): Promise<TabData> => {
    if (tab === 'posts') {
      const r = orThrow(await client.GET('/links', { params: { query: { ...author, sort: 'new' } } }))
      return { tab, items: r.items, next: r.nextCursor ?? null }
    }
    if (tab === 'articles') {
      const r = orThrow(await client.GET('/articles', { params: { query: author } }))
      return { tab, items: r.items, next: r.nextCursor ?? null }
    }
    if (tab === 'replies') {
      const r = orThrow(
        await client.GET('/users/{username}/comments', {
          params: { path: { username }, query: { cursor, limit: 20 } },
        }),
      )
      return { tab, items: r.items, next: r.nextCursor ?? null }
    }
    const r = orThrow(await client.GET('/notes', { params: { query: author } }))
    return { tab: 'notes', items: r.items, next: r.nextCursor ?? null }
  }

  const [profile, heatmap, list] = await Promise.all([
    client.GET('/users/{username}', path).then(orThrow),
    client.GET('/users/{username}/heatmap', path),
    loadTab(),
  ])
  const me = v.me
  return {
    kind: 'profile' as const,
    profile: profile as Profile,
    heatmap: heatmap.data?.items ?? [],
    today: tashkentToday(),
    list,
    isOwner: me?.id === profile.user.id,
  }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return pageMeta(matches, { titleKey: 'error.not_found_title' })
  if (loaderData.kind === 'page') {
    return pageMeta(matches, {
      title: loaderData.page.title,
      description: loaderData.page.lead.replace(/<[^>]+>/g, ''),
    })
  }
  const u = loaderData.profile.user
  return pageMeta(matches, {
    title: `${u.display_name || u.username} (@${u.username})`,
    description: u.bio || undefined,
    image: u.avatar_url ?? undefined,
  })
}

export default function Handle({ loaderData }: Route.ComponentProps) {
  if (loaderData.kind === 'page') return <StaticPageView name={loaderData.name} page={loaderData.page} />
  return <ProfilePage {...loaderData} />
}

function ProfilePage({
  profile,
  heatmap,
  today,
  list,
  isOwner,
}: Extract<Route.ComponentProps['loaderData'], { kind: 'profile' }>) {
  const t = useT()
  const { user, relation, counts, stack, repos } = profile
  const signedIn = useSignedIn()
  const blocked = relation?.blocking ?? false
  const base = `/@${user.username}`
  const tabs = [
    { key: 'notes', label: t('profile.tab_notes'), count: counts.notes },
    { key: 'posts', label: t('profile.tab_posts'), count: counts.links },
    { key: 'articles', label: t('profile.tab_articles'), count: counts.articles },
    { key: 'replies', label: t('profile.tab_comments'), count: counts.comments },
  ] as const

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader profile={profile} isOwner={isOwner} signedIn={signedIn} />

      {blocked ? (
        <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-ink">{t('profile.blocked_notice')}</p>
            <p className="mt-1 text-sm text-muted">{t('profile.blocked_body')}</p>
          </div>
          <form method="post" action="/actions/relation">
            <FormFields />
            <input type="hidden" name="username" value={user.username} />
            <button type="submit" name="intent" value="unblock" className={buttonClass('secondary', 'sm')}>
              {t('action.unblock')}
            </button>
          </form>
        </Card>
      ) : (
        <>
          <section
            aria-labelledby="activity-title"
            className="rounded-card border border-line bg-surface px-4 py-4 sm:px-5"
          >
            <h2 id="activity-title" className="sr-only">
              {t('profile.activity')}
            </h2>
            <Heatmap days={heatmap} today={today} />
          </section>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
            <div className="flex min-w-0 flex-col gap-8">
              <section aria-labelledby="readme-title">
                <h2
                  id="readme-title"
                  className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted"
                >
                  {t('profile.readme')}
                </h2>
                {profile.readme_html ? (
                  <Html html={profile.readme_html} className="prose-bw text-[15px] text-ink" />
                ) : (
                  <p className="text-sm text-muted">
                    {isOwner
                      ? t.rich('profile.readme_empty_owner', {
                          a: (c) => (
                            <a href="/settings" className="text-lapis hover:underline">
                              {c}
                            </a>
                          ),
                        })
                      : t('profile.readme_empty')}
                  </p>
                )}
              </section>

              {stack.length > 0 && (
                <section aria-labelledby="stack-title">
                  <h2
                    id="stack-title"
                    className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted"
                  >
                    {t('profile.stack')}
                  </h2>
                  <ul className="flex flex-wrap gap-1.5">
                    {stack.map((s) => (
                      <li
                        key={s}
                        translate="no"
                        className="rounded-control border border-line bg-surface px-2 py-0.5 font-mono text-xs text-ink"
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {repos.length > 0 && (
                <section aria-labelledby="repos-title">
                  <h2
                    id="repos-title"
                    className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted"
                  >
                    {t('profile.repos')}
                  </h2>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {repos.map((r) => (
                      <li key={r.full_name}>
                        <a
                          href={r.url}
                          rel="noopener"
                          className="flex h-full flex-col gap-1.5 rounded-card border border-line bg-surface p-3 transition-colors duration-150 hover:border-lapis"
                        >
                          <span translate="no" className="truncate font-mono text-sm font-medium text-lapis">
                            {r.full_name.split('/').pop()}
                          </span>
                          {r.description && (
                            <span className="line-clamp-2 text-xs leading-relaxed text-muted">
                              {r.description}
                            </span>
                          )}
                          <span className="mt-auto flex items-center gap-3 pt-1 text-xs text-muted">
                            {r.language && (
                              <span className="inline-flex items-center gap-1.5" translate="no">
                                <span className="size-2 rounded-full bg-lapis" aria-hidden="true" />
                                {r.language}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 font-mono">
                              <Star size={12} aria-hidden="true" />
                              <span className="sr-only">{t('profile.stars')}</span>
                              {r.stars ?? 0}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <section aria-label={t('profile.posts_label')} className="min-w-0">
              <NavTabs
                label={t('profile.posts_label')}
                tabs={tabs.map((x) => ({
                  href: x.key === 'notes' ? base : `${base}?tab=${x.key}`,
                  label: x.label,
                  count: x.count,
                  active: list.tab === x.key,
                }))}
              />
              <TabList list={list} signedIn={signedIn} />
              <LoadMore cursor={list.next} />
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function TabList({ list, signedIn }: { list: TabData; signedIn: boolean }) {
  const t = useT()
  const { lang } = useLang()
  if (list.items.length === 0) {
    return <EmptyState title={t(`profile.empty_${list.tab}`)} />
  }
  switch (list.tab) {
    case 'notes':
      return (
        <ol className="divide-y divide-line">
          {list.items.map((n) => (
            <li key={n.id}>
              <NoteCard note={n} signedIn={signedIn} />
            </li>
          ))}
        </ol>
      )
    case 'posts':
      return (
        <ol className="divide-y divide-line">
          {list.items.map((l) => (
            <li key={l.id}>
              <LinkRow link={l} signedIn={signedIn} />
            </li>
          ))}
        </ol>
      )
    case 'articles':
      return (
        <ol className="divide-y divide-line">
          {list.items.map((a) => (
            <li key={a.id}>
              <ArticleCard a={a} />
            </li>
          ))}
        </ol>
      )
    case 'replies':
      return (
        <ol className="divide-y divide-line">
          {list.items.map((c) => (
            <li key={c.id} className="py-3">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span>
                  {t(c.subject_type === 'article' ? 'profile.reply_on_article' : 'profile.reply_on_post')}
                </span>
                <span aria-hidden="true">·</span>
                <TimeAgo iso={c.created_at} lang={lang} />
                <span aria-hidden="true">·</span>
                <span className="font-mono">{t('count.points', { count: c.points })}</span>
              </div>
              {c.deleted || c.killed ? (
                <p className="text-sm italic text-muted">
                  {t(c.deleted ? 'common.deleted' : 'common.removed')}
                </p>
              ) : (
                <Html html={c.body_html} className="prose-bw line-clamp-6 text-[15px] text-ink" />
              )}
              <a
                href={`/c/${c.id}`}
                className="mt-1.5 inline-block text-xs font-medium text-lapis hover:underline"
              >
                {t('profile.reply_open')}
              </a>
            </li>
          ))}
        </ol>
      )
  }
}
