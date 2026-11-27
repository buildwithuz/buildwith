// Translation and script hooks. Strings come from @buildwith/i18n; user content
// is shown in the reader's script through @buildwith/translit.
import { type Lang, translate, translateParts, type Vars } from '@buildwith/i18n'
import { display, displayHTML, type Script } from '@buildwith/translit'
import { createContext, Fragment, type ReactNode, useContext, useMemo } from 'react'

interface I18n {
  lang: Lang
  script: Script
}

const Ctx = createContext<I18n>({ lang: 'uz', script: 'latn' })

export function I18nProvider({ lang, script, children }: I18n & { children: ReactNode }) {
  const value = useMemo(() => ({ lang, script }), [lang, script])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLang() {
  return useContext(Ctx)
}

/**
 * t(key, vars) for interface text. Uzbek UI text is written in Latin and shown
 * in Cyrillic when the reader chose it; Russian and English are left alone.
 */
export function useT() {
  const { lang, script } = useContext(Ctx)
  return useMemo(() => {
    const t = (key: string, vars?: Vars) => {
      const s = translate(lang, key, vars)
      return lang === 'uz' ? display(s, script) : s
    }
    /** For messages with <tags>: map each tag to a renderer. */
    t.rich = (key: string, tags: Record<string, (chunks: ReactNode) => ReactNode>, vars?: Vars): ReactNode => {
      const handlers: Vars = { ...vars }
      for (const [k, fn] of Object.entries(tags)) {
        handlers[k] = (chunks: unknown[]) => fn(<>{chunks as ReactNode[]}</>)
      }
      const parts = translateParts(lang, key, handlers)
      return parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: message parts are positional
        <Fragment key={i}>{typeof p === 'string' && lang === 'uz' ? display(p, script) : (p as ReactNode)}</Fragment>
      ))
    }
    return t
  }, [lang, script])
}

/** User content in the reader's script. Never use for code, URLs or usernames. */
export function useTx() {
  const { script } = useContext(Ctx)
  return useMemo(
    () => ({
      text: (s: string | null | undefined) => display(s ?? '', script),
      html: (h: string | null | undefined) => displayHTML(h ?? '', script),
    }),
    [script],
  )
}

/** Render sanitized server HTML (Markdown output) in the reader's script. */
export function Html({ html, className }: { html: string | null | undefined; className?: string }) {
  const tx = useTx()
  // The API sanitizes every rendered body with bluemonday before storing it.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized on the server
  return <div className={className} dangerouslySetInnerHTML={{ __html: tx.html(html) }} />
}
