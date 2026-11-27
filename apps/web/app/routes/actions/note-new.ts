import type { Schemas } from '@buildwith/api-client'
import { redirect } from 'react-router'
import { actionError, api, backTo, readForm } from '../../lib/api.server'
import type { Route } from './+types/note-new'

export async function action({ request, context }: Route.ActionArgs) {
  const { form, get, csrf, js } = await readForm(request)
  const body: Schemas['NoteNew'] = { body_md: get('body_md') }
  const num = (k: string) => (get(k) ? Number(get(k)) : undefined)
  if (num('reply_to_id')) body.reply_to_id = num('reply_to_id')
  if (num('quote_of_id')) body.quote_of_id = num('quote_of_id')
  const policy = get('reply_policy')
  if (policy === 'everyone' || policy === 'following' || policy === 'mentioned') body.reply_policy = policy
  if (get('code_body').trim()) body.code = { lang: get('code_lang'), body: get('code_body') }
  const ids = form.getAll('media_id').map(String)
  const alts = form.getAll('media_alt').map(String)
  if (ids.length) body.media = ids.map((id, i) => ({ media_id: Number(id), alt: alts[i] ?? '' }))

  const res = await api(context, csrf).POST('/notes', { body })
  if (!res.data) {
    if (js) return actionError(res)
    throw redirect(`${backTo(request, '/notes')}${backTo(request).includes('?') ? '&' : '?'}error=${actionError(res).error}`)
  }
  if (js) return { ok: true, path: res.data.path }
  throw redirect(body.reply_to_id ? backTo(request, res.data.path) : res.data.path)
}
