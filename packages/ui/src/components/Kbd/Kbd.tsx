import type { ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-line bg-sunken px-1.5 font-mono text-xs text-muted">
      {children}
    </kbd>
  )
}
