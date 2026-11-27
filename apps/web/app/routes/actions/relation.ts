import { actionError, api, finish, readForm } from '../../lib/api.server'
import type { Route } from './+types/relation'

/** follow / unfollow / block / unblock / mute / unmute a user, or follow a tag. */
export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf, js, intent } = await readForm(request)
  const client = api(context, csrf)
  const username = get('username')
  const tag = get('tag')
  const user = { params: { path: { username } } }
  const res = await (() => {
    switch (intent) {
      case 'follow':
        return client.POST('/users/{username}/follow', user)
      case 'unfollow':
        return client.DELETE('/users/{username}/follow', user)
      case 'block':
        return client.POST('/users/{username}/block', user)
      case 'unblock':
        return client.DELETE('/users/{username}/block', user)
      case 'mute':
        return client.POST('/users/{username}/mute', user)
      case 'unmute':
        return client.DELETE('/users/{username}/mute', user)
      case 'follow-tag':
        return client.POST('/tags/{slug}/follow', { params: { path: { slug: tag } } })
      default:
        return client.DELETE('/tags/{slug}/follow', { params: { path: { slug: tag } } })
    }
  })()
  return finish(request, js, res.data ?? actionError(res))
}
