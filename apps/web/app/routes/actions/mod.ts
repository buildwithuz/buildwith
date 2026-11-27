import { actionError, api, finish, readForm } from '../../lib/api.server'
import type { Route } from './+types/mod'

type Kind = 'link' | 'article' | 'comment' | 'note'

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf, js, intent } = await readForm(request)
  const client = api(context, csrf)
  const subject = { subject_type: get('subject_type') as Kind, subject_id: Number(get('subject_id')) }
  const res = await (() => {
    switch (intent) {
      case 'kill':
      case 'unkill':
        return client.POST('/mod/kill', { body: { ...subject, killed: intent === 'kill', reason: get('reason') } })
      case 'release':
        return client.POST('/mod/holds', { body: subject })
      case 'dismiss':
      case 'actioned':
        return client.POST('/mod/reports/{id}', {
          params: { path: { id: Number(get('report_id')) } },
          body: { status: intent === 'dismiss' ? 'dismissed' : 'actioned', reason: get('reason') },
        })
      case 'ban':
      case 'unban':
        return client.POST('/mod/ban', { body: { username: get('username'), banned: intent === 'ban', reason: get('reason') } })
      default:
        return client.POST('/mod/feature', { body: { article_id: Number(get('article_id')), featured: intent === 'feature' } })
    }
  })()
  return finish(request, js, res.response.ok ? { ok: true } : actionError(res))
}
