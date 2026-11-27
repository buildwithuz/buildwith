import type { Link } from '@buildwith/api-client'
import { buttonClass, Girih } from '@buildwith/ui'
import { Briefcase, MessageSquare } from 'lucide-react'
import { PersonCard } from '../components/account/PersonCard'
import { TimeAgo } from '../components/UserLine'
import { api, orThrow } from '../lib/api.server'
import { useMe } from '../lib/hooks'
import { useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/ishlar'

export async function loader({ context }: Route.LoaderArgs) {
  const client = api(context)
  const [threads, open] = await Promise.all([
    client.GET('/links', { params: { query: { tag: 'ishlar', sort: 'new', limit: 4 } } }),
    client.GET('/open-to-work', { params: { query: { limit: 48 } } }),
  ])
  return { threads: orThrow(threads).items, people: open.data?.items ?? [] }
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'ishlar.title' })
}

export default function Ishlar({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const me = useMe()
  const { threads, people } = loaderData
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{t('ishlar.title')}</h1>
        <p className="mt-2 text-[17px] leading-relaxed text-muted">{t('ishlar.intro')}</p>
      </header>

      <section aria-labelledby="threads" className="mb-12">
        <h2 id="threads" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('ishlar.this_month')}
        </h2>
        {threads.length === 0 ? (
          <div className="flex items-center gap-4 rounded-card border border-dashed border-line px-5 py-6">
            <Girih size={56} className="shrink-0 text-line" />
            <p className="text-sm text-muted">{t('ishlar.no_threads')}</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {/* Oldest first: the worker opens them in a fixed order on the 1st. */}
            {[...threads].reverse().map((l) => (
              <li key={l.id}>
                <ThreadCard link={l} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="open-to-work">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="open-to-work" className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t('ishlar.open_to_work')}
            {people.length > 0 && (
              <span className="ml-2 font-mono font-normal normal-case">{people.length}</span>
            )}
          </h2>
          {me && !me.open_to_work && (
            <a href="/settings#profile" className="text-sm text-lapis hover:underline">
              {t('ishlar.mark_open')} →
            </a>
          )}
        </div>
        {people.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-line px-5 py-6 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">{t('ishlar.no_open')}</p>
              <p className="mt-1 text-sm text-muted">{t('ishlar.open_hint')}</p>
            </div>
            <a
              href={me ? '/settings#profile' : '/login?next=%2Fsettings%23profile'}
              className={buttonClass('secondary', 'sm')}
            >
              {t('ishlar.mark_open')}
            </a>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((u) => (
              <li key={u.id}>
                <PersonCard user={u} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ThreadCard({ link }: { link: Link }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  return (
    <article className="relative flex h-full gap-3.5 rounded-card border border-line bg-surface p-4 transition-colors duration-150 hover:border-muted/50">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-lapis-soft text-lapis">
        <Briefcase size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium leading-snug text-ink">
          <a href={link.path} className="after:absolute after:inset-0 after:rounded-card hover:underline">
            {tx.text(link.title)}
          </a>
        </h3>
        <p className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={13} aria-hidden="true" />
            {t('count.comments', { count: link.comment_count })}
          </span>
          <span aria-hidden="true">·</span>
          <TimeAgo iso={link.created_at} lang={lang} />
        </p>
      </div>
    </article>
  )
}
