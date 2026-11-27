import { buttonClass, Card, Girih } from '@buildwith/ui'
import { FileText, MessageCircleQuestion, NotebookPen, Sparkles } from 'lucide-react'
import { useMe } from '../lib/hooks'
import { useT, useTx } from '../lib/i18n'
import { Composer } from './Composer'

const SURFACES = [
  ['/notes', 'nav.notes', 'home.notes_desc', NotebookPen],
  ['/savol', 'nav.savol', 'home.savol_desc', MessageCircleQuestion],
  ['/korsat', 'nav.korsat', 'home.korsat_desc', Sparkles],
  ['/articles', 'nav.articles', 'home.articles_desc', FileText],
] as const

/** The welcome for signed-out visitors: what this is, and one clear way in. */
export function Hero() {
  const t = useT()
  return (
    <section
      aria-labelledby="hero-title"
      className="relative mb-8 overflow-hidden rounded-card border border-line bg-surface"
    >
      <Girih
        className="pointer-events-none absolute -right-10 -top-10 hidden text-line sm:block"
        size={260}
      />
      <div className="relative flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 md:pr-44">
          <p className="font-mono text-xs text-lapis">{t('home.open_source')}</p>
          <h1
            id="hero-title"
            className="max-w-lg text-[28px] font-semibold leading-tight text-ink sm:text-[34px]"
          >
            {t('app.tagline')}
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted">{t('home.hero_body')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/login" className={buttonClass('primary')}>
            {t('home.join')}
          </a>
          <a href="/savol" className={buttonClass('secondary')}>
            {t('home.ask')}
          </a>
        </div>
        <ul className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
          {SURFACES.map(([href, title, desc, Icon]) => (
            <li key={href}>
              <a
                href={href}
                className="flex h-full flex-col gap-1.5 rounded-control border border-line bg-paper p-3 transition-colors duration-150 hover:border-lapis/50"
              >
                <Icon size={18} strokeWidth={1.75} className="text-lapis" aria-hidden="true" />
                <span className="text-sm font-semibold text-ink">{t(title)}</span>
                <span className="text-xs leading-snug text-muted">{t(desc)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Signed-in home starts with the question every social app asks first. */
export function HomeComposer() {
  const me = useMe()
  const tx = useTx()
  const t = useT()
  if (!me) return null
  const first = (me.display_name || me.username).split(' ')[0] ?? me.username
  return (
    <Card className="mb-6 px-4">
      <p className="pt-3 text-xs font-medium text-muted">
        {t('home.compose_title', { name: tx.text(first) })}
      </p>
      <Composer me={me} />
    </Card>
  )
}
