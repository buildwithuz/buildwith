import { actionError, api, finish, readForm } from '../../lib/api.server'
import type { Route } from './+types/vote'

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf, js } = await readForm(request)
  const subject = get('subject') as 'link' | 'article' | 'comment'
  const id = Number(get('id'))
  const value = Number(get('value'))
  const client = api(context, csrf)
  const res =
    value === 0
      ? await client.DELETE('/votes', { params: { query: { subject_type: subject, subject_id: id } } })
      : await client.PUT('/votes', {
          body: { subject_type: subject, subject_id: id, value: value as 1 | -1 },
        })
  return finish(request, js, res.data ?? actionError(res))
}
