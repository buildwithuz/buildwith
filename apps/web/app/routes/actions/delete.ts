import { redirect } from 'react-router'
import { api, backTo, readForm } from '../../lib/api.server'
import type { Route } from './+types/delete'

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf } = await readForm(request)
  const client = api(context, csrf)
  const id = { params: { path: { id: Number(get('id')) } } }
  switch (get('kind')) {
    case 'note':
      await client.DELETE('/notes/{id}', id)
      break
    case 'link':
      await client.DELETE('/links/{id}', id)
      break
    case 'comment':
      await client.DELETE('/comments/{id}', id)
      break
    case 'article':
      await client.DELETE('/articles/{id}', id)
      break
  }
  throw redirect(get('redirectTo') || backTo(request))
}
