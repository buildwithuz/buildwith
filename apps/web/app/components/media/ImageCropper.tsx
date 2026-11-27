// Crop, zoom and rotate an image in the browser, then upload the result.
//
//   <ImageCropper file={file} kind="avatar" onClose={() => setFile(null)} onUploaded={(m) => save(m.id)} />
//
// The dialog is open while `file` is set. It draws the crop on a canvas at the
// server's target size (avatar 400×400, banner 1500×500, cover 1600×840) and
// uploads it with uploadImage(), showing progress. Errors are translated API
// error codes. Huge sources are downscaled first so phones don't run out of memory.
import { Button, cx, Dialog } from '@buildwith/ui'
import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useCsrf } from '../forms'
import { ACCEPT, MAX_BYTES, UploadError, type Uploaded, uploadImage } from './upload'

export type CropKind = 'avatar' | 'banner' | 'cover'

export const CROP_TARGET: Record<CropKind, { w: number; h: number }> = {
  avatar: { w: 400, h: 400 },
  banner: { w: 1500, h: 500 },
  cover: { w: 1600, h: 840 },
}

const MAX_SOURCE = 4000
const MAX_ZOOM = 5

interface Source {
  image: CanvasImageSource
  w: number
  h: number
  alpha: boolean
  close: () => void
}

/** Decode (honouring EXIF orientation), downscale past 4000 px, and note transparency. */
async function loadSource(file: File, checkAlpha: boolean): Promise<Source> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new UploadError('unsupported_media')
  }
  let image: CanvasImageSource = bmp
  let w = bmp.width
  let h = bmp.height
  const scale = Math.min(1, MAX_SOURCE / Math.max(w, h))
  if (scale < 1) {
    w = Math.round(w * scale)
    h = Math.round(h * scale)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    image = c
  }
  let alpha = false
  if (checkAlpha && file.type !== 'image/jpeg') {
    const probe = document.createElement('canvas')
    probe.width = 96
    probe.height = 96
    const ctx = probe.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0, 96, 96)
    const px = ctx.getImageData(0, 0, 96, 96).data
    for (let i = 3; i < px.length; i += 4) {
      if (px[i]! < 250) {
        alpha = true
        break
      }
    }
  }
  return { image, w, h, alpha, close: () => image instanceof ImageBitmap && image.close() }
}

interface View {
  zoom: number
  rot: number
  /** Offset of the image centre from the frame centre, as a fraction of the frame size. */
  x: number
  y: number
}

const START: View = { zoom: 1, rot: 0, x: 0, y: 0 }

function bounds(src: Source, v: View, aspect: number) {
  const rw = v.rot % 2 ? src.h : src.w
  const rh = v.rot % 2 ? src.w : src.h
  // In units of the frame height = 1, width = aspect.
  const s = Math.max(aspect / rw, 1 / rh) * v.zoom
  return { maxX: Math.max(0, (rw * s - aspect) / (2 * aspect)), maxY: Math.max(0, (rh * s - 1) / 2) }
}

function clamp(src: Source, v: View, aspect: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom))
  const b = bounds(src, { ...v, zoom }, aspect)
  return {
    ...v,
    zoom,
    x: Math.min(b.maxX, Math.max(-b.maxX, v.x)),
    y: Math.min(b.maxY, Math.max(-b.maxY, v.y)),
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  src: Source,
  v: View,
  W: number,
  H: number,
  background?: string,
) {
  const rw = v.rot % 2 ? src.h : src.w
  const rh = v.rot % 2 ? src.w : src.h
  const s = Math.max(W / rw, H / rh) * v.zoom
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, W, H)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(W / 2 + v.x * W, H / 2 + v.y * H)
  ctx.rotate((v.rot * Math.PI) / 2)
  ctx.scale(s, s)
  ctx.drawImage(src.image, -src.w / 2, -src.h / 2, src.w, src.h)
  ctx.restore()
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new UploadError('internal'))), type, quality),
  )
}

export function ImageCropper({
  file,
  kind,
  onClose,
  onUploaded,
}: {
  file: File | null
  kind: CropKind
  onClose: () => void
  onUploaded: (media: Uploaded) => void
}) {
  const t = useT()
  const csrf = useCsrf()
  const target = CROP_TARGET[kind]
  const aspect = target.w / target.h
  const [src, setSrc] = useState<Source | null>(null)
  const [view, setView] = useState<View>(START)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setSrc(null)
    setView(START)
    setError(null)
    setProgress(null)
    if (!file) return
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('unsupported_media')
      return
    }
    // The crop is re-encoded, so the source may be bigger than the upload limit, within reason.
    if (file.size > MAX_BYTES[kind] * 6) {
      setError('too_large')
      return
    }
    let live = true
    let loaded: Source | null = null
    loadSource(file, kind === 'avatar')
      .then((s) => {
        loaded = s
        if (live) setSrc(s)
        else s.close()
      })
      .catch((e) => live && setError(e instanceof UploadError ? e.code : 'unsupported_media'))
    return () => {
      live = false
      loaded?.close()
    }
  }, [file, kind])

  const update = useCallback(
    (fn: (v: View) => View) => setView((v) => (src ? clamp(src, fn(v), aspect) : v)),
    [src, aspect],
  )

  // Redraw the preview at device resolution whenever the view or the frame size changes.
  useEffect(() => {
    const frame = frameRef.current
    const canvas = canvasRef.current
    if (!frame || !canvas || !src) return
    const paint = () => {
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(frame.clientWidth * dpr)
      const H = Math.round(frame.clientHeight * dpr)
      if (!W || !H) return
      if (canvas.width !== W) canvas.width = W
      if (canvas.height !== H) canvas.height = H
      draw(canvas.getContext('2d')!, src, view, W, H)
    }
    paint()
    const ro = new ResizeObserver(paint)
    ro.observe(frame)
    return () => ro.disconnect()
  }, [src, view])

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      update((v) => ({ ...v, zoom: v.zoom * Math.exp(-e.deltaY * 0.0015) }))
    }
    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [update])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pinch.current = null
    setDragging(true)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const frame = e.currentTarget
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
      if (pinch.current) {
        const ratio = d / pinch.current
        update((v) => ({ ...v, zoom: v.zoom * ratio }))
      }
      pinch.current = d
      return
    }
    const dx = (e.clientX - prev.x) / frame.clientWidth
    const dy = (e.clientY - prev.y) / frame.clientHeight
    update((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    pinch.current = null
    if (pointers.current.size === 0) setDragging(false)
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.1 : 0.02
    const pan = (x: number, y: number) => (v: View) => ({ ...v, x: v.x + x, y: v.y + y })
    const zoom = (f: number) => (v: View) => ({ ...v, zoom: v.zoom * f })
    const keys = new Map<string, (v: View) => View>([
      ['ArrowLeft', pan(-step, 0)],
      ['ArrowRight', pan(step, 0)],
      ['ArrowUp', pan(0, -step)],
      ['ArrowDown', pan(0, step)],
      ['+', zoom(1.1)],
      ['=', zoom(1.1)],
      ['-', zoom(1 / 1.1)],
      ['_', zoom(1 / 1.1)],
    ])
    const fn = keys.get(e.key)
    if (fn) {
      e.preventDefault()
      update(fn)
    }
  }

  async function save() {
    if (!src) return
    setError(null)
    setProgress(0)
    try {
      const out = document.createElement('canvas')
      out.width = target.w
      out.height = target.h
      const png = kind === 'avatar' && src.alpha
      // JPEG has no transparency; paint a white ground so transparent areas don't turn black.
      draw(out.getContext('2d')!, src, view, target.w, target.h, png ? undefined : '#ffffff')
      const blob = await toBlob(out, png ? 'image/png' : 'image/jpeg', png ? undefined : 0.9)
      abortRef.current = new AbortController()
      const media = await uploadImage(blob, kind, csrf, setProgress, abortRef.current.signal)
      onUploaded(media)
      onClose()
    } catch (e) {
      const code = e instanceof UploadError ? e.code : 'internal'
      if (code !== 'aborted') setError(code)
      setProgress(null)
    }
  }

  function close() {
    abortRef.current?.abort()
    onClose()
  }

  const busy = progress !== null
  const title = t(
    kind === 'avatar' ? 'media.crop_avatar' : kind === 'banner' ? 'media.crop_banner' : 'media.crop_cover',
  )

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(o) => !o && close()}
      title={title}
      description={t('media.crop_help')}
      closeLabel={t('common.close')}
      wide={kind !== 'avatar'}
    >
      <div className="flex flex-col gap-4">
        <div
          ref={frameRef}
          role="application"
          aria-label={title}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the crop frame takes arrow keys and +/-
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={cx(
            'relative mx-auto w-full touch-none select-none overflow-hidden rounded-card bg-sunken outline-none',
            'focus-visible:ring-2 focus-visible:ring-lapis focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
            kind === 'avatar' ? 'max-w-80' : '',
            src ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : '',
          )}
          style={{ aspectRatio: `${target.w} / ${target.h}` }}
        >
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />
          {!src && !error && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
              {t('media.processing')}
            </p>
          )}
          {src && kind === 'avatar' && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.45)] ring-1 ring-white/60"
            />
          )}
          {src && kind !== 'avatar' && dragging && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3"
            >
              {Array.from({ length: 9 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static grid
                <span key={i} className="border border-white/25" />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('media.zoom_out')}
            disabled={!src || busy}
            onClick={() => update((v) => ({ ...v, zoom: v.zoom / 1.2 }))}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </Button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            disabled={!src || busy}
            aria-label={t('media.zoom')}
            onChange={(e) => {
              const zoom = Number(e.target.value)
              update((v) => ({ ...v, zoom }))
            }}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--lapis)]"
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('media.zoom_in')}
            disabled={!src || busy}
            onClick={() => update((v) => ({ ...v, zoom: v.zoom * 1.2 }))}
          >
            <ZoomIn size={16} aria-hidden="true" />
          </Button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('media.rotate')}
            title={t('media.rotate')}
            disabled={!src || busy}
            onClick={() => update((v) => ({ ...v, rot: (v.rot + 1) % 4 }))}
          >
            <RotateCw size={16} aria-hidden="true" />
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          {busy ? (
            <div className="flex flex-1 flex-col gap-1.5" aria-live="polite">
              <span className="text-xs text-muted">
                {t('media.uploading', { percent: Math.round((progress ?? 0) * 100) })}
              </span>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-sunken"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((progress ?? 0) * 100)}
                aria-label={t('media.uploading', { percent: Math.round((progress ?? 0) * 100) })}
              >
                <div
                  className="h-full rounded-full bg-lapis transition-[width] duration-150"
                  style={{ width: `${(progress ?? 0) * 100}%` }}
                />
              </div>
            </div>
          ) : null}
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={!src || busy}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
