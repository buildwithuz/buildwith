import type { Schemas } from '@buildwith/api-client'
import { cx } from '@buildwith/ui'
import { useEffect, useMemo, useState } from 'react'
import { useT, useTx } from '../../lib/i18n'

type Entry = Schemas['TocEntry']

/** Follows the reader: the last heading scrolled past is the current one. */
function useCurrentHeading(ids: string[]) {
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    if (ids.length === 0) return
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null)
    const onScroll = () => {
      let active: string | null = null
      for (const el of els) {
        if (el.getBoundingClientRect().top <= 120) active = el.id
        else break
      }
      setCurrent(active ?? els[0]?.id ?? null)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [ids])
  return current
}

function Items({ toc, current }: { toc: Entry[]; current: string | null }) {
  const tx = useTx()
  return (
    <ol className="flex flex-col">
      {toc.map((e) => (
        <li key={e.id}>
          <a
            href={`#${e.id}`}
            aria-current={current === e.id ? 'location' : undefined}
            className={cx(
              '-ml-px block border-l py-1 text-[13px] leading-snug transition-colors duration-150',
              e.level === 2 ? 'pl-3' : e.level === 3 ? 'pl-6' : 'pl-9',
              current === e.id
                ? 'border-lapis font-medium text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tx.text(e.text)}
          </a>
        </li>
      ))}
    </ol>
  )
}

/** The slim sticky table of contents beside the article on wide screens. */
export function Toc({ toc }: { toc: Entry[] }) {
  const t = useT()
  const ids = useMemo(() => toc.map((e) => e.id), [toc])
  const current = useCurrentHeading(ids)
  return (
    <nav aria-label={t('article.toc')} className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
      <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
        {t('article.toc')}
      </p>
      <div className="border-l border-line">
        <Items toc={toc} current={current} />
      </div>
    </nav>
  )
}

/** On narrow screens: a folded "Contents" box above the body, no JavaScript needed. */
export function TocInline({ toc }: { toc: Entry[] }) {
  const t = useT()
  return (
    <details className="group mb-8 rounded-card border border-line bg-surface px-4 py-3 lg:hidden">
      <summary className="cursor-pointer list-none text-sm font-medium text-ink marker:hidden">
        <span
          className="mr-2 inline-block font-mono text-muted transition-transform duration-150 group-open:rotate-90"
          aria-hidden="true"
        >
          ›
        </span>
        {t('article.toc')}
      </summary>
      <div className="mt-2 border-l border-line">
        <Items toc={toc} current={null} />
      </div>
    </details>
  )
}
