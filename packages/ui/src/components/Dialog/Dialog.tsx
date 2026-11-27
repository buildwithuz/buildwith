import { X } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from '../../cx'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
  title: ReactNode
  description?: ReactNode
  closeLabel: string
  children: ReactNode
  wide?: boolean
}

/** A modal dialog. Focus is trapped and restored by Radix. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  closeLabel,
  children,
  wide,
}: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in" />
        <D.Content
          className={cx(
            'fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-32px)] -translate-x-1/2 rounded-card border border-line',
            'bg-surface p-5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] focus:outline-none',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <D.Title className="text-lg font-semibold text-ink">{title}</D.Title>
            <D.Close
              aria-label={closeLabel}
              className="rounded-control p-1 text-muted hover:bg-sunken hover:text-ink"
            >
              <X size={18} strokeWidth={1.75} />
            </D.Close>
          </div>
          {description ? (
            <D.Description className="mb-4 text-sm text-muted">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
