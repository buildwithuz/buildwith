// Full-screen image viewer for note media and article images.
//
// Mark a container with `data-lightbox` and every <img> inside it opens the
// viewer on click, with its siblings as the gallery. Without JavaScript nothing
// is intercepted, so an image wrapped in <a href={url}> still opens the file.
// Opt an image out with `data-lightbox-skip` on it or an ancestor.
//
// Built on the native <dialog> (showModal): the top layer, inert background,
// focus containment and Esc come from the browser, so no extra dependency.
import { cx } from '@buildwith/ui'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useT, useTx } from '../../lib/i18n'

export interface LightboxImage {
  src: string
  alt: string
  width?: number
  height?: number
}

let opener: ((images: LightboxImage[], index: number) => void) | null = null

/** Open the viewer from code (a "view image" button, say). Returns false before hydration. */
export function openLightbox(images: LightboxImage[], index = 0): boolean {
  if (!opener || images.length === 0) return false
  opener(images, Math.min(Math.max(0, index), images.length - 1))
  return true
}

const IMAGE_URL = /\.(avif|gif|jpe?g|png|webp)(\?|#|$)/i

/** An image link we may intercept: it points at the image itself, not at a page. */
function fullSizeHref(img: HTMLImageElement): string | null | false {
  const a = img.closest('a')
  if (!a) return null
  const href = a.href
  if (href === img.currentSrc || href === img.src || IMAGE_URL.test(new URL(href, location.href).pathname))
    return href
  return false
}

function collect(root: Element): HTMLImageElement[] {
  return Array.from(root.querySelectorAll('img')).filter(
    (img) =>
      !img.closest('[data-lightbox-skip]') &&
      img.closest('[data-lightbox]') === root &&
      fullSizeHref(img) !== false,
  )
}

/** Mount once near the root. Listens for clicks on `[data-lightbox] img`. */
export function LightboxRoot({ children }: { children?: ReactNode }) {
  const [state, setState] = useState<{ images: LightboxImage[]; index: number } | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    opener = (images, index) => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setState({ images, index })
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const img = e.target instanceof Element ? e.target.closest('img') : null
      const root = img?.closest('[data-lightbox]')
      if (!img || !root || img.closest('[data-lightbox-skip]')) return
      const href = fullSizeHref(img)
      if (href === false) return
      const imgs = collect(root)
      const index = imgs.indexOf(img)
      if (index < 0) return
      e.preventDefault()
      returnFocus.current =
        img.closest('a') ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      setState({
        index,
        images: imgs.map((i) => ({
          src: fullSizeHref(i) || i.currentSrc || i.src,
          alt: i.alt,
          width: i.naturalWidth || undefined,
          height: i.naturalHeight || undefined,
        })),
      })
    }
    document.addEventListener('click', onClick)
    return () => {
      opener = null
      document.removeEventListener('click', onClick)
    }
  }, [])

  const close = useCallback(() => {
    setState(null)
    const el = returnFocus.current
    returnFocus.current = null
    // After the dialog has left the top layer, or the browser moves focus to <body>.
    requestAnimationFrame(() => el?.focus({ preventScroll: true }))
  }, [])

  return (
    <>
      {children}
      {state && (
        <Viewer
          images={state.images}
          index={state.index}
          onIndex={(index) => setState((s) => (s ? { ...s, index } : s))}
          onClose={close}
        />
      )}
    </>
  )
}

type Zoom = { ox: number; oy: number; x: number; y: number }

function Viewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: LightboxImage[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const t = useT()
  const tx = useTx()
  const ref = useRef<HTMLDialogElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const [panning, setPanning] = useState(false)
  const drag = useRef<{ x: number; y: number; zx: number; zy: number; moved: boolean; id: number } | null>(
    null,
  )
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  const suppressClick = useRef(false)
  const onImage = (x: number, y: number) => {
    const r = imgRef.current?.getBoundingClientRect()
    return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
  }
  const many = images.length > 1
  const img = images[index]!

  const go = useCallback(
    (d: -1 | 1) => {
      if (!many) return
      onIndex((index + d + images.length) % images.length)
    },
    [many, index, images.length, onIndex],
  )

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
    closeRef.current?.focus()
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prev
      if (d.open) d.close()
    }
  }, [])

  // A new image starts unzoomed; its neighbours load in the background.
  useEffect(() => {
    setZoom(null)
    for (const d of [-1, 1]) {
      const n = images[(index + d + images.length) % images.length]
      if (n && n !== img) new Image().src = n.src
    }
  }, [index, images, img])

  const toggleZoom = (clientX: number, clientY: number) => {
    const el = imgRef.current
    if (!el) return
    if (zoom) return setZoom(null)
    const r = el.getBoundingClientRect()
    setZoom({
      ox: Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)),
      oy: Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100)),
      x: 0,
      y: 0,
    })
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      zx: zoom?.x ?? 0,
      zy: zoom?.y ?? 0,
      moved: false,
      id: e.pointerId,
    }
    // Keep a swipe that leaves the stage (over a button, off-screen) ours until it ends.
    if (e.pointerType !== 'mouse') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // The pointer already ended (or is synthetic): nothing to capture.
      }
    }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      d.moved = true
      if (zoom) setPanning(true)
    }
    if (zoom && d.moved) setZoom({ ...zoom, x: d.zx + dx, y: d.zy + dy })
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (!d || d.id !== e.pointerId) return
    suppressClick.current = d.moved
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!zoom && d.moved && e.pointerType !== 'mouse') {
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose()
      return
    }
    // Double tap: touch screens rarely send dblclick, so count taps ourselves.
    if (!d.moved && e.pointerType !== 'mouse' && onImage(e.clientX, e.clientY)) {
      const now = performance.now()
      const last = lastTap.current
      if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        lastTap.current = null
        toggleZoom(e.clientX, e.clientY)
      } else {
        lastTap.current = { x: e.clientX, y: e.clientY, t: now }
      }
    }
  }

  const posLabel = t('lightbox.position', { index: index + 1, total: images.length })
  const caption = img.alt.trim()
  const roundBtn =
    'flex size-11 items-center justify-center rounded-full bg-black/45 text-white transition-colors duration-150 hover:bg-black/70 focus-visible:outline-white'

  return (
    <dialog
      ref={ref}
      aria-label={t('lightbox.title')}
      aria-roledescription={t('lightbox.title')}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1)
        else if (e.key === 'ArrowRight') go(1)
      }}
      onClick={(e) => {
        // Clicks on the dark area close; clicks on the image, the controls or the end of a drag don't.
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop !== undefined)
          onClose()
      }}
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden bg-black/[.97] p-0 text-white backdrop:bg-black/80 motion-safe:transition-opacity motion-safe:duration-150 starting:opacity-0"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <p className="px-2 font-mono text-sm tabular-nums text-white/70" aria-live="polite">
          {many ? (
            <>
              <span aria-hidden="true">
                {index + 1} / {images.length}
              </span>
              <span className="sr-only">{posLabel}</span>
            </>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className={roundBtn}
          ref={closeRef}
        >
          <X size={22} strokeWidth={1.75} />
        </button>
      </div>

      <div
        data-backdrop=""
        className={cx(
          'relative flex min-h-0 flex-1 touch-none select-none items-center justify-center px-2 sm:px-20',
          zoom && 'cursor-grab active:cursor-grabbing',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null
          setPanning(false)
        }}
      >
        <img
          ref={imgRef}
          key={img.src}
          src={img.src}
          alt={caption || t('lightbox.no_alt')}
          width={img.width}
          height={img.height}
          draggable={false}
          title={zoom ? undefined : t('lightbox.zoom_hint')}
          onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
          className={cx(
            'h-auto max-h-full w-auto max-w-full object-contain',
            zoom ? 'cursor-zoom-out' : 'cursor-zoom-in',
            !panning && 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
          )}
          style={
            zoom
              ? {
                  transform: `translate(${zoom.x}px, ${zoom.y}px) scale(2.5)`,
                  transformOrigin: `${zoom.ox}% ${zoom.oy}%`,
                }
              : undefined
          }
        />
        {many && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t('lightbox.prev')}
              className={cx(roundBtn, 'absolute left-2 top-1/2 -translate-y-1/2 sm:left-4')}
            >
              <ChevronLeft size={26} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t('lightbox.next')}
              className={cx(roundBtn, 'absolute right-2 top-1/2 -translate-y-1/2 sm:right-4')}
            >
              <ChevronRight size={26} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      <div data-backdrop="" className="shrink-0 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
        {caption && (
          <p className="mx-auto line-clamp-4 max-w-2xl text-center text-sm leading-relaxed text-white/85">
            {tx.text(caption)}
          </p>
        )}
      </div>
    </dialog>
  )
}
