import type { User } from '@buildwith/api-client'
import { Avatar } from '@buildwith/ui'
import { useLang, useTx } from '../lib/i18n'
import { ago, formatDate } from '../lib/time'

export function UserAvatar({ user, size = 40 }: { user: User; size?: number }) {
  return (
    <a href={`/@${user.username}`} className="shrink-0" tabIndex={-1}>
      <span className="sr-only">@{user.username}</span>
      <Avatar
        name={user.display_name || user.username}
        src={user.avatar_url}
        size={size}
        accent={user.accent}
      />
    </a>
  )
}

/** "Name @username · 3h", with the username in mono and never transliterated. */
export function UserName({ user, at, href }: { user: User; at?: string; href?: string }) {
  const tx = useTx()
  const { lang } = useLang()
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
      <a href={`/@${user.username}`} className="truncate font-semibold text-ink hover:underline">
        {tx.text(user.display_name || user.username)}
      </a>
      <a href={`/@${user.username}`} translate="no" className="truncate font-mono text-xs text-muted">
        @{user.username}
      </a>
      {at && (
        <>
          <span className="text-muted" aria-hidden="true">
            ·
          </span>
          {href ? (
            <a href={href} className="hover:underline">
              <TimeAgo iso={at} lang={lang} />
            </a>
          ) : (
            <TimeAgo iso={at} lang={lang} />
          )}
        </>
      )}
    </span>
  )
}

export function TimeAgo({ iso, lang }: { iso: string; lang: Parameters<typeof ago>[1] }) {
  const tx = useTx()
  const ui = (s: string) => (lang === 'uz' ? tx.text(s) : s)
  return (
    <time dateTime={iso} title={ui(formatDate(iso, lang, true))} className="text-xs text-muted">
      {ui(ago(iso, lang))}
    </time>
  )
}
