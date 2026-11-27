import type { Comment } from '@buildwith/api-client'
import { Badge, Button, buttonClass, cx, Field, Input, Tag, Textarea } from '@buildwith/ui'
import { ArrowUpRight, MessageCircleQuestion, MessageSquare, Pencil } from 'lucide-react'
import { data, Form, redirect, useNavigation } from 'react-router'
import { CommentForm, CommentThread } from '../components/Comments'
import { FormFields } from '../components/forms'
import { DeleteButton, Notice, ReportButton, Segmented, toolClass } from '../components/posts/PostTools'
import { TimeAgo, UserAvatar } from '../components/UserLine'
import { VoteButton } from '../components/VoteButton'
import { actionError, api, orThrow, readForm, requireMe, viewer } from '../lib/api.server'
import { useMe } from '../lib/hooks'
import { Html, useLang, useT, useTx } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/link'

const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000

function idFrom(raw: string | undefined): number {
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) throw data(null, { status: 404 })
  return id
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const id = idFrom(params.id)
  const url = new URL(request.url)
  const sort: 'best' | 'new' = url.searchParams.get('sort') === 'new' ? 'new' : 'best'
  const client = api(context)
  const [linkRes, commentsRes] = await Promise.all([
    client.GET('/links/{id}', { params: { path: { id } } }),
    client.GET('/comments', {
      params: { query: { subject_type: 'link', subject_id: id, sort, limit: 500 } },
    }),
  ])
  const link = orThrow(linkRes)
  if (params.slug !== link.slug) {
    url.pathname = link.path
    throw redirect(url.pathname + url.search + url.hash, 301)
  }
  const me = viewer(context).me
  const fresh = Date.now() - new Date(link.created_at).getTime() < EDIT_WINDOW_MS
  return {
    link,
    sort,
    comments: commentsRes.data?.items ?? [],
    canEdit: Boolean(link.can_edit && (fresh || me?.is_moderator)),
    editing: url.searchParams.get('edit') === '1',
    error: errorCode(url.searchParams.get('error')),
  }
}

/** Editing your own post: the only page-level form here. */
export async function action({ request, params, context }: Route.ActionArgs) {
  requireMe(context, request)
  const id = idFrom(params.id)
  const { get, csrf } = await readForm(request)
  const body: { title: string; body_md?: string } = { title: get('title').trim() }
  if (get('has_body') === '1') body.body_md = get('body_md')
  const res = await api(context, csrf).PATCH('/links/{id}', { params: { path: { id } }, body })
  if (res.data) throw redirect(res.data.path)
  return { ...actionError(res), title: body.title, body_md: body.body_md ?? '' }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return pageMeta(matches, { titleKey: 'error.not_found_title', noindex: true })
  const l = loaderData.link
  const text = (l.body_md ?? '')
    .replace(/[#*_`>[\]()!~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const excerpt = text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text
  return pageMeta(matches, {
    title: l.title,
    description: excerpt || l.domain || undefined,
    noindex: l.killed,
  })
}

export default function LinkPage({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const me = useMe()
  const { link, comments, sort, canEdit, editing, error } = loaderData
  const signedIn = Boolean(me)
  const isAsk = link.kind === 'ask'
  const loginHref = `/login?next=${encodeURIComponent(link.path)}`
  const showEditor = canEdit && (editing || Boolean(actionData))

  return (
    <div className="mx-auto max-w-[680px]">
      <article aria-labelledby="post-title" className="pt-2">
        {link.killed && (
          <Notice tone="warn" className="mb-5">
            {t('post.dead')}
          </Notice>
        )}
        <div className="flex gap-3 sm:gap-4">
          <div className="w-10 shrink-0 pt-1">
            <VoteButton
              subject="link"
              id={link.id}
              points={link.points}
              vote={link.viewer_vote}
              signedIn={signedIn}
              disabled={link.can_edit}
            />
          </div>
          <div className="min-w-0 flex-1">
            {(link.kind !== 'link' || link.domain) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {link.kind !== 'link' && (
                  <Badge tone={isAsk ? 'lapis' : link.kind === 'show' ? 'turquoise' : 'neutral'}>
                    {t(`kind.${link.kind}`)}
                  </Badge>
                )}
                {link.domain && (
                  <a
                    href={`/new?domain=${encodeURIComponent(link.domain.split('/')[0]!)}`}
                    translate="no"
                    className="font-mono text-xs text-muted hover:text-ink hover:underline"
                  >
                    {link.domain}
                  </a>
                )}
              </div>
            )}
            <h1 id="post-title" className="text-[22px] font-semibold leading-snug text-ink sm:text-2xl">
              {link.url ? (
                <a href={link.url} rel="ugc noopener" className="hover:underline">
                  {tx.text(link.title)}
                </a>
              ) : (
                tx.text(link.title)
              )}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <UserAvatar user={link.author} size={22} />
              <a href={`/@${link.author.username}`} className="font-medium text-ink hover:underline">
                {tx.text(link.author.display_name || link.author.username)}
              </a>
              <a
                href={`/@${link.author.username}`}
                translate="no"
                className="font-mono text-xs hover:underline"
              >
                @{link.author.username}
              </a>
              <span aria-hidden="true">·</span>
              <TimeAgo iso={link.created_at} lang={lang} />
              {link.edited_at && <span className="text-xs">· {t('common.edited')}</span>}
            </div>
          </div>
        </div>

        {showEditor ? (
          <EditForm
            title={actionData?.title ?? link.title}
            bodyMd={actionData ? actionData.body_md : (link.body_md ?? '')}
            hasBody={link.kind !== 'link' || Boolean(link.body_md)}
            cancelHref={link.path}
            error={actionData?.error ?? null}
            field={actionData?.field}
          />
        ) : (
          <>
            {link.body_html && (
              <Html html={link.body_html} className="prose-bw mt-5 text-base text-ink sm:pl-14" />
            )}
            {link.url && (
              <a
                href={link.url}
                rel="ugc noopener"
                className={cx(buttonClass('secondary', 'sm'), 'mt-5 max-w-full sm:ml-14')}
              >
                <span className="truncate">{t('post.open_link')}</span>
                <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden="true" />
              </a>
            )}
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-line pb-3 sm:pl-14">
          {link.tags.map((tag) => (
            <Tag key={tag.slug} slug={tag.slug} className="mr-1" />
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-0.5">
            <a href="#comments" className={toolClass}>
              <MessageSquare size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="font-mono">{link.comment_count}</span>
            </a>
            {canEdit && !showEditor && (
              <a href={`${link.path}?edit=1`} className={toolClass}>
                <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                {t('common.edit')}
              </a>
            )}
            {link.can_edit && <DeleteButton kind="link" id={link.id} redirectTo="/" />}
            {!link.can_edit && (
              <ReportButton
                subjectType="link"
                subjectId={link.id}
                signedIn={signedIn}
                loginHref={loginHref}
              />
            )}
          </span>
        </div>
      </article>

      <Discussion
        isAsk={isAsk}
        linkId={link.id}
        path={link.path}
        count={link.comment_count}
        comments={comments}
        sort={sort}
        signedIn={signedIn}
        canDownvote={(me?.karma ?? 0) >= 100}
        loginHref={loginHref}
        error={error}
        locked={Boolean(link.killed)}
      />
    </div>
  )
}

function EditForm({
  title,
  bodyMd,
  hasBody,
  cancelHref,
  error,
  field,
}: {
  title: string
  bodyMd: string
  hasBody: boolean
  cancelHref: string
  error: string | null
  field?: string
}) {
  const t = useT()
  const nav = useNavigation()
  const fieldError = (name: string) =>
    error && field === name ? t(name === 'title' ? 'submit.invalid_title' : `error.${error}`) : undefined
  return (
    <Form
      method="post"
      className="mt-6 flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:ml-14"
    >
      <FormFields />
      <h2 className="text-sm font-semibold text-ink">{t('post.edit_title')}</h2>
      <Field label={t('compose.title_label')} error={fieldError('title')}>
        {(p) => <Input {...p} name="title" defaultValue={title} required minLength={3} maxLength={100} />}
      </Field>
      {hasBody && (
        <Field label={t('compose.details')} hint={t('compose.markdown_hint')} error={fieldError('body_md')}>
          {(p) => <Textarea {...p} name="body_md" defaultValue={bodyMd} rows={8} maxLength={20000} />}
        </Field>
      )}
      {hasBody && <input type="hidden" name="has_body" value="1" />}
      {error && !field && (
        <p role="alert" className="text-sm text-danger">
          {t(`error.${error}`)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={nav.state === 'submitting'}>
          {t('common.save')}
        </Button>
        <a href={cancelHref} className={buttonClass('ghost', 'sm')}>
          {t('common.cancel')}
        </a>
        <span className="text-xs text-muted">{t('post.edit_hint')}</span>
      </div>
    </Form>
  )
}

function Discussion({
  isAsk,
  linkId,
  path,
  count,
  comments,
  sort,
  signedIn,
  canDownvote,
  loginHref,
  error,
  locked,
}: {
  isAsk: boolean
  linkId: number
  path: string
  count: number
  comments: Comment[]
  sort: 'best' | 'new'
  signedIn: boolean
  canDownvote: boolean
  loginHref: string
  error: string | null
  locked: boolean
}) {
  const t = useT()
  return (
    <section id="comments" aria-labelledby="comments-title" className="mt-8 scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="comments-title" className="text-lg font-semibold text-ink">
          {t(isAsk ? 'post.answers_title' : 'post.comments_title')}{' '}
          <span className="font-mono text-sm font-normal text-muted">({count})</span>
        </h2>
        {comments.length > 1 && (
          <Segmented
            label={t('post.sort_label')}
            items={[
              { href: `${path}#comments`, label: t('post.sort_best'), active: sort === 'best' },
              { href: `${path}?sort=new#comments`, label: t('post.sort_new'), active: sort === 'new' },
            ]}
          />
        )}
      </div>

      {!locked &&
        (signedIn ? (
          isAsk ? (
            <div className="mb-6 rounded-card border border-line bg-surface p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <MessageCircleQuestion
                  size={16}
                  strokeWidth={1.75}
                  className="text-lapis"
                  aria-hidden="true"
                />
                {t('action.answer')}
              </h3>
              <p className="mb-3 mt-1 text-xs text-muted">{t('post.answer_hint')}</p>
              <ErrorLine code={error} />
              <CommentForm
                subjectType="link"
                subjectId={linkId}
                placeholder={t('compose.answer_placeholder')}
              />
            </div>
          ) : (
            <div className="mb-6">
              <ErrorLine code={error} />
              <CommentForm subjectType="link" subjectId={linkId} placeholder={t('post.add_comment')} />
            </div>
          )
        ) : (
          <div className="mb-6 flex flex-col items-start gap-3 rounded-card border border-dashed border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">{t('post.login_body')}</p>
            <a href={loginHref} className={buttonClass('primary', 'sm', 'shrink-0')}>
              {t(isAsk ? 'post.login_to_answer' : 'post.login_to_comment')}
            </a>
          </div>
        ))}

      {comments.length === 0 ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          {t(isAsk ? 'feed.no_answers_yet' : 'post.no_comments_yet')}
        </p>
      ) : (
        <CommentThread
          items={comments}
          subjectType="link"
          subjectId={linkId}
          signedIn={signedIn}
          canDownvote={canDownvote}
        />
      )}
    </section>
  )
}

function ErrorLine({ code }: { code: string | null }) {
  const t = useT()
  if (!code) return null
  return (
    <p role="alert" className="mb-2 text-sm text-danger">
      {t(`error.${code}`)}
    </p>
  )
}

/** Only a plain error code from the URL, never arbitrary text. */
function errorCode(raw: string | null): string | null {
  return raw && /^[a-z_]{2,40}$/.test(raw) ? raw : null
}
