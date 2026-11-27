import type { Notification } from '@buildwith/api-client'
import { Avatar, buttonClass, cx, EmptyState } from '@buildwith/ui'
import {
  AtSign,
  Award,
  CheckCheck,
  FileText,
  Heart,
  type LucideIcon,
  MessageCircle,
  MessageSquare,
  Quote,
  Repeat2,
  Shield,
  Star,
  UserPlus,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { data, type ShouldRevalidateFunctionArgs, useFetcher } from 'react-router'
import { FormFields, useCsrf } from '../components/forms'
import { LoadMore } from '../components/LoadMore'
import { TimeAgo } from '../components/UserLine'
import { actionError, api, finish, orThrow, readForm, requireMe } from '../lib/api.server'
import { useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/notifications'

const ICONS: Record<Notification['kind'], LucideIcon> = {
  reply: MessageCircle,
  mention: AtSign,
  like: Heart,
  repost: Repeat2,
  quote: Quote,
  follow: UserPlus,
  comment: MessageSquare,
  article_published: FileText,
  mod_action: Shield,
  badge: Award,
  featured: Star,
}

const TONE: Partial<Record<Notification['kind'], string>> = {
  like: 'bg-danger',
  follow: 'bg-turquoise',
  reply: 'bg-lapis',
  mention: 'bg-lapis',
  comment: 'bg-lapis',
  quote: 'bg-lapis',
  article_published: 'bg-lapis',
  repost: 'bg-moss',
  featured: 'bg-saffron',
  badge: 'bg-saffron',
  mod_action: 'bg-plum',
}

export async function loader({ request, context }: Route.LoaderArgs) {
  requireMe(context, request)
  const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
  const page = orThrow(await api(context).GET('/notifications', { params: { query: { cursor, limit: 30 } } }))
  return { items: page.items, next: page.nextCursor ?? null, unread: page.unread, paged: Boolean(cursor) }
}

export async function action({ request, context }: Route.ActionArgs) {
  requireMe(context, request)
  const { csrf, js } = await readForm(request)
  const res = await api(context, csrf).POST('/notifications/read', { body: {} })
  if (!res.response.ok) return data(actionError(res), { status: res.response.status })
  return finish(request, js, { ok: true }, '/notifications')
}

// Marking read in the background must not wipe the unread dots the reader is looking at.
export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formData?.get('quiet') === '1') return false
  return defaultShouldRevalidate
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'notifications.title', noindex: true })
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const { items, next, unread } = loaderData
  const csrf = useCsrf()
  const mark = useFetcher<{ ok?: boolean }>()
  const quiet = useFetcher()
  const sent = useRef(false)

  // Opening the page counts as reading it; the bell clears, the dots stay until next visit.
  useEffect(() => {
    if (unread > 0 && !sent.current) {
      sent.current = true
      quiet.submit({ _csrf: csrf, _js: '1', quiet: '1' }, { method: 'post' })
    }
  }, [unread, csrf, quiet])

  const allRead = mark.data?.ok || mark.state !== 'idle'
  const caughtUp = allRead || Boolean(quiet.data)
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('notifications.title')}</h1>
          {unread > 0 && !caughtUp && (
            <p className="mt-0.5 text-sm text-muted">{t('notifications.unread', { count: unread })}</p>
          )}
        </div>
        {unread > 0 && !caughtUp && (
          <mark.Form method="post">
            <FormFields />
            <button type="submit" className={buttonClass('secondary', 'sm')}>
              <CheckCheck size={15} aria-hidden="true" /> {t('notifications.mark_all')}
            </button>
          </mark.Form>
        )}
      </header>
      {items.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState title={t('notifications.empty')}>{t('notifications.empty_body')}</EmptyState>
        </div>
      ) : (
        <ol className="overflow-hidden rounded-card border border-line bg-surface">
          {items.map((n) => (
            <li key={n.id} className="border-b border-line last:border-b-0">
              <Row n={n} unread={!n.read && !allRead} />
            </li>
          ))}
        </ol>
      )}
      <LoadMore cursor={next} />
    </div>
  )
}

function Row({ n, unread }: { n: Notification; unread: boolean }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const Icon = ICONS[n.kind] ?? MessageCircle
  const name = n.actor ? tx.text(n.actor.display_name || n.actor.username) : t('notifications.someone')
  // The actor's name is bold inside the translated sentence.
  const sentence = t.rich(
    `notify.${n.kind}`,
    {},
    { actor: (<strong className="font-semibold text-ink">{name}</strong>) as unknown as string },
  )
  const body = (
    <>
      <span className="relative shrink-0">
        {n.actor ? (
          <Avatar
            name={n.actor.display_name || n.actor.username}
            src={n.actor.avatar_url}
            accent={n.actor.accent}
            size={40}
          />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-sunken text-muted">
            <Icon size={18} aria-hidden="true" />
          </span>
        )}
        {n.actor && (
          <span
            className={cx(
              'absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full text-on-accent ring-2 ring-surface',
              TONE[n.kind] ?? 'bg-muted',
            )}
          >
            <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug text-ink/90">{sentence}</span>
        <span className="mt-0.5 block">
          <TimeAgo iso={n.created_at} lang={lang} />
        </span>
      </span>
      {unread && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-lapis">
          <span className="sr-only">{t('notifications.unread_label')}</span>
        </span>
      )}
    </>
  )
  const cls = cx(
    'flex items-start gap-3 px-4 py-3.5 transition-colors duration-150',
    unread && 'bg-lapis-soft/40',
  )
  return n.href ? (
    <a href={n.href} className={cx(cls, 'hover:bg-sunken focus-visible:bg-sunken')}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  )
}
