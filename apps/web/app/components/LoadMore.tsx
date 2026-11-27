import { buttonClass } from '@buildwith/ui'
import { useLocation } from 'react-router'
import { useT } from '../lib/i18n'

/** A plain link to the next page; keyset cursors keep pages stable. */
export function LoadMore({ cursor }: { cursor: string | null | undefined }) {
  const t = useT()
  const loc = useLocation()
  if (!cursor) return null
  const params = new URLSearchParams(loc.search)
  params.set('cursor', cursor)
  return (
    <div className="flex justify-center py-6">
      <a href={`${loc.pathname}?${params}`} className={buttonClass('secondary', 'sm')}>
        {t('common.load_more')}
      </a>
    </div>
  )
}
