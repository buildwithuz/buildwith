import type { Article } from '@buildwith/api-client'
import { Badge, Button, EmptyState } from '@buildwith/ui'
import { CalendarClock, FileText, Plus } from 'lucide-react'
import { Form, redirect, useNavigation } from 'react-router'
import { FormFields } from '../components/forms'
import { actionError, api, orThrow, readForm, requireMe } from '../lib/api.server'
import { useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import { ago, formatDate } from '../lib/time'
import type { Route } from './+types/write-list'

export async function loader({ request, context }: Route.LoaderArgs) {
  requireMe(context, request)
  const res = orThrow(await api(context).GET('/articles/mine', { params: { query: { limit: 100 } } }))
  const by = (s: Article['status']) => res.items.filter((a) => a.status === s)
  const error = new URL(request.url).searchParams.get('error')
  return { drafts: by('draft'), scheduled: by('scheduled'), published: by('published'), error }
}

export async function action({ request, context }: Route.ActionArgs) {
  requireMe(context, request)
  const { csrf } = await readForm(request)
  const res = await api(context, csrf).POST('/articles', { body: {} })
  if (!res.data) return actionError(res)
  throw redirect(`/write/${res.data.id}`)
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'nav.my_articles', noindex: true })
}

function NewArticleButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const t = useT()
  const nav = useNavigation()
  return (
    <Form method="post" action="/write">
      <FormFields />
      <Button
        type="submit"
        variant={variant}
        size="sm"
        disabled={nav.state !== 'idle' && nav.formAction === '/write'}
      >
        <Plus size={15} aria-hidden="true" /> {t('article.new')}
      </Button>
    </Form>
  )
}

export default function WriteList({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT()
  const { drafts, scheduled, published, error } = loaderData
  const err = actionData?.error ?? error
  const empty = drafts.length + scheduled.length + published.length === 0
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[28px] font-semibold leading-tight text-ink">
            {t('nav.my_articles')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('write.list_intro')}</p>
        </div>
        <NewArticleButton />
      </div>
      {err && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {t(`error.${err}`)}
        </p>
      )}
      {empty ? (
        <EmptyState title={t('article.mine_empty')} action={<NewArticleButton variant="secondary" />}>
          {t('write.empty_body')}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-10">
          <Group title={t('write.drafts')} items={drafts} kind="draft" />
          <Group title={t('article.scheduled')} items={scheduled} kind="scheduled" />
          <Group title={t('article.published')} items={published} kind="published" />
        </div>
      )}
    </div>
  )
}

function Group({ title, items, kind }: { title: string; items: Article[]; kind: Article['status'] }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  if (items.length === 0) return null
  const id = `group-${kind}`
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        className="mb-2 flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider text-muted"
      >
        {title}
        <span className="rounded-full bg-sunken px-1.5 text-[11px] text-muted">{items.length}</span>
      </h2>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {items.map((a) => (
          <li
            key={a.id}
            className="relative flex items-start gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-sunken/60"
          >
            <div className="min-w-0 flex-1">
              <a
                href={`/write/${a.id}`}
                className="font-medium text-ink after:absolute after:inset-0 hover:underline"
              >
                {a.title && a.title !== 'Untitled' ? (
                  tx.text(a.title)
                ) : (
                  <span className="italic text-muted">{t('write.untitled')}</span>
                )}
              </a>
              {a.subtitle && <p className="mt-0.5 truncate text-sm text-muted">{tx.text(a.subtitle)}</p>}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                {kind === 'scheduled' && a.scheduled_at ? (
                  <span className="inline-flex items-center gap-1 text-saffron">
                    <CalendarClock size={13} aria-hidden="true" />
                    {t('article.scheduled_for', { date: formatDate(a.scheduled_at, lang, true) })}
                  </span>
                ) : kind === 'published' && a.published_at ? (
                  <span>{formatDate(a.published_at, lang)}</span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <FileText size={13} aria-hidden="true" />
                    <time
                      dateTime={a.updated_at ?? a.created_at}
                      title={formatDate(a.updated_at ?? a.created_at, lang, true)}
                    >
                      {t('write.edited_ago', { ago: ago(a.updated_at ?? a.created_at, lang) })}
                    </time>
                  </span>
                )}
                <span>· {t('count.minutes_read', { count: a.reading_minutes })}</span>
                {kind === 'published' && (
                  <>
                    <span>· {t('count.points', { count: a.points })}</span>
                    <span>· {t('count.comments', { count: a.comment_count })}</span>
                  </>
                )}
                {a.featured && <Badge tone="lapis">{t('article.featured')}</Badge>}
              </p>
            </div>
            {kind === 'published' && (
              <a
                href={a.path}
                className="relative z-10 shrink-0 text-xs font-medium text-lapis hover:underline"
              >
                {t('write.view')}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
