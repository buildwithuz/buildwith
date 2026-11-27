import { redirect } from 'react-router'
import { actionError, api, backTo, readForm } from '../../lib/api.server'
import type { Route } from './+types/comment'

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf, js } = await readForm(request)
  const res = await api(context, csrf).POST('/comments', {
    body: {
      subject_type: get('subject_type') as 'link' | 'article',
      subject_id: Number(get('subject_id')),
      parent_id: get('parent_id') ? Number(get('parent_id')) : null,
      body_md: get('body_md'),
    },
  })
  if (js) return res.data ? { ok: true, id: res.data.id } : actionError(res)
  const back = backTo(request)
  throw redirect(res.data ? `${back.split('#')[0]}#c${res.data.id}` : `${back}?error=${actionError(res).error}`)
}
