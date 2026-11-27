import { Avatar, cx, Dialog, GirihBand, Kbd, Logo, Menu, Select } from '@buildwith/ui'
import {
  Bell,
  Bookmark,
  FileText,
  Home,
  LogOut,
  MessageCircleQuestion,
  NotebookPen,
  PenLine,
  Plus,
  Search,
  Settings,
  Shield,
  User as UserIcon,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Form, useLocation, useNavigate, useRouteLoaderData } from 'react-router'
import { useT } from '../lib/i18n'
import type { RootData } from '../root'
import { CsrfField } from './forms'

export function Shell({ children }: { children: ReactNode }) {
  const t = useT()
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('nav.skip')}
      </a>
      <TopBar />
      <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 md:pb-10">
        {children}
      </main>
      <Footer />
      <BottomNav />
      <Shortcuts />
    </>
  )
}

function useRoot() {
  return useRouteLoaderData<RootData>('root')
}

const NAV = [
  ['/', 'nav.top'],
  ['/notes', 'nav.notes'],
  ['/savol', 'nav.savol'],
  ['/following', 'nav.following'],
  ['/korsat', 'nav.korsat'],
  ['/articles', 'nav.articles'],
  ['/ishlar', 'nav.ishlar'],
] as const

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' || path === '/new' || path === '/best' : path.startsWith(href)
}

function TopBar() {
  const t = useT()
  const root = useRoot()
  const { pathname } = useLocation()
  const me = root?.me
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <a href="/" aria-label={t('nav.home')} className="shrink-0">
          <Logo height={26} />
        </a>
        <nav aria-label={t('nav.menu')} className="ml-2 hidden items-center gap-0.5 lg:flex">
          {NAV.filter(([href]) => href !== '/following' || me).map(([href, key]) => (
            <a
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cx(
                'rounded-control px-2.5 py-1.5 text-sm transition-colors duration-150',
                isActive(pathname, href) ? 'font-semibold text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {t(key)}
            </a>
          ))}
        </nav>
        <search className="ml-auto hidden md:block">
          <form action="/search">
            <label className="relative block">
              <span className="sr-only">{t('nav.search')}</span>
              <Search
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                name="q"
                type="search"
                placeholder={`${t('nav.search')}  ⌘K`}
                className="h-9 w-44 rounded-control border border-line bg-surface pl-8 pr-2 text-sm text-ink placeholder:text-muted focus:w-64 focus:border-lapis focus:outline-none xl:w-56"
              />
            </label>
          </form>
        </search>
        <a
          href="/search"
          className="ml-auto rounded-control p-2 text-muted hover:text-ink md:hidden"
          aria-label={t('nav.search')}
        >
          <Search size={20} strokeWidth={1.75} />
        </a>
        {me ? (
          <>
            <NewMenu />
            <UnreadBell />
            <Menu
              trigger={
                <button type="button" aria-label={t('nav.profile')} className="rounded-full">
                  <Avatar
                    name={me.display_name || me.username}
                    src={me.avatar_url}
                    accent={me.accent}
                    size={32}
                  />
                </button>
              }
              items={[
                { label: `@${me.username}`, href: `/@${me.username}`, icon: <UserIcon size={15} /> },
                { label: t('nav.bookmarks'), href: '/bookmarks', icon: <Bookmark size={15} /> },
                { label: t('nav.my_articles'), href: '/write', icon: <FileText size={15} /> },
                { label: t('nav.settings'), href: '/settings', icon: <Settings size={15} /> },
                ...(me.is_moderator
                  ? [{ label: t('nav.moderation'), href: '/mod', icon: <Shield size={15} /> }]
                  : []),
                'separator',
                { label: t('nav.logout'), href: '/logout', icon: <LogOut size={15} />, danger: true },
              ]}
            />
          </>
        ) : (
          <a
            href="/login"
            className="rounded-control bg-lapis px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            {t('nav.login')}
          </a>
        )}
      </div>
    </header>
  )
}

function NewMenu() {
  const t = useT()
  return (
    <Menu
      trigger={
        <button
          type="button"
          className="hidden h-9 items-center gap-1.5 rounded-control bg-lapis px-3 text-sm font-medium text-on-accent hover:opacity-90 md:inline-flex"
        >
          <Plus size={16} aria-hidden="true" /> {t('nav.new_post')}
        </button>
      }
      items={[
        { label: t('compose.note'), href: '/notes#compose', icon: <NotebookPen size={15} /> },
        { label: t('compose.question'), href: '/submit?kind=ask', icon: <MessageCircleQuestion size={15} /> },
        { label: t('compose.link'), href: '/submit', icon: <PenLine size={15} /> },
        { label: t('compose.article'), href: '/write/new', icon: <FileText size={15} /> },
      ]}
    />
  )
}

/** The bell. With JavaScript it follows the unread count over server-sent events. */
function UnreadBell() {
  const t = useT()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const es = new EventSource('/v1/notifications/stream')
    es.addEventListener('unread', (e) => setCount(Number((e as MessageEvent).data)))
    return () => es.close()
  }, [])
  return (
    <a
      href="/notifications"
      className="relative rounded-control p-2 text-muted hover:text-ink"
      aria-label={t('nav.notifications')}
    >
      <Bell size={20} strokeWidth={1.75} />
      {count ? (
        <span className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center font-mono text-[10px] leading-4 text-paper">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </a>
  )
}

function BottomNav() {
  const t = useT()
  const root = useRoot()
  const { pathname } = useLocation()
  const items: [string, string, typeof Home][] = [
    ['/', 'nav.top', Home],
    ['/notes', 'nav.notes', NotebookPen],
    [root?.me ? '/notes#compose' : '/login', 'nav.new_post', Plus],
    ['/savol', 'nav.savol', MessageCircleQuestion],
    [root?.me ? '/notifications' : '/login', 'nav.notifications', Bell],
  ]
  return (
    <nav
      aria-label={t('nav.menu')}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
    >
      {items.map(([href, key, Icon]) => (
        <a
          key={key}
          href={href}
          aria-label={t(key)}
          aria-current={isActive(pathname, href) ? 'page' : undefined}
          className={cx(
            'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
            isActive(pathname, href) ? 'text-ink' : 'text-muted',
          )}
        >
          <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className="max-w-full truncate px-1">{t(key)}</span>
        </a>
      ))}
    </nav>
  )
}

function Footer() {
  const t = useT()
  const root = useRoot()
  const { pathname, search } = useLocation()
  return (
    <footer className="mt-10 border-t border-line pb-24 text-muted md:pb-8">
      <GirihBand className="text-line" />
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-4 text-sm md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-ink">{t('app.tagline')}</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="/about" className="hover:text-ink">
              {t('footer.about')}
            </a>
            <a href="/guidelines" className="hover:text-ink">
              {t('footer.guidelines')}
            </a>
            <a href="/modlog" className="hover:text-ink">
              {t('footer.modlog')}
            </a>
            <a href="/privacy" className="hover:text-ink">
              {t('footer.privacy')}
            </a>
            <a href="/terms" className="hover:text-ink">
              {t('footer.terms')}
            </a>
            <a href="https://github.com/buildwithuz/buildwith" className="hover:text-ink">
              {t('footer.source')}
            </a>
          </nav>
          <p className="text-xs">{t('footer.made')}</p>
        </div>
        <Form method="post" action="/actions/prefs" className="flex flex-wrap items-end gap-2">
          <CsrfField />
          <input type="hidden" name="redirectTo" value={pathname + search} />
          <PrefSelect
            name="lang"
            label={t('prefs.lang')}
            value={root?.lang ?? 'uz'}
            options={[
              ['uz', 'Oʻzbekcha'],
              ['ru', 'Русский'],
              ['en', 'English'],
            ]}
          />
          <PrefSelect
            name="script"
            label={t('prefs.script')}
            value={root?.script ?? 'latn'}
            options={[
              ['latn', t('prefs.latn')],
              ['cyrl', t('prefs.cyrl')],
            ]}
          />
          <PrefSelect
            name="theme"
            label={t('prefs.theme')}
            value={root?.theme ?? 'system'}
            options={[
              ['system', t('prefs.theme_system')],
              ['light', t('prefs.theme_light')],
              ['dark', t('prefs.theme_dark')],
            ]}
          />
          <noscript>
            <button
              type="submit"
              className="h-8 rounded-control border border-line px-3 text-xs text-ink hover:bg-sunken"
            >
              {t('common.save')}
            </button>
          </noscript>
        </Form>
      </div>
    </footer>
  )
}

function PrefSelect({
  name,
  label,
  value,
  options,
}: {
  name: string
  label: string
  value: string
  options: [string, string][]
}) {
  const id = `pref-${name}`
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label htmlFor={id}>{label}</label>
      <Select
        id={id}
        name={name}
        defaultValue={value}
        size="sm"
        className="w-auto"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** ⌘K palette, "?" help, "/" search and "n" new note. */
function Shortcuts() {
  const t = useT()
  const navigate = useNavigate()
  const root = useRoot()
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?') setHelp(true)
      if (e.key === '/') {
        e.preventDefault()
        navigate('/search')
      }
      if (e.key === 'n' && root?.me) navigate('/notes#compose')
      if (e.key === 'g') navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, root?.me])

  const commands = useMemo(() => {
    const pages: [string, string][] = [
      [t('nav.top'), '/'],
      [t('nav.notes'), '/notes'],
      [t('nav.savol'), '/savol'],
      [t('nav.korsat'), '/korsat'],
      [t('nav.articles'), '/articles'],
      [t('nav.ishlar'), '/ishlar'],
      [t('compose.question'), '/submit?kind=ask'],
      [t('compose.write_article'), '/write/new'],
      [t('nav.settings'), '/settings'],
      [t('footer.modlog'), '/modlog'],
    ]
    if (root?.me)
      pages.splice(1, 0, [t('nav.following'), '/following'], [t('nav.notifications'), '/notifications'])
    const needle = q.trim().toLowerCase()
    return pages.filter(([label]) => !needle || label.toLowerCase().includes(needle))
  }, [q, t, root?.me])

  return (
    <>
      <Dialog
        open={palette}
        onOpenChange={setPalette}
        title={t('shortcuts.palette')}
        closeLabel={t('common.close')}
      >
        <form
          action="/search"
          onSubmit={(e) => {
            e.preventDefault()
            setPalette(false)
            const first = commands[0]
            navigate(
              first && q && first[0].toLowerCase().includes(q.toLowerCase())
                ? first[1]
                : `/search?q=${encodeURIComponent(q)}`,
            )
          }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            className="h-10 w-full rounded-control border border-line bg-surface px-3 text-ink focus:border-lapis focus:outline-none"
          />
        </form>
        <ul className="mt-2 max-h-72 overflow-y-auto">
          {commands.map(([label, href]) => (
            <li key={href}>
              <a
                href={href}
                onClick={() => setPalette(false)}
                className="block rounded-control px-2 py-1.5 text-sm text-ink hover:bg-sunken"
              >
                {label}
              </a>
            </li>
          ))}
          {q && (
            <li>
              <a
                href={`/search?q=${encodeURIComponent(q)}`}
                className="block rounded-control px-2 py-1.5 text-sm text-lapis hover:bg-sunken"
              >
                {t('nav.search')}: “{q}”
              </a>
            </li>
          )}
        </ul>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp} title={t('shortcuts.title')} closeLabel={t('common.close')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {(
            [
              [['⌘', 'K'], 'shortcuts.palette'],
              [['/'], 'shortcuts.search'],
              [['n'], 'shortcuts.new_note'],
              [['g'], 'shortcuts.go_home'],
              [['?'], 'shortcuts.help'],
            ] as const
          ).map(([keys, label]) => (
            <div key={label} className="contents">
              <dt className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd className="text-ink">{t(label)}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  )
}
