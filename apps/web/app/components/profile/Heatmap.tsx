import { cx } from '@buildwith/ui'
import { useLang, useT } from '../../lib/i18n'

const CELL = 11
const GAP = 3
const STEP = CELL + GAP
const WEEKS = 53
const TOP = 16
const LEFT = 26

// Lapis at rising strength; level 0 is an empty tile.
const LEVELS = ['fill-sunken', 'fill-lapis/25', 'fill-lapis/45', 'fill-lapis/70', 'fill-lapis']

function level(count: number, max: number): number {
  if (count <= 0) return 0
  if (max <= 4) return Math.min(4, count)
  return Math.min(4, Math.ceil((count / max) * 4))
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Twelve months of activity as a week-column grid (Monday first), drawn in SVG.
 * `today` comes from the loader (a Tashkent date) so server and browser agree.
 */
export function Heatmap({ days, today }: { days: { day: string; count: number }[]; today: string }) {
  const t = useT()
  const { lang } = useLang()
  const counts = new Map(days.map((d) => [d.day, d.count]))
  const end = new Date(`${today}T00:00:00Z`)
  const weekday = (end.getUTCDay() + 6) % 7 // Monday = 0
  const start = new Date(end)
  start.setUTCDate(end.getUTCDate() - weekday - (WEEKS - 1) * 7)

  const cells: { x: number; y: number; day: string; count: number }[] = []
  const months: { x: number; label: string }[] = []
  let total = 0
  let max = 0
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setUTCDate(start.getUTCDate() + w * 7 + d)
      if (date > end) break
      const day = iso(date)
      const count = counts.get(day) ?? 0
      total += count
      max = Math.max(max, count)
      cells.push({ x: w, y: d, day, count })
      if (date.getUTCDate() === 1 && w < WEEKS - 2) {
        months.push({ x: w, label: t(`month.${date.getUTCMonth() + 1}`) })
      }
    }
  }
  const width = LEFT + WEEKS * STEP
  const height = TOP + 7 * STEP
  const dateLabel = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`)
    const m = t(`month.${d.getUTCMonth() + 1}`)
    return lang === 'en' ? `${m} ${d.getUTCDate()}` : `${d.getUTCDate()} ${m}`
  }

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-medium text-ink">
          {t('profile.heatmap_total', { count: total })}
        </figcaption>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted" aria-hidden="true">
          <span>{t('profile.heatmap_less')}</span>
          <svg aria-hidden="true" width={5 * STEP} height={CELL} viewBox={`0 0 ${5 * STEP} ${CELL}`}>
            {LEVELS.map((cls, i) => (
              <rect
                key={cls}
                x={i * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                className={cx(cls, i === 0 && 'stroke-line')}
                strokeWidth={i === 0 ? 1 : 0}
              />
            ))}
          </svg>
          <span>{t('profile.heatmap_more')}</span>
        </div>
      </div>
      {/* rtl so the scroll starts at today on narrow screens, with or without JavaScript */}
      <section
        dir="rtl"
        className="-mx-1 overflow-x-auto px-1 pb-1"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions must be reachable by keyboard
        tabIndex={0}
        aria-label={t('profile.activity')}
      >
        <div dir="ltr">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t('profile.heatmap_total', { count: total })}
            className="block h-auto w-full min-w-[640px] text-muted"
          >
            {months.map((m) => (
              <text
                key={`${m.x}-${m.label}`}
                x={LEFT + m.x * STEP}
                y={10}
                className="fill-current text-[10px]"
              >
                {m.label}
              </text>
            ))}
            {[0, 2, 4].map((d) => (
              <text key={d} x={0} y={TOP + d * STEP + CELL - 2} className="fill-current text-[9px]">
                {t(`profile.weekday_${d}`)}
              </text>
            ))}
            {cells.map((c) => (
              <rect
                key={c.day}
                x={LEFT + c.x * STEP}
                y={TOP + c.y * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                className={cx(LEVELS[level(c.count, max)], c.count === 0 && 'stroke-line')}
                strokeWidth={c.count === 0 ? 1 : 0}
              >
                <title>{t('profile.heatmap_day', { count: c.count, date: dateLabel(c.day) })}</title>
              </rect>
            ))}
          </svg>
        </div>
      </section>
    </figure>
  )
}
