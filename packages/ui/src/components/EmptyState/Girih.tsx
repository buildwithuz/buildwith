import { useId } from 'react'

/**
 * A thin girih line pattern. Ornament only: empty states, 404 and the footer,
 * never behind text.
 */
export function Girih({ className, size = 120 }: { className?: string; size?: number }) {
  // An eight-point star from two overlapping squares, with a rosette.
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className={className}
    >
      <rect x="30" y="30" width="60" height="60" />
      <rect x="30" y="30" width="60" height="60" transform="rotate(45 60 60)" />
      <circle cx="60" cy="60" r="12" />
      <path d="M60 18v24M60 78v24M18 60h24M78 60h24" />
      <path d="M30 30l18 18M90 30L72 48M30 90l18-18M90 90L72 72" />
    </svg>
  )
}

/** A repeating band of eight-point stars: the footer, profile banners without a photo. */
export function GirihBand({ className, height = 40 }: { className?: string; height?: number }) {
  // A unique id per instance so several bands on one page don't share a pattern.
  const id = `bw-girih-${useId().replace(/:/g, '')}`
  const tile = 40
  return (
    <svg aria-hidden="true" className={className} width="100%" height={height}>
      <defs>
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="10" y="10" width="20" height="20" />
            <rect x="10" y="10" width="20" height="20" transform="rotate(45 20 20)" />
            <path d="M0 20h5.9M34.1 20H40M20 0v5.9M20 34.1V40" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height={height} fill={`url(#${id})`} />
    </svg>
  )
}
