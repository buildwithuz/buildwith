import type { Schemas } from '@buildwith/api-client'
import {
  type Accent,
  Button,
  buttonClass,
  Checkbox,
  cx,
  Field,
  Input,
  Textarea,
  useToast,
} from '@buildwith/ui'
import {
  AlertTriangle,
  Check,
  Download,
  EyeOff,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
  Palette,
  RefreshCw,
  Send,
  User as UserIcon,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { data, Form, redirect, useActionData, useFetcher, useNavigation } from 'react-router'
import { GitHubIcon } from '../components/account/BrandIcons'
import { CsrfField, FormFields, useHydrated } from '../components/forms'
import { AvatarField } from '../components/media/AvatarField'
import { BannerField } from '../components/media/BannerField'
import { actionError, api, cookiesFrom, orThrow, readForm, requireMe } from '../lib/api.server'
import { Html, useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/settings'

type ProfileLink = Schemas['ProfileLink']
type Result = { intent: string; ok?: boolean; error?: string; field?: string; html?: string; count?: number }

const ACCENTS: Accent[] = ['lapis', 'turquoise', 'saffron', 'plum', 'moss']
const accentBg: Record<Accent, string> = {
  lapis: 'bg-lapis',
  turquoise: 'bg-turquoise',
  saffron: 'bg-saffron',
  plum: 'bg-plum',
  moss: 'bg-moss',
}
const BIO_MAX = 160

/** github.com → github, t.me → telegram, …; anything else is a website. */
function linkKind(url: string): ProfileLink['kind'] {
  if (url.toLowerCase().startsWith('mailto:')) return 'email'
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return 'website'
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`)
  if (is('github.com')) return 'github'
  if (is('gitlab.com')) return 'gitlab'
  if (is('t.me') || is('telegram.me')) return 'telegram'
  if (is('x.com') || is('twitter.com')) return 'x'
  if (is('linkedin.com')) return 'linkedin'
  return 'website'
}

function parseLinks(text: string): ProfileLink[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((raw) => {
      let url = raw
      if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(url)) url = `mailto:${url}`
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`
      return { kind: linkKind(url), url }
    })
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const me = requireMe(context, request)
  const client = api(context)
  const [profile, words] = await Promise.all([
    client.GET('/users/{username}', { params: { path: { username: me.username } } }),
    client.GET('/me/muted-words'),
  ])
  const p = orThrow(profile)
  return {
    user: p.user,
    readmeMd: p.readme_md ?? '',
    readmeHtml: p.readme_html,
    links: p.links,
    stack: p.stack,
    repoCount: p.repos.length,
    words: words.data?.items ?? [],
    bot: process.env.BUILDWITH_TELEGRAM_BOT_USERNAME?.trim() || null,
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const me = requireMe(context, request)
  const { get, csrf, intent, form } = await readForm(request)
  const client = api(context, csrf)
  const fail = (res: { error?: unknown; response: Response }) =>
    data<Result>({ intent, ...actionError(res) }, { status: 422 })
  const ok = (extra: Partial<Result> = {}) => data<Result>({ intent, ok: true, ...extra })

  switch (intent) {
    case 'profile': {
      const accent = get('accent') as Accent
      const res = await client.PATCH('/users/me', {
        body: {
          display_name: get('display_name').trim(),
          pronouns: get('pronouns').trim(),
          bio: get('bio').trim(),
          role_title: get('role_title').trim(),
          company: get('company').trim(),
          location: get('location').trim(),
          open_to_work: form.get('open_to_work') === 'on',
          ...(ACCENTS.includes(accent) ? { accent } : {}),
          stack: get('stack')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 20),
          links: parseLinks(get('links')),
        },
      })
      return res.data ? ok() : fail(res)
    }
    case 'readme': {
      const res = await client.PUT('/users/me/readme', { body: { body_md: get('body_md') } })
      return res.data ? ok({ html: res.data.body_html }) : fail(res)
    }
    case 'avatar':
    case 'avatar-remove':
    case 'banner':
    case 'banner-remove': {
      const media_id = intent.endsWith('-remove') ? null : Number(get('media_id')) || null
      const body = { media_id }
      const res = intent.startsWith('avatar')
        ? await client.PUT('/users/me/avatar', { body })
        : await client.PUT('/users/me/banner', { body })
      return res.response.ok ? ok() : fail(res)
    }
    case 'repos': {
      const res = await client.POST('/users/me/repos/refresh')
      if (res.response.status === 409)
        return data<Result>({ intent, error: 'github_link_first' }, { status: 409 })
      return res.data ? ok({ count: res.data.items.length }) : fail(res)
    }
    case 'word-add': {
      const res = await client.POST('/me/muted-words', { body: { word: get('word').trim() } })
      return res.response.ok ? ok() : fail(res)
    }
    case 'word-remove': {
      const res = await client.DELETE('/me/muted-words/{id}', { params: { path: { id: Number(get('id')) } } })
      return res.response.ok ? ok() : fail(res)
    }
    case 'delete': {
      if (get('confirm').trim().replace(/^@/, '') !== me.username) {
        return data<Result>({ intent, error: 'delete_mismatch', field: 'confirm' }, { status: 422 })
      }
      const res = await client.DELETE('/users/me')
      if (!res.response.ok) return fail(res)
      const headers = cookiesFrom(res.response)
      const secure = new URL(request.url).protocol === 'https:'
      headers.append(
        'set-cookie',
        `bw_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
      )
      throw redirect('/', { headers })
    }
    default:
      return data<Result>({ intent, error: 'bad_request' }, { status: 400 })
  }
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'settings.title', noindex: true })
}

/** Messages that are not API error codes live under settings.*. */
function errorText(t: ReturnType<typeof useT>, code: string) {
  return code === 'github_link_first' || code === 'delete_mismatch'
    ? t(`settings.${code}`)
    : t(`error.${code}`)
}

/**
 * One fetcher per section. With JavaScript the result arrives on the fetcher
 * and a toast confirms it; without, the page re-renders with the action's data.
 */
function useSection(intents: string[], toastOn = true, message?: (r: Result) => string) {
  const t = useT()
  const toast = useToast()
  const f = useFetcher<Result>()
  const actionData = useActionData<Result>()
  const fromPage = actionData && intents.includes(actionData.intent) ? actionData : undefined
  const result = f.data ?? fromPage
  const seen = useRef<Result | undefined>(undefined)
  useEffect(() => {
    if (!toastOn || f.state !== 'idle' || !f.data || seen.current === f.data) return
    seen.current = f.data
    if (f.data.error) toast(errorText(t, f.data.error), 'error')
    else toast(message ? message(f.data) : t('common.saved'))
  }, [f.state, f.data, t, toast, toastOn, message])
  return { f, result, busy: f.state !== 'idle' }
}

const SECTIONS: [string, string, LucideIcon][] = [
  ['profile', 'settings.profile', UserIcon],
  ['photos', 'settings.images', ImageIcon],
  ['readme', 'profile.readme', FileText],
  ['github', 'settings.github', RefreshCw],
  ['appearance', 'settings.preferences', Palette],
  ['safety', 'settings.safety', EyeOff],
  ['telegram', 'settings.telegram', Send],
  ['data', 'settings.data', Download],
]

export default function Settings({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const { user } = loaderData
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('settings.title')}</h1>
        <a href={`/@${user.username}`} className="text-sm text-lapis hover:underline">
          {t('settings.view_profile')} →
        </a>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label={t('settings.nav')} className="-mx-4 lg:mx-0">
          <ul className="flex gap-1 overflow-x-auto px-4 pb-1 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible lg:px-0">
            {SECTIONS.map(([id, key, Icon]) => (
              <li key={id} className="shrink-0">
                <a
                  href={`#${id}`}
                  className="flex items-center gap-2.5 whitespace-nowrap rounded-control border border-line px-3 py-1.5 text-sm text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink lg:whitespace-normal lg:border-transparent lg:px-2.5"
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                  {t(key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-6">
          <ProfileSection {...loaderData} />
          <Section id="photos" title={t('settings.images')} description={t('settings.images_desc')}>
            <div className="flex flex-col gap-6">
              <div>
                <h3 className="mb-2 text-sm font-medium text-ink">{t('settings.avatar')}</h3>
                <AvatarField user={user} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium text-ink">{t('settings.banner')}</h3>
                <BannerField current={user.banner_url} />
              </div>
            </div>
          </Section>
          <ReadmeSection md={loaderData.readmeMd} html={loaderData.readmeHtml} />
          <GithubSection count={loaderData.repoCount} />
          <AppearanceSection lang={user.lang} script={user.script} theme={user.theme} />
          <SafetySection words={loaderData.words} />
          <Section id="telegram" title={t('settings.telegram')} description={t('settings.telegram_hint')}>
            {loaderData.bot ? (
              <a
                href={`https://t.me/${loaderData.bot}`}
                className={buttonClass('secondary', 'sm')}
                rel="noopener"
              >
                <Send size={14} aria-hidden="true" /> {t('settings.open_bot')}{' '}
                <span translate="no" className="font-mono text-xs text-muted">
                  @{loaderData.bot}
                </span>
              </a>
            ) : (
              <p className="text-sm text-muted">{t('auth.not_configured')}</p>
            )}
          </Section>
          <DataSection username={user.username} />
        </div>
      </div>
    </div>
  )
}

function Section({
  id,
  title,
  description,
  children,
  tone,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
  tone?: 'danger'
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cx(
        'scroll-mt-20 rounded-card border bg-surface',
        tone === 'danger' ? 'border-danger/40' : 'border-line',
      )}
    >
      <div className="border-b border-line px-4 py-4 sm:px-6">
        <h2
          id={`${id}-title`}
          className={cx('text-base font-semibold', tone === 'danger' ? 'text-danger' : 'text-ink')}
        >
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="px-4 py-5 sm:px-6">{children}</div>
    </section>
  )
}

/** The save button with the result next to it: "Saved" or the error. */
function SaveRow({
  busy,
  result,
  label,
  children,
}: {
  busy: boolean
  result?: Result
  label?: string
  children?: ReactNode
}) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={busy}>
        {label ?? t('common.save')}
      </Button>
      {children}
      <span aria-live="polite" className="text-sm">
        {!busy && result?.ok && (
          <span className="inline-flex items-center gap-1 text-moss">
            <Check size={15} aria-hidden="true" /> {t('common.saved')}
          </span>
        )}
        {!busy && result?.error && !result.field && (
          <span className="text-danger">{errorText(t, result.error)}</span>
        )}
      </span>
    </div>
  )
}

function ProfileSection({ user, links, stack }: Route.ComponentProps['loaderData']) {
  const t = useT()
  const { f, result, busy } = useSection(['profile'])
  const [bio, setBio] = useState(user.bio ?? '')
  const left = BIO_MAX - [...bio].length
  const fieldError = (name: string) =>
    result?.error && result.field === name ? t(`error.${result.error}`) : undefined
  const text = (
    name: 'display_name' | 'pronouns' | 'role_title' | 'company' | 'location',
    label: string,
    max: number,
    extra?: object,
  ) => (
    <Field label={label} error={fieldError(name)}>
      {(p) => <Input {...p} name={name} defaultValue={user[name] ?? ''} maxLength={max} {...extra} />}
    </Field>
  )
  return (
    <Section id="profile" title={t('settings.profile')} description={t('settings.profile_desc')}>
      <f.Form method="post" className="flex flex-col gap-5">
        <FormFields />
        <input type="hidden" name="intent" value="profile" />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {text('display_name', t('settings.display_name'), 60, { autoComplete: 'name' })}
          {text('pronouns', t('settings.pronouns'), 24)}
        </div>
        <Field
          label={t('settings.bio')}
          error={fieldError('bio')}
          hint={
            <span className={cx('font-mono', left < 0 ? 'text-danger' : left < 20 ? 'text-saffron' : '')}>
              {t('settings.bio_left', { count: left })}
            </span>
          }
        >
          {(p) => (
            <Textarea
              {...p}
              name="bio"
              rows={3}
              maxLength={BIO_MAX}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="min-h-20"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('role_title', t('settings.role'), 60, { autoComplete: 'organization-title' })}
          {text('company', t('settings.company'), 60, { autoComplete: 'organization' })}
          {text('location', t('settings.location'), 60)}
        </div>
        <div className="flex flex-col gap-1">
          <Checkbox
            name="open_to_work"
            label={t('settings.open_to_work')}
            defaultChecked={user.open_to_work}
          />
          <p className="pl-6 text-xs text-muted">{t('settings.open_to_work_hint')}</p>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">{t('settings.accent')}</legend>
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map((a) => (
              <label key={a} className="group relative cursor-pointer" title={t(`settings.accent_${a}`)}>
                <input
                  type="radio"
                  name="accent"
                  value={a}
                  defaultChecked={user.accent === a}
                  className="peer sr-only"
                />
                <span
                  className={cx(
                    'flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow duration-150',
                    'peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-lapis',
                    'text-on-accent [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100',
                    accentBg[a],
                  )}
                >
                  <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span className="sr-only">{t(`settings.accent_${a}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t('settings.stack')} hint={t('settings.stack_hint')} error={fieldError('stack')}>
          {(p) => <Input {...p} name="stack" defaultValue={stack.join(', ')} translate="no" />}
        </Field>
        <Field label={t('settings.links')} hint={t('settings.links_hint')} error={fieldError('links')}>
          {(p) => (
            <Textarea
              {...p}
              name="links"
              rows={4}
              translate="no"
              spellCheck={false}
              placeholder={'github.com/username\nt.me/username\nexample.uz'}
              defaultValue={links.map((l) => l.url.replace(/^mailto:/, '')).join('\n')}
              className="font-mono text-sm"
            />
          )}
        </Field>
        <SaveRow busy={busy} result={result} />
      </f.Form>
    </Section>
  )
}

function ReadmeSection({ md, html }: { md: string; html: string }) {
  const t = useT()
  const { f, result, busy } = useSection(['readme'])
  const preview = result?.html ?? html
  return (
    <Section id="readme" title={t('settings.readme')} description={t('settings.readme_desc')}>
      <f.Form method="post" className="flex flex-col gap-4">
        <FormFields />
        <input type="hidden" name="intent" value="readme" />
        <label htmlFor="readme-md" className="sr-only">
          {t('settings.readme')}
        </label>
        <Textarea
          id="readme-md"
          name="body_md"
          defaultValue={md}
          rows={10}
          maxLength={20000}
          spellCheck
          className="min-h-56 font-mono text-sm"
        />
        <SaveRow busy={busy} result={result} />
      </f.Form>
      <div className="mt-6">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{t('common.preview')}</h3>
        <div className="rounded-control border border-line bg-paper p-4">
          {preview ? (
            <Html html={preview} className="prose-bw text-[15px]" />
          ) : (
            <p className="text-sm text-muted">{t('settings.readme_empty')}</p>
          )}
        </div>
      </div>
    </Section>
  )
}

function GithubSection({ count }: { count: number }) {
  const t = useT()
  const { f, result, busy } = useSection(['repos'], true, (r) =>
    t('settings.repos_updated', { count: r.count ?? 0 }),
  )
  return (
    <Section id="github" title={t('settings.github')} description={t('settings.github_desc')}>
      <f.Form method="post" className="flex flex-wrap items-center gap-3">
        <FormFields />
        <button
          type="submit"
          name="intent"
          value="repos"
          className={buttonClass('secondary', 'md')}
          disabled={busy}
        >
          {busy ? (
            <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <GitHubIcon size={16} />
          )}
          {t('settings.github_repos')}
        </button>
        <span aria-live="polite" className="text-sm">
          {!busy && result?.ok && (
            <span className="text-moss">{t('settings.repos_updated', { count: result.count ?? 0 })}</span>
          )}
          {!busy && result?.error && <span className="text-danger">{errorText(t, result.error)}</span>}
          {!result && count > 0 && (
            <span className="text-muted">{t('settings.repos_updated', { count })}</span>
          )}
        </span>
      </f.Form>
    </Section>
  )
}

function Segmented({
  name,
  legend,
  value,
  options,
}: {
  name: string
  legend: string
  value: string
  options: [string, ReactNode][]
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      <div className="inline-flex w-full rounded-control border border-line bg-sunken p-0.5 sm:w-auto sm:self-start">
        {options.map(([v, label]) => (
          <label key={v} className="relative flex-1 cursor-pointer sm:flex-none">
            <input type="radio" name={name} value={v} defaultChecked={value === v} className="peer sr-only" />
            <span className="block whitespace-nowrap rounded-[5px] px-3 py-1.5 text-center text-sm text-muted transition-colors duration-150 peer-checked:bg-surface peer-checked:font-medium peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-lapis">
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function AppearanceSection({ lang, script, theme }: { lang?: string; script?: string; theme?: string }) {
  const t = useT()
  const busy = useNavigation().formAction === '/actions/prefs'
  return (
    <Section id="appearance" title={t('settings.preferences')} description={t('settings.appearance_desc')}>
      <Form method="post" action="/actions/prefs" className="flex flex-col gap-5">
        <CsrfField />
        <input type="hidden" name="redirectTo" value="/settings#appearance" />
        <Segmented
          name="lang"
          legend={t('prefs.lang')}
          value={lang ?? 'uz'}
          options={[
            ['uz', 'Oʻzbekcha'],
            ['ru', 'Русский'],
            ['en', 'English'],
          ]}
        />
        <Segmented
          name="script"
          legend={t('prefs.script')}
          value={script ?? 'latn'}
          options={[
            ['latn', `${t('prefs.latn')} · Aa`],
            ['cyrl', `${t('prefs.cyrl')} · Аа`],
          ]}
        />
        <Segmented
          name="theme"
          legend={t('prefs.theme')}
          value={theme ?? 'system'}
          options={[
            ['system', t('prefs.theme_system')],
            ['light', t('prefs.theme_light')],
            ['dark', t('prefs.theme_dark')],
          ]}
        />
        <div>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </Form>
    </Section>
  )
}

function SafetySection({ words }: { words: { id: number; word: string }[] }) {
  const t = useT()
  const { f, result, busy } = useSection(['word-add'], false)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) formRef.current?.reset()
  }, [f.state, f.data])
  return (
    <Section id="safety" title={t('settings.muted_words')} description={t('settings.safety_desc')}>
      {words.length ? (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label={t('settings.muted_words')}>
          {words.map((w) => (
            <WordChip key={w.id} id={w.id} word={w.word} />
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted">{t('settings.no_muted_words')}</p>
      )}
      <f.Form ref={formRef} method="post" className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <FormFields />
        <input type="hidden" name="intent" value="word-add" />
        <div className="flex-1 sm:max-w-xs">
          <label htmlFor="mute-word" className="sr-only">
            {t('settings.word')}
          </label>
          <Input
            id="mute-word"
            name="word"
            required
            minLength={2}
            maxLength={40}
            placeholder={t('settings.word')}
            aria-invalid={result?.error ? true : undefined}
            aria-describedby={result?.error ? 'mute-word-err' : undefined}
          />
          {!busy && result?.error && (
            <p id="mute-word-err" role="alert" className="mt-1 text-xs text-danger">
              {errorText(t, result.error)}
            </p>
          )}
        </div>
        <Button type="submit" variant="secondary" disabled={busy}>
          {t('settings.add_word')}
        </Button>
      </f.Form>
    </Section>
  )
}

function WordChip({ id, word }: { id: number; word: string }) {
  const t = useT()
  const f = useFetcher<Result>()
  if (f.formData) return null
  return (
    <li className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken py-0.5 pl-3 pr-1 text-sm text-ink">
      <span translate="no">{word}</span>
      <f.Form method="post">
        <FormFields />
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          name="intent"
          value="word-remove"
          aria-label={t('settings.unmute_word', { word })}
          className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-danger"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </f.Form>
    </li>
  )
}

function DataSection({ username }: { username: string }) {
  const t = useT()
  const hydrated = useHydrated()
  const actionData = useActionData<Result>()
  const nav = useNavigation()
  const busy = nav.state !== 'idle' && nav.formData?.get('intent') === 'delete'
  const [confirm, setConfirm] = useState('')
  const error = actionData?.intent === 'delete' ? actionData.error : undefined
  const matches = confirm.trim().replace(/^@/, '') === username
  return (
    <>
      <Section id="data" title={t('settings.data')} description={t('settings.data_desc')}>
        <a href="/v1/users/me/export" download className={buttonClass('secondary', 'md')}>
          <Download size={16} aria-hidden="true" /> {t('settings.export')}
        </a>
      </Section>
      <Section id="delete" title={t('settings.danger')} tone="danger">
        <div className="flex gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-ink">{t('settings.delete_account')}</h3>
            <p className="mt-1 text-sm text-muted">{t('settings.delete_warning')}</p>
            <Form method="post" className="mt-4 flex flex-col gap-3">
              <CsrfField />
              <input type="hidden" name="intent" value="delete" />
              <Field label={t('settings.delete_confirm')} error={error ? errorText(t, error) : undefined}>
                {(p) => (
                  <Input
                    {...p}
                    name="confirm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={username}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    translate="no"
                    className="font-mono sm:max-w-xs"
                  />
                )}
              </Field>
              <div>
                <Button type="submit" variant="danger" disabled={busy || (hydrated && !matches)}>
                  {t('settings.delete_account')}
                </Button>
              </div>
            </Form>
          </div>
        </div>
      </Section>
    </>
  )
}
