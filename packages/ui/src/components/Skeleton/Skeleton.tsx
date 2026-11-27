import { cx } from '../../cx'

export function Skeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows
          key={i}
          className={cx(
            'h-4 animate-pulse rounded-control bg-sunken',
            i === lines - 1 && lines > 1 && 'w-2/3',
            className,
          )}
        />
      ))}
    </div>
  )
}
