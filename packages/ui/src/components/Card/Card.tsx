import type { HTMLAttributes } from 'react'
import { cx } from '../../cx'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-card border border-line bg-surface', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('border-b border-line px-4 py-3 text-sm font-semibold text-ink', className)}
      {...props}
    />
  )
}
