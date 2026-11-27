import { buttonClass, Girih } from '@buildwith/ui'
import { useT } from '../lib/i18n'

export function ErrorPage({ status }: { status: number }) {
  const t = useT()
  const notFound = status === 404
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <Girih className="text-line" size={140} />
      <p className="font-mono text-sm text-muted">{status}</p>
      <h1 className="text-2xl font-semibold text-ink">
        {t(notFound ? 'error.not_found_title' : 'error.title')}
      </h1>
      <p className="text-muted">{t(notFound ? 'error.not_found_body' : 'error.internal')}</p>
      <a href="/" className={buttonClass('secondary')}>
        {t('error.go_home')}
      </a>
    </main>
  )
}
