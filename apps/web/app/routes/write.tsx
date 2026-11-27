import type { Article, Schemas } from '@buildwith/api-client'
import type { Lang } from '@buildwith/i18n'
import { forSearch } from '@buildwith/translit'
import { Badge, Button, buttonClass, cx, Field, Input, Select } from '@buildwith/ui'
import { ArrowLeft, CalendarClock, ChevronDown, ExternalLink, Save, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { data, Form, redirect, useFetcher, useNavigation } from 'react-router'
import { CoverPicker } from '../components/editor/CoverPicker'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { VersionsDialog } from '../components/editor/VersionsDialog'
import { FormFields, useHydrated } from '../components/forms'
import { type ActionError, actionError, api, orThrow, readForm, requireMe, viewer } from '../lib/api.server'
import { useLang, useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import { formatDate } from '../lib/time'
import type { Route } from './+types/write'

type ArticleEdit = Schemas['ArticleEdit']
type Result = { article: Article; intent: string } | (ActionError & { intent: string })

const AUTOSAVE_MS = 10_000
// The API's placeholder title for a fresh draft; shown as an empty field.
const UNTITLED = 'Untitled'

export async function loader({ params, request, context }: Route.LoaderArgs) {
  requireMe(context, request)
  const client = api(context)
  if (params.id === 'new') {
    // A cross-site link must not create drafts on someone's behalf.
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw redirect('/write')
    const res = await client.POST('/articles', { body: {} })
    if (!res.data) throw redirect(`/write?error=${actionError(res).error}`)
    throw redirect(`/write/${res.data.id}`)
  }
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw data(null, { status: 404 })
  const article = orThrow(await client.GET('/articles/{id}', { params: { path: { id } } }))
  if (!article.can_edit || article.author.id !== viewer(context).me?.id) throw data(null, { status: 404 })
  const saved = new URL(request.url).searchParams.get('saved') === '1'
  return { article, saved }
}

/** The API's slug rule (internal/slug): Latin, lowercase ASCII words joined by dashes. */
function slugify(title: string): string {
  return forSearch(title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
}

/**
 * New drafts start as "untitled-x1y2". Until the author sets an address of
 * their own, a draft's address follows its title (keeping the random suffix).
 */
function draftSlug(get: (k: string) => string): string | undefined {
  const slug = get('slug').trim()
  const orig = get('slug_orig')
  if (get('slug_auto') !== '1' || slug !== orig) return slug || undefined
  const suffix = orig.split('-').pop() ?? ''
  const wasAuto = orig === `untitled-${suffix}` || orig === `${slugify(get('title_orig'))}-${suffix}`
  const base = slugify(get('title'))
  return wasAuto && base ? `${base}-${suffix}` : slug || undefined
}

function editFrom(get: (k: string) => string): ArticleEdit {
  const tags = get('tags')
    .split(/[,\s]+/)
    .map((s) => s.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean)
  return {
    title: get('title').trim() || UNTITLED,
    subtitle: get('subtitle').trim(),
    body_md: get('body_md'),
    lang: (['uz', 'ru', 'en'].includes(get('lang')) ? get('lang') : 'uz') as Lang,
    canonical_url: get('canonical_url').trim() || null,
    cover_media_id: get('cover_media_id') ? Number(get('cover_media_id')) : null,
    slug: draftSlug(get),
    tags: [...new Set(tags)],
  }
}

export async function action({ params, request, context }: Route.ActionArgs) {
  requireMe(context, request)
  const { get, csrf, js, intent } = await readForm(request)
  const id = Number(params.id)
  const client = api(context, csrf)
  const path = { params: { path: { id } } }
  const fail = (res: { error?: unknown; response: Response }) => ({ ...actionError(res), intent })

  if (intent === 'delete') {
    const res = await client.DELETE('/articles/{id}', path)
    if (!res.response.ok) return fail(res)
    throw redirect('/write')
  }
  if (intent === 'unpublish') {
    const res = await client.POST('/articles/{id}/unpublish', path)
    if (!res.data) return fail(res)
    throw redirect(`/write/${id}`)
  }

  const saved = await client.PUT('/articles/{id}', { ...path, body: editFrom(get) })
  if (!saved.data) return fail(saved)

  if (intent === 'publish' || intent === 'schedule') {
    const at = intent === 'schedule' && get('at') ? new Date(`${get('at')}:00+05:00`).toISOString() : null
    if (intent === 'schedule' && !at) return { error: 'invalid', field: 'at', intent }
    const res = await client.POST('/articles/{id}/publish', { ...path, body: { at } })
    if (!res.data) return fail(res)
    throw redirect(res.data.status === 'published' ? res.data.path : `/write/${id}`)
  }
  if (!js) throw redirect(`/write/${id}?saved=1`)
  return { article: saved.data, intent }
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  return pageMeta(matches, {
    title: loaderData?.article.title || undefined,
    titleKey: 'article.new',
    noindex: true,
  })
}

/** "14:05" in Tashkent time. */
function clock(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 3600 * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** The form's content, minus the plumbing fields, to tell whether anything changed. */
function snapshot(form: HTMLFormElement | null): string {
  if (!form) return ''
  const fd = new FormData(form)
  for (const k of ['_csrf', '_js', 'intent', 'at', 'slug_orig', 'title_orig', 'slug_auto']) fd.delete(k)
  return JSON.stringify([...fd.entries()].map(([k, v]) => [k, String(v)]))
}

export default function Write({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT()
  const { lang } = useLang()
  const hydrated = useHydrated()
  const { article: a, saved } = loaderData
  const nav = useNavigation()
  const autosave = useFetcher<Result>()
  const formRef = useRef<HTMLFormElement>(null)
  const slugRef = useRef<HTMLInputElement>(null)
  const slugOrigRef = useRef<HTMLInputElement>(null)
  const titleOrigRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(a.title === UNTITLED ? '' : a.title)
  const [body, setBody] = useState(a.body_md ?? '')
  const [minutes, setMinutes] = useState(a.reading_minutes)
  const [savedAt, setSavedAt] = useState<string>(a.updated_at ?? a.created_at)
  const [dirty, setDirty] = useState(false)
  const baseline = useRef<string>('')
  const inFlight = useRef<string | null>(null)
  const published = a.status === 'published'
  // A published article changes for readers on save, so it is saved on purpose only.
  const autosaves = !published

  useEffect(() => {
    baseline.current = snapshot(formRef.current)
  }, [])

  const check = useCallback(() => {
    setDirty(snapshot(formRef.current) !== baseline.current)
  }, [])

  const saveNow = useCallback(() => {
    const form = formRef.current
    if (!form || autosave.state !== 'idle') return
    const fd = new FormData(form)
    fd.set('intent', 'save')
    fd.set('_js', '1')
    inFlight.current = snapshot(form)
    autosave.submit(fd, { method: 'post' })
  }, [autosave])

  // Autosave every 10 s while there are unsaved changes.
  useEffect(() => {
    if (!autosaves || !dirty) return
    const timer = window.setInterval(saveNow, AUTOSAVE_MS)
    return () => window.clearInterval(timer)
  }, [autosaves, dirty, saveNow])

  // A finished save moves the baseline and picks up what the server decided (slug).
  const last = autosave.data ?? actionData
  useEffect(() => {
    if (autosave.state !== 'idle' || !autosave.data) return
    if ('article' in autosave.data) {
      if (inFlight.current !== null) baseline.current = inFlight.current
      setSavedAt(autosave.data.article.updated_at ?? new Date().toISOString())
      if (slugOrigRef.current) slugOrigRef.current.value = autosave.data.article.slug
      if (titleOrigRef.current) titleOrigRef.current.value = autosave.data.article.title
      const slug = slugRef.current
      if (slug && document.activeElement !== slug && slug.value !== autosave.data.article.slug) {
        slug.value = autosave.data.article.slug
        baseline.current = snapshot(formRef.current)
      }
    }
    inFlight.current = null
    check()
  }, [autosave.state, autosave.data, check])

  useEffect(() => {
    if (actionData && 'article' in actionData) {
      baseline.current = snapshot(formRef.current)
      setSavedAt(actionData.article.updated_at ?? new Date().toISOString())
      check()
    }
  }, [actionData, check])

  // Warn before leaving with unsaved text; ⌘S saves.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (snapshot(formRef.current) !== baseline.current && nav.state === 'idle') e.preventDefault()
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('keydown', onKey)
    }
  }, [saveNow, nav.state])

  const err = last && 'error' in last ? last : null
  const fieldError = (f: string) => (err?.field === f ? t(`error.${err.error}`) : undefined)
  const submitting = nav.state === 'submitting'
  const saving = autosave.state !== 'idle' || (submitting && nav.formData?.get('intent') === 'save')

  const status = saving
    ? t('article.saving')
    : dirty
      ? t('article.unsaved')
      : hydrated
        ? t(autosaves ? 'article.autosaved' : 'write.saved_at', { time: clock(savedAt) })
        : saved
          ? t('common.saved')
          : t('write.last_saved', { date: formatDate(savedAt, lang, true) })

  return (
    <Form
      ref={formRef}
      method="post"
      onInput={check}
      onChange={check}
      className="mx-auto flex w-full max-w-5xl flex-col"
      aria-labelledby="editor-heading"
    >
      <FormFields />
      <input ref={slugOrigRef} type="hidden" name="slug_orig" defaultValue={a.slug} />
      <input ref={titleOrigRef} type="hidden" name="title_orig" defaultValue={a.title} />
      <input type="hidden" name="slug_auto" value={a.published_at ? '0' : '1'} />
      <h1 id="editor-heading" className="sr-only">
        {t(published ? 'write.editing' : 'article.new')}
      </h1>

      {/* Top bar */}
      <div className="sticky top-14 z-20 -mx-4 mb-6 flex items-center gap-2 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur-sm">
        <a
          href="/write"
          aria-label={t('nav.my_articles')}
          title={t('nav.my_articles')}
          className={buttonClass('ghost', 'sm', 'w-8 px-0!')}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </a>
        <Badge
          tone={published ? 'turquoise' : a.status === 'scheduled' ? 'saffron' : 'neutral'}
          className="hidden sm:inline-flex"
        >
          {t(`article.${a.status}`)}
        </Badge>
        <p
          role="status"
          aria-live="polite"
          className={cx('min-w-0 truncate text-xs', dirty && !saving ? 'text-saffron' : 'text-muted')}
        >
          {status}
          <span className="hidden sm:inline"> · {t('count.minutes_read', { count: minutes })}</span>
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {hydrated && (
            <VersionsDialog
              articleId={a.id}
              onRestore={(v) => {
                setTitle(v.title)
                setBody(v.body_md)
                window.setTimeout(check, 0)
              }}
            />
          )}
          {published && (
            <a href={a.path} className={buttonClass('ghost', 'sm')} title={t('write.view')}>
              <ExternalLink size={15} aria-hidden="true" />
              <span className="hidden md:inline">{t('write.view')}</span>
            </a>
          )}
          <Button
            type="submit"
            name="intent"
            value="save"
            variant={published ? 'primary' : 'secondary'}
            size="sm"
            disabled={saving}
            aria-label={t(published ? 'write.update' : 'common.save')}
            className={published ? undefined : 'w-8 px-0! sm:w-auto sm:px-3!'}
          >
            {!published && <Save size={15} aria-hidden="true" className="sm:hidden" />}
            <span className={published ? undefined : 'hidden sm:inline'}>
              {t(published ? 'write.update' : 'common.save')}
            </span>
          </Button>
          {!published && <PublishMenu scheduled={a.status === 'scheduled'} atError={fieldError('at')} />}
        </div>
      </div>

      {err && !err.field && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-danger/30 bg-surface px-3 py-2 text-sm text-danger"
        >
          {t(`error.${err.error}`)}
        </p>
      )}
      {a.status === 'scheduled' && a.scheduled_at && (
        <p className="mb-4 inline-flex items-center gap-2 text-sm text-saffron">
          <CalendarClock size={15} aria-hidden="true" />
          {t('article.scheduled_for', { date: formatDate(a.scheduled_at, lang, true) })}
        </p>
      )}

      {/* Cover, title, subtitle */}
      <div className="mx-auto w-full max-w-[760px]">
        <CoverPicker initial={a.cover ? { id: a.cover.id, url: a.cover.url } : null} onChange={check} />
        <label htmlFor="title" className="sr-only">
          {t('article.title_placeholder')}
        </label>
        <textarea
          id="title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          rows={1}
          maxLength={140}
          placeholder={t('article.title_placeholder')}
          aria-invalid={fieldError('title') ? true : undefined}
          className="mt-3 block w-full resize-none bg-transparent font-serif text-[30px] font-semibold leading-tight text-ink [field-sizing:content] placeholder:text-muted/60 focus:outline-none sm:text-[38px]"
        />
        {fieldError('title') && <p className="text-xs text-danger">{fieldError('title')}</p>}
        <label htmlFor="subtitle" className="sr-only">
          {t('article.subtitle_placeholder')}
        </label>
        <input
          id="subtitle"
          name="subtitle"
          defaultValue={a.subtitle ?? ''}
          maxLength={200}
          placeholder={t('article.subtitle_placeholder')}
          className="mt-2 block w-full bg-transparent font-serif text-xl text-muted placeholder:text-muted/60 focus:outline-none"
        />
      </div>

      <MarkdownEditor
        name="body_md"
        profile="article"
        uploadKind="article"
        value={body}
        onChange={setBody}
        label={t('write.body_label')}
        placeholder={t('article.body_placeholder')}
        minRows={18}
        onSubmitShortcut={saveNow}
        onPreview={(r) => setMinutes(r.reading_minutes)}
        className="mt-6"
      />
      {fieldError('body_md') && <p className="mt-1 text-xs text-danger">{fieldError('body_md')}</p>}

      {/* Details */}
      <section
        aria-labelledby="details-title"
        className="mt-8 rounded-card border border-line bg-surface p-5"
      >
        <h2 id="details-title" className="mb-4 text-base font-semibold text-ink">
          {t('write.details')}
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('compose.tags')} hint={t('write.tags_hint')} error={fieldError('tags')}>
            {(p) => (
              <Input
                {...p}
                name="tags"
                defaultValue={a.tags.map((x) => x.slug).join(', ')}
                placeholder="go, postgres"
                translate="no"
              />
            )}
          </Field>
          <Field label={t('article.lang')} error={fieldError('lang')}>
            {(p) => (
              <Select {...p} name="lang" defaultValue={a.lang ?? 'uz'}>
                <option value="uz">Oʻzbekcha</option>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </Select>
            )}
          </Field>
          <Field
            label={t('article.slug')}
            hint={t('write.slug_hint', { path: `/@${a.author.username}/${a.slug || '…'}` })}
            error={fieldError('slug')}
          >
            {(p) => (
              <Input
                {...p}
                ref={slugRef}
                name="slug"
                defaultValue={a.slug}
                maxLength={120}
                translate="no"
                className="font-mono text-sm"
              />
            )}
          </Field>
          <Field
            label={t('write.canonical_label')}
            hint={t('write.canonical_hint')}
            error={fieldError('canonical_url')}
          >
            {(p) => (
              <Input
                {...p}
                type="url"
                name="canonical_url"
                defaultValue={a.canonical_url ?? ''}
                placeholder="https://"
                translate="no"
              />
            )}
          </Field>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          {published || a.status === 'scheduled' ? (
            <Button
              type="submit"
              name="intent"
              value="unpublish"
              variant="secondary"
              size="sm"
              formNoValidate
            >
              {t('article.unpublish')}
            </Button>
          ) : (
            <span />
          )}
          <details className="group relative">
            <summary className={buttonClass('danger', 'sm', 'cursor-pointer list-none marker:hidden')}>
              {t('common.delete')}
            </summary>
            <div className="absolute bottom-full right-0 z-30 mb-2 w-[min(16rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
              <p className="text-sm text-ink">{t('write.delete_confirm')}</p>
              <button
                type="submit"
                name="intent"
                value="delete"
                formNoValidate
                className={buttonClass('danger', 'sm', 'mt-3 w-full')}
              >
                {t('write.delete_yes')}
              </button>
            </div>
          </details>
        </div>
      </section>
    </Form>
  )
}

/**
 * Publish now or at a chosen time. A <details> popover, so it works without
 * JavaScript; both buttons submit the whole editor form.
 */
function PublishMenu({ scheduled, atError }: { scheduled: boolean; atError?: string }) {
  const t = useT()
  return (
    <details className="group relative" open={atError ? true : undefined}>
      <summary className={buttonClass('primary', 'sm', 'cursor-pointer list-none marker:hidden')}>
        <Send size={14} aria-hidden="true" />
        {t('article.publish')}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <div className="absolute right-0 z-30 mt-2 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <div>
          <p className="text-sm font-semibold text-ink">{t('write.publish_now_title')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('write.publish_now_body')}</p>
          <button
            type="submit"
            name="intent"
            value="publish"
            className={buttonClass('primary', 'sm', 'mt-2 w-full')}
          >
            {t('write.publish_now')}
          </button>
        </div>
        <div className="border-t border-line pt-3">
          <Field label={t('write.schedule_label')} hint={t('write.schedule_hint')} error={atError}>
            {(p) => <Input {...p} type="datetime-local" name="at" size="sm" />}
          </Field>
          <button
            type="submit"
            name="intent"
            value="schedule"
            className={buttonClass('secondary', 'sm', 'mt-2 w-full')}
          >
            <CalendarClock size={14} aria-hidden="true" />
            {t(scheduled ? 'write.reschedule' : 'article.schedule')}
          </button>
        </div>
      </div>
    </details>
  )
}
