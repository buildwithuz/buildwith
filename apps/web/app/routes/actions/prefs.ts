import { isLang } from '@buildwith/i18n'
import { redirect } from 'react-router'
import { api, readForm, safePath, viewer } from '../../lib/api.server'
import { prefCookie } from '../../lib/prefs.server'
import type { Route } from './+types/prefs'

/** Language, script and theme: cookies for everyone, saved to the account when signed in. */
export async function action({ request, context }: Route.ActionArgs) {
  const { get, csrf } = await readForm(request)
  const lang = get('lang')
  const script = get('script') === 'cyrl' ? 'cyrl' : 'latn'
  const theme = ['light', 'dark'].includes(get('theme')) ? (get('theme') as 'light' | 'dark') : 'system'
  const secure = new URL(request.url).protocol === 'https:'
  const headers = new Headers()
  if (isLang(lang)) headers.append('set-cookie', prefCookie('bw_lang', lang, secure))
  headers.append('set-cookie', prefCookie('bw_script', script, secure))
  headers.append('set-cookie', prefCookie('bw_theme', theme, secure))
  if (viewer(context).me) {
    await api(context, csrf).PATCH('/users/me/preferences', {
      body: { ...(isLang(lang) ? { lang } : {}), script, theme },
    })
  }
  throw redirect(safePath(get('redirectTo')), { headers })
}
