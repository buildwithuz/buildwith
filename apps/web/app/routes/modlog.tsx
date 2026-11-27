import type { ModAction } from '@buildwith/api-client'
import { Avatar, EmptyState } from '@buildwith/ui'
import { Shield } from 'lucide-react'
import type { ReactNode } from 'react'
import { LoadMore } from '../components/LoadMore'
import { TimeAgo } from '../components/UserLine'
import { api, orThrow } from '../lib/api.server'
import { useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/modlog'

export async function loader({ request, context }: Route.LoaderArgs) {
  const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
  const client = api(context)
  const [log, mods] = await Promise.all([
    client.GET('/modlog', { params: { query: { cursor, limit: 40 } } }),
    cursor ? null : client.GET('/moderators'),
  ])
  const page = orThrow(log)
  return { items: page.items, next: page.nextCursor ?? null, moderators: mods?.data?.items ?? [] }
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'mod.log_title' })
}

const SUBJECT_PATH: Record<string, string> = { link: '/l/', comment: '/c/', note: '/n/', article: '/a/' }

/** Where the action's subject lives, when it still has a page. */
function subjectHref(a: ModAction): string | null {
  if (a.subject_type === 'user')
    return (a.action === 'ban' || a.action === 'unban') && a.subject_text ? `/@${a.subject_text}` : null
  const base = SUBJECT_PATH[a.subject_type]
  return base && a.subject_id ? `${base}${a.subject_id}` : null
}

/** The i18n key for "hid a comment", "banned an account", …, or null for an unknown action. */
function sentenceKey(a: ModAction): string | null {
  if (a.action === 'kill' || a.action === 'unkill')
    return SUBJECT_PATH[a.subject_type] ? `modlog.${a.action}.${a.subject_type}` : null
  return ['ban', 'unban', 'feature', 'unfeature', 'rename', 'domain_rule', 'dismiss_report'].includes(
    a.action,
  )
    ? `modlog.${a.action}`
    : null
}

export default function ModLog({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const tx = useTx()
  const { items, next, moderators } = loaderData
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{t('mod.log_title')}</h1>
        <p className="mt-2 text-[17px] leading-relaxed text-muted">{t('mod.log_intro')}</p>
        <a href="/guidelines" className="mt-2 inline-block text-sm text-lapis hover:underline">
          {t('footer.guidelines')} →
        </a>
      </header>

      {moderators.length > 0 && (
        <section
          aria-labelledby="moderators"
          className="mb-10 rounded-card border border-line bg-surface p-4 sm:p-5"
        >
          <h2 id="moderators" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Shield size={15} className="text-plum" aria-hidden="true" />
            {t('mod.moderators')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('modlog.moderators_intro')}</p>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {moderators.map((m) => (
              <li key={m.id}>
                <a href={`/@${m.username}`} className="group flex items-center gap-2.5">
                  <Avatar
                    name={m.display_name || m.username}
                    src={m.avatar_url}
                    accent={m.accent}
                    size={36}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink group-hover:underline">
                      {tx.text(m.display_name || m.username)}
                    </span>
                    <span translate="no" className="block font-mono text-xs text-muted">
                      @{m.username}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="log">
        <h2 id="log" className="sr-only">
          {t('mod.log_title')}
        </h2>
        {items.length === 0 ? (
          <EmptyState title={t('modlog.empty')} />
        ) : (
          <ol className="relative border-l border-line pl-0">
            {items.map((a) => (
              <li key={a.id}>
                <Entry a={a} />
              </li>
            ))}
          </ol>
        )}
        <LoadMore cursor={next} />
      </section>
    </div>
  )
}

function Entry({ a }: { a: ModAction }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const href = subjectHref(a)
  const key = sentenceKey(a)
  const subject = (c: ReactNode) =>
    href ? (
      <a
        href={href}
        className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
      >
        {c}
      </a>
    ) : (
      <span className="font-medium text-ink">{c}</span>
    )
  const sentence = key ? t.rich(key, { s: subject }) : <span className="font-mono text-xs">{a.action}</span>
  // What the subject was called: a username, a domain, an old title.
  const detail =
    a.subject_type === 'user' && (a.action === 'ban' || a.action === 'unban') ? (
      <span translate="no" className="font-mono">
        @{a.subject_text}
      </span>
    ) : a.subject_type === 'domain' ? (
      <span translate="no" className="font-mono">
        {a.subject_text}
      </span>
    ) : a.subject_text && a.action !== 'dismiss_report' ? (
      <span>“{tx.text(a.subject_text)}”</span>
    ) : null

  return (
    <article className="relative py-4 pl-6">
      <span
        aria-hidden="true"
        className="absolute -left-[5px] top-[26px] size-2.5 rounded-full border-2 border-paper bg-plum"
      />
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[15px] leading-relaxed text-ink/90">
        <a
          href={`/@${a.actor.username}`}
          translate="no"
          className="font-mono text-sm font-medium text-ink hover:underline"
        >
          @{a.actor.username}
        </a>
        <span>{sentence}</span>
        {detail && <span className="text-muted">· {detail}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {a.reason && (
          <span className="text-muted">
            <span className="text-xs font-medium uppercase tracking-wide">{t('modlog.reason')}:</span>{' '}
            <span className="text-ink/80">{tx.text(a.reason)}</span>
          </span>
        )}
        {a.reason && (
          <span className="text-muted" aria-hidden="true">
            ·
          </span>
        )}
        <TimeAgo iso={a.created_at} lang={lang} />
      </div>
    </article>
  )
}
