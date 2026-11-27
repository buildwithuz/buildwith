import type { Link } from '@buildwith/api-client'
import { Badge, cx, Tag } from '@buildwith/ui'
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
    <article className="group -mx-2 flex gap-3 rounded-card px-2 py-3 transition-colors duration-150 hover:bg-surface">
      {rank !== undefined && (
        <span className="hidden w-5 shrink-0 pt-1.5 text-right font-mono text-xs tabular-nums text-muted sm:block">
          {rank}
        </span>
      )}
      <VoteButton
        subject="link"
        id={link.id}
        points={link.points}
        vote={link.viewer_vote}
        signedIn={signedIn}
        disabled={link.can_edit}
      />
      <div className="min-w-0 flex-1">
        <h2 className="text-[15.5px] leading-snug sm:text-base">
          {link.kind !== 'link' && (
            <Badge
              tone={isQuestion ? 'lapis' : link.kind === 'show' ? 'turquoise' : 'neutral'}
              className="mr-1.5 align-[1.5px] !py-0 !text-[11px]"
            >
              {t(`kind.${link.kind}`)}
            </Badge>
          )}
          <a
            href={href}
            className="font-medium text-ink decoration-line underline-offset-2 hover:underline"
            rel={link.url ? 'ugc noopener' : undefined}
          >
            {tx.text(link.title)}
          </a>
          {link.domain && (
            <a
              href={`/new?domain=${encodeURIComponent(link.domain.split('/')[0]!)}`}
              translate="no"
              className="ml-1.5 whitespace-nowrap font-mono text-xs text-muted hover:text-ink"
            >
              {link.domain}
            </a>
          )}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
          <a href={`/@${link.author.username}`} translate="no" className="font-mono hover:text-ink">
            @{link.author.username}
          </a>
          <Dot />
          <TimeAgo iso={link.created_at} lang={lang} />
          <Dot />
          <a
            href={link.path}
            className={cx(
              'inline-flex items-center gap-1 hover:text-ink',
              isQuestion && link.comment_count === 0 && 'text-saffron',
            )}
          >
            <MessageSquare size={12} strokeWidth={2} aria-hidden="true" />
            {t(isQuestion ? 'count.answers' : 'count.comments', { count: link.comment_count })}
          </a>
          {link.tags.length > 0 && (
            <span className="ml-1 flex flex-wrap gap-1">
              {link.tags.map((tag) => (
                <Tag key={tag.slug} slug={tag.slug} />
              ))}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-line">
      •
    </span>
  )
}
