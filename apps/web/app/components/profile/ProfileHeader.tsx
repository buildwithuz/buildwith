import type { Profile, Schemas } from '@buildwith/api-client'
import { Avatar, Badge, buttonClass, cx } from '@buildwith/ui'
import {
  BadgeCheck,
  Briefcase,
  Building2,
  Crown,
  Globe,
  Link2,
  Mail,
  MapPin,
  PenLine,
  Send,
  ShieldCheck,
  Sprout,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useLang, useT, useTx } from '../../lib/i18n'
import { formatDate } from '../../lib/time'
import { FollowButton } from '../FollowButton'
import { UserActions } from './UserActions'

type Accent = Schemas['Accent']
type BadgeKind = Schemas['BadgeKind']

// Accent colour is used for the banner band and the avatar ring only.
const accentText: Record<Accent, string> = {
  lapis: 'text-lapis',
  turquoise: 'text-turquoise',
  saffron: 'text-saffron',
  plum: 'text-plum',
  moss: 'text-moss',
}
const accentRing: Record<Accent, string> = {
  lapis: 'ring-lapis',
  turquoise: 'ring-turquoise',
  saffron: 'ring-saffron',
  plum: 'ring-plum',
  moss: 'ring-moss',
}

const badgeIcon: Record<BadgeKind, ReactNode> = {
  github: <BadgeCheck size={13} aria-hidden="true" />,
  company_email: <Building2 size={13} aria-hidden="true" />,
  moderator: <ShieldCheck size={13} aria-hidden="true" />,
  early: <Sprout size={13} aria-hidden="true" />,
  author: <PenLine size={13} aria-hidden="true" />,
  founder: <Crown size={13} aria-hidden="true" />,
}

function linkIcon(kind: string) {
  if (kind === 'email') return <Mail size={14} aria-hidden="true" />
  if (kind === 'telegram') return <Send size={14} aria-hidden="true" />
  if (kind === 'website') return <Globe size={14} aria-hidden="true" />
  return <Link2 size={14} aria-hidden="true" />
}

/** "https://github.com/aziz/" → "github.com/aziz" */
function shortUrl(url: string): string {
  return url
    .replace(/^mailto:/, '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/$/, '')
}

function hrefOf(kind: string, url: string): string {
  if (kind === 'email' && !url.startsWith('mailto:')) return `mailto:${url}`
  if (/^https?:\/\//.test(url) || url.startsWith('mailto:')) return url
  return `https://${url}`
}

/** A quiet girih band in the user's accent, for profiles without a banner. */
function Band({ accent }: { accent: Accent }) {
  return (
    <svg aria-hidden="true" className={cx('absolute inset-0 h-full w-full opacity-30', accentText[accent])}>
      <defs>
        <pattern id="bw-profile-girih" width="40" height="40" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="0.9">
            <rect x="10" y="10" width="20" height="20" />
            <rect x="10" y="10" width="20" height="20" transform="rotate(45 20 20)" />
            <circle cx="20" cy="20" r="4" />
            <path d="M0 0l6 6M40 0l-6 6M0 40l6-6M40 40l-6-6" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#bw-profile-girih)" />
    </svg>
  )
}

export function ProfileHeader({
  profile,
  isOwner,
  signedIn,
}: {
  profile: Profile
  isOwner: boolean
  signedIn: boolean
}) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const { user, counts, relation, links } = profile
  const name = tx.text(user.display_name || user.username)
  const badges = user.badges ?? []
  const hasMeta = user.role_title || user.company || user.location
  return (
    <header>
      <div className="relative h-32 overflow-hidden rounded-card border border-line bg-sunken sm:h-44">
        {user.banner_url ? (
          <img src={user.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <Band accent={user.accent} />
        )}
      </div>
      <div className="px-1 sm:px-5">
        <div className="-mt-11 flex items-end justify-between gap-3 sm:-mt-14">
          <Avatar
            name={user.display_name || user.username}
            src={user.avatar_url}
            size={96}
            accent={user.accent}
            className={cx('relative ring-[3px] ring-offset-[3px] ring-offset-paper', accentRing[user.accent])}
          />
          <div className="flex flex-wrap items-center justify-end gap-2 pb-1">
            {isOwner ? (
              <a href="/settings" className={buttonClass('secondary', 'sm')}>
                {t('profile.edit')}
              </a>
            ) : signedIn ? (
              <>
                {!relation?.blocking && (
                  <FollowButton username={user.username} following={relation?.following ?? false} />
                )}
                <UserActions
                  username={user.username}
                  userId={user.id}
                  muting={relation?.muting ?? false}
                  blocking={relation?.blocking ?? false}
                />
              </>
            ) : (
              <a
                href={`/login?next=${encodeURIComponent(`/@${user.username}`)}`}
                className={buttonClass('primary', 'sm')}
              >
                {t('common.follow')}
              </a>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold leading-tight text-ink">{name}</h1>
          {user.open_to_work && (
            <Badge tone="turquoise" icon={<Briefcase size={13} aria-hidden="true" />}>
              {t('profile.open_to_work')}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <span translate="no" className="font-mono">
            @{user.username}
          </span>
          {user.pronouns && (
            <>
              <span aria-hidden="true">·</span>
              <span>{tx.text(user.pronouns)}</span>
            </>
          )}
          {relation?.followed_by && <Badge>{t('profile.follows_you')}</Badge>}
          {relation?.muting && <Badge>{t('profile.muted_badge')}</Badge>}
        </p>

        {badges.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('profile.badges')}>
            {badges.map((b) => (
              <li key={b.kind}>
                <Badge
                  tone={b.kind === 'moderator' ? 'lapis' : b.kind === 'founder' ? 'saffron' : 'neutral'}
                  icon={badgeIcon[b.kind]}
                  title={b.detail}
                >
                  {t(`badge.${b.kind}`)}
                  {b.kind === 'company_email' && b.detail && (
                    <span translate="no" className="font-mono">
                      {' '}
                      {b.detail}
                    </span>
                  )}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {user.bio && (
          <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-ink">{tx.text(user.bio)}</p>
        )}

        {(hasMeta || links.length > 0) && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
            {(user.role_title || user.company) && (
              <li className="inline-flex items-center gap-1.5">
                <Briefcase size={14} aria-hidden="true" />
                <span>
                  {user.role_title && tx.text(user.role_title)}
                  {user.role_title && user.company && <span className="text-muted"> @ </span>}
                  {user.company && <span className="text-ink">{tx.text(user.company)}</span>}
                </span>
              </li>
            )}
            {user.location && (
              <li className="inline-flex items-center gap-1.5">
                <MapPin size={14} aria-hidden="true" />
                {tx.text(user.location)}
              </li>
            )}
            {links.map((l) => (
              <li key={l.url} className="inline-flex min-w-0 items-center gap-1.5">
                {linkIcon(l.kind)}
                <a
                  href={hrefOf(l.kind, l.url)}
                  rel="me noopener ugc"
                  translate="no"
                  className="truncate font-mono text-[13px] text-lapis hover:underline"
                >
                  {shortUrl(l.url)}
                </a>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {t.rich(
              'profile.followers_count',
              { b: (c) => <strong className="font-mono font-semibold text-ink">{c}</strong> },
              { count: counts.followers },
            )}
          </span>
          <span>
            {t.rich(
              'profile.following_count',
              { b: (c) => <strong className="font-mono font-semibold text-ink">{c}</strong> },
              { count: counts.following },
            )}
          </span>
          <span>
            {t.rich(
              'profile.karma_count',
              { b: (c) => <strong className="font-mono font-semibold text-saffron">{c}</strong> },
              { count: user.karma },
            )}
          </span>
          <span>{t('profile.joined', { date: formatDate(user.created_at, lang) })}</span>
        </p>
      </div>
    </header>
  )
}
