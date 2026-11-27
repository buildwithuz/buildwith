import type { ReactNode } from 'react'
import { cx } from '../../cx'

export interface NavTab {
  href: string
  label: ReactNode
  active?: boolean
  count?: number
}

/**
 * Tabs that are plain links, so they work without JavaScript and every tab has
 * a URL. Use for lists (Top/New/Best) and profile sections.
 */
export function NavTabs({ tabs, label, className }: { tabs: NavTab[]; label: string; className?: string }) {
  return (
    // Scrolls sideways when the tabs don't fit (phones) but never shows a scrollbar. The underline is an
    // inset shadow, not a border the tabs overlap with -mb-px: that 1px overflowed and, since
    // overflow-x:auto makes overflow-y auto too, gave every tab row a vertical scrollbar.
    <nav
      aria-label={label}
      className={cx(
        'flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map((t) => (
        <a
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors duration-150',
            t.active ? 'border-lapis font-semibold text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 font-mono text-xs text-muted">{t.count}</span>}
        </a>
      ))}
    </nav>
  )
}
