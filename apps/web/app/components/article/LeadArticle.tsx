import type { Article } from '@buildwith/api-client'
import { Avatar, Badge, cx, Girih, Tag } from '@buildwith/ui'
import { useLang, useT, useTx } from '../../lib/i18n'
import { formatDate } from '../../lib/time'

/** The featured article at the top of /articles: larger, with its cover. */
export function LeadArticle({ a }: { a: Article }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  return (
    <article className="group relative overflow-hidden rounded-card border border-line bg-surface">
      <a href={a.path} tabIndex={-1} aria-label={tx.text(a.title)} className="block">
        {a.cover ? (
          <img
            src={a.cover.url}
            alt=""
            className="aspect-[2/1] w-full bg-sunken object-cover sm:aspect-[5/2]"
          />
        ) : (
          <div className="grid aspect-[3/1] w-full place-items-center bg-sunken text-lapis/40 sm:aspect-[4/1]">
            <Girih size={88} />
          </div>
        )}
      </a>
      <div className="p-5 sm:p-6">
        <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          {a.featured && <Badge tone="lapis">{t('article.featured')}</Badge>}
          <Avatar
            name={a.author.display_name || a.author.username}
            src={a.author.avatar_url}
            size={20}
            accent={a.author.accent}
          />
          <a href={`/@${a.author.username}`} className="font-medium text-ink hover:underline">
            {tx.text(a.author.display_name || a.author.username)}
          </a>
          {a.published_at && <span>· {formatDate(a.published_at, lang)}</span>}
          <span>· {t('count.minutes_read', { count: a.reading_minutes })}</span>
        </p>
        <h2 className="font-serif text-2xl font-semibold leading-tight text-ink sm:text-[30px]">
          <a href={a.path} className={cx('hover:underline decoration-1 underline-offset-4')}>
            {tx.text(a.title)}
          </a>
        </h2>
        {a.subtitle && (
          <p className="mt-2 font-serif text-lg leading-snug text-muted">{tx.text(a.subtitle)}</p>
        )}
        <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-mono">{t('count.points', { count: a.points })}</span>
          <span>· {t('count.comments', { count: a.comment_count })}</span>
          {a.tags.map((tag) => (
            <Tag key={tag.slug} slug={tag.slug} />
          ))}
        </p>
      </div>
    </article>
  )
}
