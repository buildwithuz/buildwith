import { Button, cx, Dialog } from '@buildwith/ui'
import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLang, useT, useTx } from '../../lib/i18n'
import { formatDate } from '../../lib/time'

interface Version {
  n: number
  title: string
  created_at: string
}

/**
 * Saved versions of a draft, newest first. Reads straight from the API in the
 * browser (GET needs no CSRF token) and hands a chosen version back to restore.
 */
export function VersionsDialog({
  articleId,
  onRestore,
}: {
  articleId: number
  onRestore: (v: { title: string; body_md: string }) => void
}) {
  const t = useT()
  const tx = useTx()
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Version[] | null>(null)
  const [picked, setPicked] = useState<(Version & { body_md: string }) | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    if (!open) return
    setPicked(null)
    setState('loading')
    fetch(`/v1/articles/${articleId}/versions`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { items: Version[] }) => {
        setList(d.items)
        setState('idle')
      })
      .catch(() => setState('error'))
  }, [open, articleId])

  const view = (n: number) => {
    setState('loading')
    fetch(`/v1/articles/${articleId}/versions/${n}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((v: Version & { body_md: string }) => {
        setPicked(v)
        setState('idle')
      })
      .catch(() => setState('error'))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      wide
      title={picked ? t('write.version_n', { n: picked.n }) : t('article.versions')}
      description={picked ? formatDate(picked.created_at, lang, true) : t('write.versions_hint')}
      closeLabel={t('common.close')}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t('article.versions')} title={t('article.versions')}>
          <History size={15} aria-hidden="true" />
          <span className="hidden md:inline">{t('article.versions')}</span>
        </Button>
      }
    >
      {state === 'error' && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {t('error.internal')}
        </p>
      )}
      {picked ? (
        <div className="flex flex-col gap-4">
          <div className="max-h-[50vh] overflow-auto rounded-control border border-line bg-sunken p-4">
            <p className="mb-3 font-serif text-lg font-semibold text-ink">
              {tx.text(picked.title) || t('write.untitled')}
            </p>
            <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-ink">
              {picked.body_md}
            </pre>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
              {t('common.back')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onRestore({ title: picked.title, body_md: picked.body_md })
                setOpen(false)
              }}
            >
              {t('write.restore')}
            </Button>
          </div>
        </div>
      ) : list && list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t('write.versions_empty')}</p>
      ) : (
        <ol
          className={cx(
            'max-h-[60vh] divide-y divide-line overflow-auto rounded-control border border-line',
            state === 'loading' && 'opacity-60',
          )}
          aria-busy={state === 'loading'}
        >
          {(list ?? []).map((v) => (
            <li key={v.n}>
              <button
                type="button"
                onClick={() => view(v.n)}
                className="flex w-full items-baseline gap-3 px-3 py-2.5 text-left hover:bg-sunken"
              >
                <span className="w-8 shrink-0 font-mono text-xs text-muted">#{v.n}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {tx.text(v.title) || t('write.untitled')}
                </span>
                <span className="shrink-0 text-xs text-muted">{formatDate(v.created_at, lang, true)}</span>
              </button>
            </li>
          ))}
          {!list && <li className="px-3 py-6 text-center text-sm text-muted">{t('write.loading')}</li>}
        </ol>
      )}
    </Dialog>
  )
}
