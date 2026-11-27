import { buttonClass } from '@buildwith/ui'
import { useFetcher } from 'react-router'
import { useT } from '../lib/i18n'
import { FormFields } from './forms'

export function FollowButton({
  username,
  following,
  size = 'sm',
}: {
  username: string
  following: boolean
  size?: 'sm' | 'md'
}) {
  const t = useT()
  const f = useFetcher<{ following?: boolean }>()
  let on = following
  if (f.formData) on = f.formData.get('intent') === 'follow'
  else if (f.data && typeof f.data.following === 'boolean') on = f.data.following
  return (
    <f.Form method="post" action="/actions/relation">
      <FormFields />
      <input type="hidden" name="username" value={username} />
      <button
        type="submit"
        name="intent"
        value={on ? 'unfollow' : 'follow'}
        className={buttonClass(on ? 'secondary' : 'primary', size)}
      >
        {t(on ? 'common.following' : 'common.follow')}
      </button>
    </f.Form>
  )
}

export function TagFollowButton({ slug, following }: { slug: string; following: boolean }) {
  const t = useT()
  const f = useFetcher<{ following?: boolean }>()
  let on = following
  if (f.formData) on = f.formData.get('intent') === 'follow-tag'
  else if (f.data && typeof f.data.following === 'boolean') on = f.data.following
  return (
    <f.Form method="post" action="/actions/relation">
      <FormFields />
      <input type="hidden" name="tag" value={slug} />
      <button
        type="submit"
        name="intent"
        value={on ? 'unfollow-tag' : 'follow-tag'}
        className={buttonClass(on ? 'secondary' : 'primary', 'sm')}
      >
        {t(on ? 'common.following' : 'common.follow')}
      </button>
    </f.Form>
  )
}
