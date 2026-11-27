import type { Article } from '@buildwith/api-client'
import { Badge, Tag } from '@buildwith/ui'
import { useLang, useT, useTx } from '../lib/i18n'
import { UserAvatar } from './UserLine'
import { formatDate } from '../lib/time'

export function ArticleCard({ a, showStatus = false }: { a: Article; showStatus?: boolean }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const href = a.status === 'published' ? a.path : `/write/${a.id}`
  return (
    <article className="flex gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted">
          <UserAvatar user={a.author} size={20} />
          <a href={`/@${a.author.username}`} className="hover:underline">
            {tx.text(a.author.display_name || a.author.username)}
          </a>
          {a.published_at && <span>· {formatDate(a.published_at, lang)}</span>}
          {showStatus && a.status !== 'published' && <Badge tone="saffron">{t(`article.${a.status}`)}</Badge>}
          {a.featured && <Badge tone="lapis">{t('article.featured')}</Badge>}
        </div>
        <h2 className="text-lg font-semibold leading-snug text-ink">
          <a href={href} className="hover:underline">
            {tx.text(a.title)}
          </a>
        </h2>
        {a.subtitle && <p className="mt-1 line-clamp-2 font-serif text-[15px] text-muted">{tx.text(a.subtitle)}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{t('count.minutes_read', { count: a.reading_minutes })}</span>
          <span>· {t('count.points', { count: a.points })}</span>
          <span>· {t('count.comments', { count: a.comment_count })}</span>
          {a.tags.map((tag) => (
            <Tag key={tag.slug} slug={tag.slug} />
          ))}
        </div>
      </div>
      {a.cover && (
        <a href={href} className="hidden shrink-0 sm:block" tabIndex={-1} aria-hidden="true">
          <img src={a.cover.url} alt="" className="h-24 w-36 rounded-control object-cover" loading="lazy" />
        </a>
      )}
    </article>
  )
}
