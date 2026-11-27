import type { User } from '@buildwith/api-client'
import { Avatar, Badge } from '@buildwith/ui'
import { MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT, useTx } from '../../lib/i18n'

/** A compact profile card: avatar, name, @username, role · company, location; optional action. */
export function PersonCard({
  user,
  action,
  showOpen = false,
}: {
  user: User
  action?: ReactNode
  showOpen?: boolean
}) {
  const t = useT()
  const tx = useTx()
  const role = [user.role_title, user.company]
    .filter(Boolean)
    .map((s) => tx.text(s))
    .join(' · ')
  return (
    <article className="relative flex h-full items-start gap-3 rounded-card border border-line bg-surface p-3.5 transition-colors duration-150 hover:border-muted/50">
      <Avatar
        name={user.display_name || user.username}
        src={user.avatar_url}
        accent={user.accent}
        size={44}
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold leading-5 text-ink">
          <a
            href={`/@${user.username}`}
            className="after:absolute after:inset-0 after:rounded-card hover:underline"
          >
            {tx.text(user.display_name || user.username)}
          </a>
        </h3>
        <p translate="no" className="truncate font-mono text-xs text-muted">
          @{user.username}
        </p>
        {role && <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-ink">{role}</p>}
        {(user.location || (showOpen && user.open_to_work)) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {user.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} aria-hidden="true" />
                {tx.text(user.location)}
              </span>
            )}
            {showOpen && user.open_to_work && <Badge tone="turquoise">{t('profile.open_to_work')}</Badge>}
          </div>
        )}
      </div>
      {action && <div className="relative z-10 shrink-0">{action}</div>}
    </article>
  )
}
