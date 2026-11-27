import { actionError, api, finish, readForm } from '../../lib/api.server'
import type { Route } from './+types/note'

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf, js, intent } = await readForm(request)
  const id = Number(get('id'))
  const client = api(context, csrf)
  const path = { params: { path: { id } } }
  const res = await (() => {
    switch (intent) {
      case 'like':
        return client.POST('/notes/{id}/like', path)
      case 'unlike':
        return client.DELETE('/notes/{id}/like', path)
      case 'repost':
        return client.POST('/notes/{id}/repost', path)
      case 'unrepost':
        return client.DELETE('/notes/{id}/repost', path)
      case 'bookmark':
        return client.POST('/notes/{id}/bookmark', path)
      default:
        return client.DELETE('/notes/{id}/bookmark', path)
    }
  })()
  return finish(request, js, res.data ?? actionError(res))
}
