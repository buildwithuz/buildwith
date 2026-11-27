// Multi-image attachments (the note composer, and anything else that needs them).
//
//   const uploads = useImageUploads({ kind: 'note', max: 4 })
//   <textarea onPaste={uploads.onPaste} />           // optional: paste images into the text
//   <ImageDropzone uploads={uploads} />              // picker, drop target, previews, alt text
//   <button disabled={!uploads.ready || !uploads.allHaveAlt}>Post</button>
//   uploads.reset()                                  // after a successful post
//
// useImageUploads(options) → {
//   items: UploadItem[]          in order; each { id, file, preview (object URL), status: 'uploading'|'done'|'error',
//                                progress 0..1, error?: ErrorCode, media?: Uploaded, alt }
//   add(files)                   File[] | FileList; keeps images only, up to `max`; uploads start at once
//   remove(id)                   aborts an upload in flight and revokes its preview URL
//   move(id, -1 | 1)             reorder
//   setAlt(id, text)
//   retry(id)                    re-upload a failed item
//   reset()                      clear everything (after posting)
//   onPaste                      ClipboardEvent handler that adds pasted images
//   ready                        nothing uploading and nothing failed (true when empty)
//   allHaveAlt                   every item has non-blank alt text (true when empty)
//   full                         items.length >= max
//   notice                       a translated-key error for the last add (too many / wrong type), or null
// }
//
// <ImageDropzone> renders hidden inputs `media_id` and `media_alt` for each
// finished item, in order, so a plain <form> submission carries them (the
// /actions/note-new action reads exactly these names). Without JavaScript it
// renders nothing: uploads happen in the browser.
import { cx } from '@buildwith/ui'
import { ArrowLeft, ArrowRight, ImagePlus, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useCsrf, useHydrated } from '../forms'
import {
  ACCEPT,
  imagesFrom,
  precheck,
  UploadError,
  type Uploaded,
  type UploadKind,
  uploadImage,
} from './upload'

export interface UploadItem {
  id: string
  file: File
  preview: string
  status: 'uploading' | 'done' | 'error'
  progress: number
  error?: string
  media?: Uploaded
  alt: string
}

let seq = 0

export function useImageUploads({ kind = 'note', max = 4 }: { kind?: UploadKind; max?: number } = {}) {
  const csrf = useCsrf()
  const [items, setItems] = useState<UploadItem[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const aborts = useRef(new Map<string, AbortController>())
  const urls = useRef(new Set<string>())
  // The latest list, for callbacks that must not run side effects inside state updaters.
  const current = useRef<UploadItem[]>([])
  current.current = items

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  }, [])

  const start = useCallback(
    (item: UploadItem) => {
      const bad = precheck(item.file, kind)
      if (bad) {
        patch(item.id, { status: 'error', error: bad })
        return
      }
      const ctl = new AbortController()
      aborts.current.set(item.id, ctl)
      patch(item.id, { status: 'uploading', progress: 0, error: undefined })
      uploadImage(item.file, kind, csrf, (progress) => patch(item.id, { progress }), ctl.signal)
        .then((media) => patch(item.id, { status: 'done', progress: 1, media }))
        .catch((e) => {
          const code = e instanceof UploadError ? e.code : 'internal'
          if (code !== 'aborted') patch(item.id, { status: 'error', error: code })
        })
        .finally(() => aborts.current.delete(item.id))
    },
    [csrf, kind, patch],
  )

  const add = useCallback(
    (files: File[] | FileList | null | undefined) => {
      const list = Array.from(files ?? [])
      const images = list.filter((f) => ACCEPT.split(',').includes(f.type))
      const room = Math.max(0, max - current.current.length)
      setNotice(
        images.length > room
          ? 'media.too_many'
          : images.length < list.length
            ? 'error.unsupported_media'
            : null,
      )
      const fresh = images.slice(0, room).map((file): UploadItem => {
        const preview = URL.createObjectURL(file)
        urls.current.add(preview)
        return { id: `u${++seq}`, file, preview, status: 'uploading', progress: 0, alt: '' }
      })
      if (!fresh.length) return
      current.current = [...current.current, ...fresh]
      setItems((xs) => [...xs, ...fresh])
      // Updates queue in order, so progress patches always find the new items.
      for (const it of fresh) start(it)
    },
    [max, start],
  )

  const remove = useCallback((id: string) => {
    aborts.current.get(id)?.abort()
    const gone = current.current.find((x) => x.id === id)
    if (gone) {
      URL.revokeObjectURL(gone.preview)
      urls.current.delete(gone.preview)
    }
    current.current = current.current.filter((x) => x.id !== id)
    setItems((xs) => xs.filter((x) => x.id !== id))
    setNotice(null)
  }, [])

  const move = useCallback((id: string, dir: -1 | 1) => {
    setItems((xs) => {
      const i = xs.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= xs.length) return xs
      const next = [...xs]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }, [])

  /** Move `id` to the position of `target` (drag and drop). */
  const place = useCallback((id: string, target: string) => {
    setItems((xs) => {
      const from = xs.findIndex((x) => x.id === id)
      const to = xs.findIndex((x) => x.id === target)
      if (from < 0 || to < 0 || from === to) return xs
      const next = [...xs]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it!)
      return next
    })
  }, [])

  const setAlt = useCallback((id: string, alt: string) => patch(id, { alt }), [patch])

  const retry = useCallback(
    (id: string) => {
      const it = current.current.find((x) => x.id === id)
      if (it) start(it)
    },
    [start],
  )

  const reset = useCallback(() => {
    for (const c of aborts.current.values()) c.abort()
    for (const u of urls.current) URL.revokeObjectURL(u)
    urls.current.clear()
    current.current = []
    setItems([])
    setNotice(null)
  }, [])

  useEffect(
    () => () => {
      for (const c of aborts.current.values()) c.abort()
      for (const u of urls.current) URL.revokeObjectURL(u)
    },
    [],
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = imagesFrom(e.clipboardData)
      if (files.length) {
        e.preventDefault()
        add(files)
      }
    },
    [add],
  )

  return {
    items,
    add,
    remove,
    move,
    place,
    setAlt,
    retry,
    reset,
    onPaste,
    notice,
    max,
    full: items.length >= max,
    ready: items.every((x) => x.status === 'done'),
    allHaveAlt: items.every((x) => x.alt.trim().length > 0),
  }
}

export type ImageUploads = ReturnType<typeof useImageUploads>

function Ring({ value }: { value: number }) {
  const r = 14
  const c = 2 * Math.PI * r
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" className="-rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
        className="transition-[stroke-dashoffset] duration-150"
      />
    </svg>
  )
}

export function ImageDropzone({ uploads, className }: { uploads: ImageUploads; className?: string }) {
  const t = useT()
  const hydrated = useHydrated()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const { items } = uploads
  if (!hydrated) return null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole area is a drop and paste target; the button inside is the keyboard path
    <div
      className={cx('flex flex-col gap-2', className)}
      onPaste={uploads.onPaste}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(false)
        uploads.add(imagesFrom(e.dataTransfer))
      }}
    >
      {items.length > 0 && (
        <ul className={cx('grid gap-2', items.length === 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2')}>
          {items.map((it, i) => {
            const missing = !it.alt.trim()
            const label = t('media.image_n', { n: i + 1 })
            return (
              <li
                key={it.id}
                draggable
                onDragStart={(e) => {
                  setDragId(it.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', it.id)
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (dragId) e.preventDefault()
                }}
                onDrop={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.stopPropagation()
                  uploads.place(dragId, it.id)
                  setDragId(null)
                }}
                className={cx(
                  'flex flex-col gap-1.5 rounded-card border border-line bg-surface p-1.5',
                  dragId === it.id && 'opacity-50',
                )}
              >
                <div className="relative overflow-hidden rounded-control bg-sunken">
                  <img
                    src={it.preview}
                    alt=""
                    className="aspect-[4/3] w-full object-cover"
                    draggable={false}
                  />
                  {it.status === 'uploading' && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                      <Ring value={it.progress} />
                      <span className="sr-only">
                        {t('media.uploading', { percent: Math.round(it.progress * 100) })}
                      </span>
                    </span>
                  )}
                  {it.status === 'error' && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 p-2 text-center text-xs text-white">
                      <span role="alert">{t(`error.${it.error ?? 'internal'}`)}</span>
                      {it.error !== 'unsupported_media' && it.error !== 'too_large' && (
                        <button
                          type="button"
                          onClick={() => uploads.retry(it.id)}
                          className="inline-flex items-center gap-1 rounded-control bg-surface px-2 py-1 text-ink hover:bg-sunken"
                        >
                          <RotateCcw size={12} aria-hidden="true" /> {t('media.retry')}
                        </button>
                      )}
                    </span>
                  )}
                  <span
                    title={t(missing ? 'media.alt_missing' : 'media.alt_done')}
                    className={cx(
                      'absolute bottom-1.5 left-1.5 rounded px-1.5 font-mono text-[10px] font-semibold leading-4',
                      missing ? 'bg-saffron text-on-accent' : 'bg-surface text-ink',
                    )}
                  >
                    {t('media.alt')}
                    <span className="sr-only">: {t(missing ? 'media.alt_missing' : 'media.alt_done')}</span>
                  </span>
                  <div className="absolute right-1 top-1 flex gap-1">
                    {items.length > 1 && (
                      <>
                        <IconBtn
                          label={`${t('media.move_left')}: ${label}`}
                          disabled={i === 0}
                          onClick={() => uploads.move(it.id, -1)}
                        >
                          <ArrowLeft size={14} />
                        </IconBtn>
                        <IconBtn
                          label={`${t('media.move_right')}: ${label}`}
                          disabled={i === items.length - 1}
                          onClick={() => uploads.move(it.id, 1)}
                        >
                          <ArrowRight size={14} />
                        </IconBtn>
                      </>
                    )}
                    <IconBtn label={`${t('media.remove')}: ${label}`} onClick={() => uploads.remove(it.id)}>
                      <X size={14} />
                    </IconBtn>
                  </div>
                </div>
                <input
                  type="text"
                  name="media_alt"
                  value={it.alt}
                  maxLength={1000}
                  onChange={(e) => uploads.setAlt(it.id, e.target.value)}
                  placeholder={t('media.alt_missing')}
                  aria-label={`${label}: ${t('media.alt_label')}`}
                  aria-invalid={missing || undefined}
                  className={cx(
                    'h-8 w-full rounded-control border bg-surface px-2 text-sm text-ink placeholder:text-muted focus:border-lapis focus:outline-none',
                    missing ? 'border-saffron' : 'border-line',
                  )}
                  disabled={it.status !== 'done'}
                />
                {it.status === 'done' && it.media && (
                  <input type="hidden" name="media_id" value={it.media.id} />
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!uploads.full && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cx(
            'flex items-center justify-center gap-2 rounded-card border border-dashed px-3 py-3 text-sm transition-colors duration-150',
            over
              ? 'border-lapis bg-lapis-soft text-lapis'
              : 'border-line text-muted hover:border-muted hover:text-ink',
          )}
        >
          <ImagePlus size={16} aria-hidden="true" />
          <span>{over ? t('media.drop_here') : t('media.add_images')}</span>
          <span className="hidden text-xs sm:inline">· {t('media.max_images', { count: uploads.max })}</span>
        </button>
      )}
      {uploads.notice && (
        <p role="alert" className="text-xs text-danger">
          {t(uploads.notice, { count: uploads.max })}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          uploads.add(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-full bg-surface/90 sm:size-6 text-ink shadow-sm hover:bg-surface disabled:opacity-40"
    >
      {children}
    </button>
  )
}
