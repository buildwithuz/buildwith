import { cx } from '../../cx'

export type Accent = 'lapis' | 'turquoise' | 'saffron' | 'plum' | 'moss'

const accentBg: Record<Accent, string> = {
  lapis: 'bg-lapis',
  turquoise: 'bg-turquoise',
  saffron: 'bg-saffron',
  plum: 'bg-plum',
  moss: 'bg-moss',
}

export interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  accent?: Accent
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0], parts[0]?.[1]]
  return letters.filter(Boolean).join('').toUpperCase() || '?'
}

/** A round avatar; falls back to initials on the user's accent colour. */
export function Avatar({ name, src, size = 40, accent = 'lapis', className }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cx('shrink-0 rounded-full bg-sunken object-cover', className)}
        style={style}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-on-accent',
        accentBg[accent],
        className,
      )}
      style={style}
    >
      {initials(name)}
    </span>
  )
}
