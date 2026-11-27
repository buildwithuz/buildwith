import { redirect } from 'react-router'
import { actionError, api, backTo, readForm } from '../../lib/api.server'
import type { Route } from './+types/comment'

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf, js, intent } = await readForm(request)
  if (intent === 'edit') {
    const id = Number(get('id'))
    const res = await api(context, csrf).PATCH('/comments/{id}', {
      params: { path: { id } },
      body: { body_md: get('body_md') },
    })
    if (js) return res.data ? { ok: true } : actionError(res)
    const back = new URL(backTo(request), 'http://x')
    back.searchParams.delete('editc')
    if (!res.data) back.searchParams.set('error', actionError(res).error)
    throw redirect(`${back.pathname}${back.search}#c${id}`)
  }
  const res = await api(context, csrf).POST('/comments', {
    body: {
      subject_type: get('subject_type') as 'link' | 'article',
      subject_id: Number(get('subject_id')),
      parent_id: get('parent_id') ? Number(get('parent_id')) : null,
      body_md: get('body_md'),
    },
  })
  if (js) return res.data ? { ok: true, id: res.data.id } : actionError(res)
  const back = new URL(backTo(request), 'http://x')
  back.hash = ''
  if (res.data) {
    back.searchParams.delete('error')
    throw redirect(`${back.pathname}${back.search}#c${res.data.id}`)
  }
  back.searchParams.set('error', actionError(res).error)
  throw redirect(`${back.pathname}${back.search}#comment-form`)
}
