import type { AnchorHTMLAttributes } from 'react'
import { cx } from '../../cx'

/** A topic chip. `#` is part of the look, not the slug. Never transliterated. */
export function Tag({
  slug,
  className,
  ...props
}: { slug: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={`/t/${slug}`}
      translate="no"
      className={cx(
        'inline-flex items-center rounded-control px-1.5 font-mono text-xs leading-5 text-muted',
        'bg-sunken hover:text-lapis',
        className,
      )}
      {...props}
    >
      #{slug}
    </a>
  )
}
