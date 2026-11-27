import { Button } from '@buildwith/ui'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useCsrf, useHydrated } from '../forms'
import { ACCEPT, UploadError, uploadImage } from '../media/upload'

/**
 * The article cover: uploads straight to the API from the browser and keeps
 * the media id in a hidden cover_media_id field of the surrounding form.
 */
export function CoverPicker({
  initial,
  onChange,
}: {
  initial: { id: number; url: string } | null
  onChange?: () => void
}) {
  const t = useT()
  const csrf = useCsrf()
  const hydrated = useHydrated()
  const [cover, setCover] = useState(initial)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const hidden = useRef<HTMLInputElement>(null)

  const set = (next: typeof cover) => {
    setCover(next)
    if (hidden.current) hidden.current.value = next ? String(next.id) : ''
    // Let the form notice the change (autosave watches input events).
    hidden.current?.dispatchEvent(new Event('input', { bubbles: true }))
    onChange?.()
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setProgress(0)
    try {
      const m = await uploadImage(file, 'cover', csrf, setProgress)
      set({ id: m.id, url: m.url })
    } catch (e) {
      setError(e instanceof UploadError ? e.code : 'internal')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div>
      <input ref={hidden} type="hidden" name="cover_media_id" defaultValue={cover ? String(cover.id) : ''} />
      {cover ? (
        <div className="group relative overflow-hidden rounded-card border border-line">
          <img
            src={cover.url}
            alt={t('article.cover')}
            className="aspect-[2/1] w-full bg-sunken object-cover"
          />
          {hydrated && (
            <div className="absolute right-2 top-2 flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
                <ImagePlus size={14} aria-hidden="true" /> {t('write.cover_change')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => set(null)}
                aria-label={t('write.cover_remove')}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      ) : hydrated ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="inline-flex items-center gap-2 rounded-control px-2 py-1.5 text-sm text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          <ImagePlus size={16} aria-hidden="true" /> {t('write.cover_add')}
        </button>
      ) : null}
      <p role="status" aria-live="polite" className="mt-1 text-xs">
        {progress !== null && (
          <span className="text-muted">
            {t('editor.uploading_progress', { count: 1, percent: Math.round(progress * 100) })}
          </span>
        )}
        {error && <span className="text-danger">{t(`error.${error}`)}</span>}
      </p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
