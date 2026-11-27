import type { Note, Tag as TagT, User } from '@buildwith/api-client'
import { Card, CardHeader, Tag } from '@buildwith/ui'
import { useT, useTx } from '../lib/i18n'
import { NoteCard } from './NoteCard'
import { FollowButton } from './FollowButton'
import { UserAvatar } from './UserLine'

export function Sidebar({
  notes,
  tags,
  suggestions,
  signedIn,
}: {
  notes?: Note[]
  tags?: TagT[]
  suggestions?: { user: User; mutuals: number }[]
  signedIn: boolean
}) {
  const t = useT()
  const tx = useTx()
  return (
    <aside className="flex flex-col gap-4">
      {notes && notes.length > 0 && (
        <Card>
          <CardHeader>{t('feed.popular_notes')}</CardHeader>
          <div className="divide-y divide-line px-3">
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} signedIn={signedIn} compact />
            ))}
          </div>
        </Card>
      )}
      {suggestions && suggestions.length > 0 && (
        <Card>
          <CardHeader>{t('feed.who_to_follow')}</CardHeader>
          <ul className="flex flex-col gap-3 p-3">
            {suggestions.map(({ user, mutuals }) => (
              <li key={user.id} className="flex items-center gap-2">
                <UserAvatar user={user} size={32} />
                <div className="min-w-0 flex-1">
                  <a href={`/@${user.username}`} className="block truncate text-sm font-medium text-ink hover:underline">
                    {tx.text(user.display_name || user.username)}
                  </a>
                  <span className="text-xs text-muted">{t('feed.mutuals', { count: mutuals })}</span>
                </div>
                <FollowButton username={user.username} following={false} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tags && tags.length > 0 && (
        <Card>
          <CardHeader>{t('feed.trending_tags')}</CardHeader>
          <div className="flex flex-wrap gap-1.5 p-3">
            {tags.map((tag) => (
              <Tag key={tag.slug} slug={tag.slug} />
            ))}
          </div>
        </Card>
      )}
    </aside>
  )
}
