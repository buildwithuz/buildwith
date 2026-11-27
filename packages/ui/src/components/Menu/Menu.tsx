import { DropdownMenu as M } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from '../../cx'

export interface MenuItem {
  label: ReactNode
  href?: string
  onSelect?: () => void
  danger?: boolean
  icon?: ReactNode
}

/** A dropdown menu. Items are links or actions; separators split groups. */
export function Menu({
  trigger,
  items,
  align = 'end',
}: {
  trigger: ReactNode
  items: (MenuItem | 'separator')[]
  align?: 'start' | 'end'
}) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-card border border-line bg-surface p-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        >
          {items.map((it, i) =>
            it === 'separator' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
              <M.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <M.Item
                // biome-ignore lint/suspicious/noArrayIndexKey: items are static per render
                key={i}
                asChild={Boolean(it.href)}
                onSelect={it.onSelect}
                className={cx(
                  'flex cursor-pointer select-none items-center gap-2 rounded-control px-2.5 py-1.5 text-sm outline-none',
                  'data-[highlighted]:bg-sunken',
                  it.danger ? 'text-danger' : 'text-ink',
                )}
              >
                {it.href ? (
                  <a href={it.href}>
                    {it.icon}
                    {it.label}
                  </a>
                ) : (
                  <>
                    {it.icon}
                    {it.label}
                  </>
                )}
              </M.Item>
            ),
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}
