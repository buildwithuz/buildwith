import { type Lang, translate } from '@buildwith/i18n'
import { display, type Script } from '@buildwith/translit'

type Match = { id: string; loaderData?: unknown } | undefined

function rootPrefs(matches: Match[]): { lang: Lang; script: Script } {
  const root = matches.find((m) => m?.id === 'root')?.loaderData as
    | { lang?: Lang; script?: Script }
    | undefined
  return { lang: root?.lang ?? 'uz', script: root?.script ?? 'latn' }
}

/** Page <title> and description from an i18n key or literal text. */
export function pageMeta(
  matches: Match[],
  opts: { titleKey?: string; title?: string; description?: string; image?: string; noindex?: boolean },
) {
  const { lang, script } = rootPrefs(matches)
  const tr = (s: string) => (lang === 'uz' ? display(s, script) : s)
  const name = translate(lang, 'app.name')
  const raw = opts.title ?? (opts.titleKey ? translate(lang, opts.titleKey) : '')
  const title = raw ? `${tr(raw)} · ${name}` : `${name} — ${tr(translate(lang, 'app.tagline'))}`
  const description = opts.description ?? translate(lang, 'app.tagline')
  const out: Record<string, string>[] = [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: raw ? tr(raw) : name },
    { property: 'og:description', content: description },
    { property: 'og:site_name', content: name },
    { name: 'twitter:card', content: opts.image ? 'summary_large_image' : 'summary' },
  ]
  if (opts.image) out.push({ property: 'og:image', content: opts.image })
  if (opts.noindex) out.push({ name: 'robots', content: 'noindex' })
  return out
}
