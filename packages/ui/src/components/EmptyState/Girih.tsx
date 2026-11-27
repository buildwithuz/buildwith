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

/** A repeating band of stars for the footer. */
export function GirihBand({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} width="100%" height="24" preserveAspectRatio="none">
      <defs>
        <pattern id="bw-girih" width="24" height="24" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="0.75">
            <rect x="6" y="6" width="12" height="12" />
            <rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="24" fill="url(#bw-girih)" />
    </svg>
  )
}
