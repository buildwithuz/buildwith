import type { ReactNode } from 'react'
import { cx } from '../../cx'
import { Girih } from './Girih'

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center gap-3 px-4 py-14 text-center', className)}>
      <Girih className="text-line" size={96} />
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action}
    </div>
  )
}
