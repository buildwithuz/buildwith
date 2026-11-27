import type { Link } from '@buildwith/api-client'
import { Badge, Tag } from '@buildwith/ui'
import { MessageSquare } from 'lucide-react'
import { useLang, useT, useTx } from '../lib/i18n'
import { TimeAgo } from './UserLine'
import { VoteButton } from './VoteButton'

/**
 * One row of a ranked list: rank · ▲ · title · (domain) · tags, then a muted
 * line of points · @author · age · comments. Dense, no images.
 */
export function LinkRow({ link, rank, signedIn }: { link: Link; rank?: number; signedIn: boolean }) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const isQuestion = link.kind === 'ask'
  const href = link.url ?? link.path
  return (
    <article className="flex gap-2 py-2.5">
      {rank !== undefined && (
        <span className="w-6 shrink-0 pt-1 text-right font-mono text-xs text-muted">{rank}.</span>
      )}
      <VoteButton subject="link" id={link.id} points={link.points} vote={link.viewer_vote} signedIn={signedIn} disabled={link.can_edit} />
      <div className="min-w-0 flex-1">
        <h2 className="text-base leading-snug">
          {link.kind !== 'link' && (
            <Badge tone={isQuestion ? 'lapis' : link.kind === 'show' ? 'turquoise' : 'neutral'} className="mr-1.5 align-[1px]">
              {t(`kind.${link.kind}`)}
            </Badge>
          )}
          <a href={href} className="font-medium text-ink visited:text-muted hover:underline" rel={link.url ? 'ugc noopener' : undefined}>
            {tx.text(link.title)}
          </a>
          {link.domain && (
            <a href={`/new?domain=${encodeURIComponent(link.domain.split('/')[0]!)}`} translate="no" className="ml-1.5 font-mono text-xs text-muted hover:underline">
              ({link.domain})
            </a>
          )}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <a href={`/@${link.author.username}`} translate="no" className="font-mono hover:underline">
            @{link.author.username}
          </a>
          <TimeAgo iso={link.created_at} lang={lang} />
          <a href={link.path} className="inline-flex items-center gap-1 hover:text-ink hover:underline">
            <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
            {t(isQuestion ? 'count.answers' : 'count.comments', { count: link.comment_count })}
          </a>
          {link.tags.map((tag) => (
            <Tag key={tag.slug} slug={tag.slug} />
          ))}
        </div>
      </div>
    </article>
  )
}
