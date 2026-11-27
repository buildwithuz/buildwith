import type { ReactNode } from 'react'
import { cx } from '../../cx'

export type BadgeTone = 'neutral' | 'lapis' | 'turquoise' | 'saffron' | 'danger'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-muted',
  lapis: 'bg-lapis-soft text-lapis',
  turquoise: 'bg-sunken text-turquoise',
  saffron: 'bg-saffron-soft text-saffron',
  danger: 'bg-sunken text-danger',
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
  title,
  className,
}: {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-5',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
