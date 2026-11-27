import type { Link, LinkKind } from '@buildwith/api-client'
import { Button, cx, Field, Input } from '@buildwith/ui'
import { FileText, Link2, type LucideIcon, MessageCircleQuestion, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Form, redirect, useNavigation } from 'react-router'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { FormFields } from '../components/forms'
import { LinkRow } from '../components/LinkRow'
import { Notice } from '../components/posts/PostTools'
import { actionError, api, readForm, requireMe } from '../lib/api.server'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/submit'

const KINDS: { kind: LinkKind; icon: LucideIcon }[] = [
  { kind: 'ask', icon: MessageCircleQuestion },
  { kind: 'link', icon: Link2 },
  { kind: 'text', icon: FileText },
  { kind: 'show', icon: Sparkles },
]

function kindOf(raw: string | null): LinkKind {
  return KINDS.find((k) => k.kind === raw)?.kind ?? 'link'
}

const hasUrl = (k: LinkKind) => k === 'link' || k === 'show'

export async function loader({ request, context }: Route.LoaderArgs) {
  requireMe(context, request)
  return { kind: kindOf(new URL(request.url).searchParams.get('kind')) }
}

type Values = { kind: LinkKind; title: string; url: string; body_md: string; tags: string }
type SubmitError = { error: string; field?: string; values: Values; existing?: Link }

export async function action({ request, context }: Route.ActionArgs): Promise<SubmitError> {
  requireMe(context, request)
  const { get, csrf } = await readForm(request)
  const values: Values = {
    kind: kindOf(get('kind')),
    title: get('title').trim(),
    url: hasUrl(kindOf(get('kind'))) ? get('url').trim() : '',
    body_md: get('body_md'),
    tags: get('tags'),
  }
  const tags = [
    ...new Set(
      values.tags
        .split(/[,\s]+/)
        .map((s) => s.replace(/^#+/, '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  if (tags.length > 3) return { error: 'too_many_tags', field: 'tags', values }
  if (values.kind === 'link' && !values.url) return { error: 'need_url', field: 'url', values }
  if (values.kind === 'show' && !values.url && !values.body_md.trim())
    return { error: 'show_needs', field: 'body_md', values }

  const res = await api(context, csrf).POST('/links', {
    body: {
      kind: values.kind,
      title: values.title,
      url: values.url || null,
      body_md: values.body_md,
      tags,
    },
  })
  if (res.data) throw redirect(res.data.path)
  if (res.response.status === 409) {
    const existing = (res.error as { existing?: Link } | undefined)?.existing
    return { error: 'duplicate_url', values, existing }
  }
  return { ...actionError(res), values }
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'submit.title', noindex: true })
}

/** The message for a field error: our own checks first, then the API's field. */
function fieldMessage(field: string, code: string): string {
  if (['too_many_tags', 'need_url', 'show_needs'].includes(code)) return `submit.${code}`
  if (code === 'invalid' || code === 'bad_request') {
    return (
      {
        title: 'submit.invalid_title',
        url: 'submit.invalid_url',
        body_md: 'submit.invalid_body',
        tags: 'submit.invalid_tags',
      }[field] ?? 'error.invalid'
    )
  }
  return `error.${code}`
}

export default function Submit({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT()
  const nav = useNavigation()
  const values = actionData?.values
  const [kind, setKind] = useState<LinkKind>(values?.kind ?? loaderData.kind)
  useEffect(() => setKind(loaderData.kind), [loaderData.kind])
  const err = actionData && !actionData.existing ? actionData : null
  const fieldErr = (name: string) => (err?.field === name ? t(fieldMessage(name, err.error)) : undefined)
  const general = err && !err.field ? err.error : null
  const busy = nav.state === 'submitting'

  return (
    <div className="mx-auto max-w-[640px] pt-2">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">{t('submit.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('submit.intro')}</p>
      </header>

      <nav
        aria-label={t('compose.kind')}
        className="grid grid-cols-4 gap-1 rounded-card border border-line bg-sunken p-1"
      >
        {KINDS.map(({ kind: k, icon: Icon }) => {
          const active = k === kind
          return (
            <a
              key={k}
              href={`/submit?kind=${k}`}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                // With JavaScript the switch keeps what was typed; without it the link reloads the form.
                e.preventDefault()
                setKind(k)
                window.history.replaceState(window.history.state, '', `/submit?kind=${k}`)
              }}
              className={cx(
                'flex flex-col items-center justify-center gap-1 rounded-control px-1 py-2 text-xs font-medium transition-colors duration-150 sm:flex-row sm:gap-2 sm:text-sm',
                active
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                  : 'text-muted hover:text-ink',
              )}
            >
              <Icon
                size={17}
                strokeWidth={1.75}
                aria-hidden="true"
                className={active ? 'text-lapis' : undefined}
              />
              <span className="truncate">{t(`kind.${k}`)}</span>
            </a>
          )
        })}
      </nav>
      <p className="mt-2 px-1 text-sm text-muted" aria-live="polite">
        {t(`submit.kind_${kind}`)}
      </p>

      {actionData?.existing && (
        <div className="mt-6 rounded-card border border-line bg-surface px-4 pb-1 pt-3" role="alert">
          <p className="text-sm font-semibold text-ink">{t('post.duplicate')}</p>
          <LinkRow link={actionData.existing} signedIn />
          <p className="border-t border-line py-2 text-xs text-muted">{t('submit.duplicate_body')}</p>
        </div>
      )}
      {general && (
        <Notice tone={general === 'new_account_limit' ? 'warn' : 'danger'} className="mt-6">
          {t(general === 'new_account_limit' ? 'submit.new_account' : `error.${general}`)}
        </Notice>
      )}

      <Form method="post" className="mt-6 flex flex-col gap-5">
        <FormFields />
        <input type="hidden" name="kind" value={kind} />
        <Field
          label={t(kind === 'ask' ? 'compose.question_title' : 'compose.title_label')}
          hint={kind === 'ask' ? t('compose.question_title_hint') : undefined}
          error={fieldErr('title')}
        >
          {(p) => (
            <Input
              {...p}
              name="title"
              required
              minLength={3}
              maxLength={100}
              defaultValue={values?.title}
              autoComplete="off"
            />
          )}
        </Field>

        {hasUrl(kind) && (
          <Field
            label={
              <>
                {t('compose.url')}
                {kind === 'show' && (
                  <span className="ml-1.5 font-normal text-muted">({t('common.optional')})</span>
                )}
              </>
            }
            hint={kind === 'show' ? t('submit.url_show_hint') : undefined}
            error={fieldErr('url')}
          >
            {(p) => (
              <Input
                {...p}
                name="url"
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                translate="no"
                placeholder="https://"
                required={kind === 'link'}
                maxLength={2000}
                defaultValue={values?.url}
                className="font-mono text-sm [font-variant-ligatures:none]"
              />
            )}
          </Field>
        )}

        <Field
          label={
            <>
              {t('compose.details')}
              {kind !== 'text' && kind !== 'ask' && (
                <span className="ml-1.5 font-normal text-muted">({t('common.optional')})</span>
              )}
            </>
          }
          hint={t('compose.markdown_hint')}
          error={fieldErr('body_md')}
        >
          {(p) => (
            <MarkdownEditor
              id={p.id}
              describedBy={p['aria-describedby']}
              name="body_md"
              profile="comment"
              label={t('compose.details')}
              minRows={kind === 'link' ? 4 : 8}
              maxLength={20000}
              placeholder={t(`submit.details_${kind}`)}
              defaultValue={values?.body_md}
            />
          )}
        </Field>

        <Field
          label={
            <>
              {t('compose.tags')}
              <span className="ml-1.5 font-normal text-muted">({t('common.optional')})</span>
            </>
          }
          hint={t('compose.tags_hint')}
          error={fieldErr('tags')}
        >
          {(p) => (
            <Input
              {...p}
              name="tags"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              translate="no"
              placeholder="go, postgres"
              defaultValue={values?.tags}
              className="font-mono text-sm"
            />
          )}
        </Field>

        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            {t.rich('submit.guidelines', {
              guidelines: (c) => (
                <a href="/guidelines" className="text-lapis underline underline-offset-2">
                  {c}
                </a>
              ),
            })}
          </p>
          <Button type="submit" disabled={busy} className="shrink-0">
            {t('common.post')}
          </Button>
        </div>
      </Form>
    </div>
  )
}
