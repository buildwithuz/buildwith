import { NavTabs } from '@buildwith/ui'
import { Html, useT, useTx } from '../../lib/i18n'
import type { StaticPage } from './markdown'

const PAGES = [
  ['about', 'footer.about'],
  ['guidelines', 'footer.guidelines'],
  ['privacy', 'footer.privacy'],
  ['terms', 'footer.terms'],
] as const

/** About, guidelines, privacy, terms: one calm reading column. */
export function StaticPageView({ name, page }: { name: string; page: StaticPage }) {
  const t = useT()
  const tx = useTx()
  return (
    <article className="mx-auto w-full max-w-[680px] pb-8">
      <NavTabs
        label={t('pages.nav')}
        className="mb-10"
        tabs={PAGES.map(([slug, key]) => ({ href: `/${slug}`, label: t(key), active: slug === name }))}
      />
      <header className="mb-8">
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          {tx.text(page.title)}
        </h1>
        {page.lead && (
          <Html html={page.lead} className="prose-bw mt-4 font-serif text-xl leading-relaxed text-muted" />
        )}
      </header>
      {page.toc.length > 3 && (
        <nav
          aria-label={t('article.toc')}
          className="mb-10 rounded-card border border-line bg-surface px-5 py-4"
        >
          <p className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted">
            {t('article.toc')}
          </p>
          <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {page.toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} className="text-ink hover:text-lapis hover:underline">
                  {tx.text(h.text)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <Html html={page.html} className="prose-bw prose-article text-ink" />
    </article>
  )
}
