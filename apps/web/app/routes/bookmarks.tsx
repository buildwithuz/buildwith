import { buttonClass, EmptyState } from '@buildwith/ui'
import { LoadMore } from '../components/LoadMore'
import { NoteCard } from '../components/NoteCard'
import { api, orThrow, requireMe } from '../lib/api.server'
import { useT } from '../lib/i18n'
import { pageMeta } from '../lib/meta'
import type { Route } from './+types/bookmarks'

export async function loader({ request, context }: Route.LoaderArgs) {
  requireMe(context, request)
  const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
  const page = orThrow(await api(context).GET('/me/bookmarks', { params: { query: { cursor, limit: 30 } } }))
  return { notes: page.items, next: page.nextCursor ?? null, firstPage: !cursor }
}

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta(matches, { titleKey: 'nav.bookmarks', noindex: true })
}

export default function Bookmarks({ loaderData }: Route.ComponentProps) {
  const t = useT()
  const { notes, next, firstPage } = loaderData
  return (
    <section aria-labelledby="bookmarks-title" className="mx-auto max-w-[640px]">
      <header className="border-b border-line pb-3">
        <h1 id="bookmarks-title" className="text-xl font-semibold text-ink">
          {t('nav.bookmarks')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('bookmarks.intro')}</p>
      </header>
      {notes.length === 0 && firstPage ? (
        <EmptyState
          title={t('bookmarks.empty')}
          action={
            <a href="/notes" className={buttonClass('secondary', 'sm')}>
              {t('bookmarks.browse')}
            </a>
          }
        >
          {t('bookmarks.empty_body')}
        </EmptyState>
      ) : (
        <ol className="divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id}>
              <NoteCard note={n} signedIn />
            </li>
          ))}
        </ol>
      )}
      <LoadMore cursor={next} />
    </section>
  )
}
