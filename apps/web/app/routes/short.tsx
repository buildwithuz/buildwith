// Short links (/n/:id, /a/:id, /c/:id) used by notifications, the bot and
// shares. Each looks the item up and sends the reader to its canonical page.
// 302, not 301: titles and slugs can change after the short link was handed out.
import { data, redirect } from 'react-router'
import { api, orThrow } from '../lib/api.server'
import type { Route } from './+types/short'

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const id = Number(params.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw data(null, { status: 404 })
  const client = api(context)
  const byId = (n: number) => ({ params: { path: { id: n } } })
  const kind = new URL(request.url).pathname.split('/')[1]
  if (kind === 'n') throw redirect(orThrow(await client.GET('/notes/{id}', byId(id))).path)
  if (kind === 'a') throw redirect(orThrow(await client.GET('/articles/{id}', byId(id))).path)
  const c = orThrow(await client.GET('/comments/{id}', byId(id)))
  const parent =
    c.subject_type === 'link'
      ? orThrow(await client.GET('/links/{id}', byId(c.subject_id))).path
      : orThrow(await client.GET('/articles/{id}', byId(c.subject_id))).path
  throw redirect(`${parent}#c${c.id}`)
}

export default function Short() {
  return null
}
