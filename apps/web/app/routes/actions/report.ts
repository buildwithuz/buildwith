import { actionError, api, finish, readForm } from '../../lib/api.server'
import type { Route } from './+types/report'

type Subject = 'link' | 'article' | 'comment' | 'note' | 'user'
type Reason = 'spam' | 'abuse' | 'off_topic' | 'illegal' | 'duplicate' | 'other'

export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf, js } = await readForm(request)
  const res = await api(context, csrf).POST('/reports', {
    body: {
      subject_type: get('subject_type') as Subject,
      subject_id: Number(get('subject_id')),
      reason: (get('reason') || 'other') as Reason,
      note: get('note'),
    },
  })
  return finish(request, js, res.response.ok ? { ok: true } : actionError(res))
}
