/**
 * MarkdownEditor: the one Markdown input used across the app (comments, notes,
 * READMEs, articles).
 *
 *   <MarkdownEditor name="body_md" profile="comment" label={t('post.add_comment')}
 *     placeholder={t('compose.reply_placeholder')} minRows={4} />
 *
 *   // controlled, with image uploads and a counter
 *   <MarkdownEditor profile="note" uploadKind="note" value={v} onChange={setV}
 *     maxLength={500} label=… onSubmitShortcut={() => form.requestSubmit()} />
 *
 * It renders a real <textarea name=…>, so the surrounding form posts without
 * JavaScript. After hydration it adds a toolbar (bold ⌘B, italic ⌘I, link ⌘K,
 * code ⌘E, code block, quote, lists, heading for articles, image), list
 * continuation on Enter, Tab indentation inside code blocks, image upload by
 * button, paste or drop, and a Write/Preview switch rendered by the server
 * (POST /v1/markdown/preview). `split` shows the preview beside the text on
 * wide screens (default for the article profile). ⌘/Ctrl+Enter calls
 * onSubmitShortcut, or submits the enclosing form.
 */
import type { Schemas } from '@buildwith/api-client'
import { cx } from '@buildwith/ui'
import {
  Bold,
  Code,
  Heading2,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  SquareCode,
  TextQuote,
} from 'lucide-react'
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useSignedIn } from '../../lib/hooks'
import { Html, useT } from '../../lib/i18n'
import { useCsrf, useHydrated } from '../forms'
import { ACCEPT, imagesFrom, precheck, UploadError, uploadImage } from '../media/upload'
import {
  codeBlock,
  continueList,
  type Edit,
  inCodeBlock,
  indent,
  link,
  type Sel,
  toggleLines,
  wrap,
} from './text-ops'

export type EditorProfile = 'comment' | 'note' | 'article'

export interface PreviewResult {
  html: string
  reading_minutes: number
  toc: Schemas['TocEntry'][]
}

export interface MarkdownEditorProps {
  name?: string
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  profile: EditorProfile
  /** Enables the image button, paste and drop. */
  uploadKind?: 'article' | 'note'
  placeholder?: string
  /** Accessible name for the textarea (visually hidden unless showLabel). */
  label: string
  showLabel?: boolean
  minRows?: number
  maxLength?: number
  autoFocus?: boolean
  required?: boolean
  disabled?: boolean
  id?: string
  onSubmitShortcut?: () => void
  /** Preview beside the text on wide screens. Defaults to true for articles. */
  split?: boolean
  /** Called with every fresh server preview (reading time, toc). */
  onPreview?: (r: PreviewResult) => void
  /** Ref to the underlying textarea. */
  textareaRef?: Ref<HTMLTextAreaElement>
  className?: string
  /** Extra classes for the textarea (e.g. a serif face for articles). */
  textareaClassName?: string
  describedBy?: string
}

type Tool = {
  key: string
  icon: LucideIcon
  label: string
  shortcut?: string
  run: () => void
}

let uploadSeq = 0

export function MarkdownEditor({
  name = 'body_md',
  defaultValue = '',
  value,
  onChange,
  profile,
  uploadKind,
  placeholder,
  label,
  showLabel = false,
  minRows = 4,
  maxLength,
  autoFocus,
  required,
  disabled,
  id: idProp,
  onSubmitShortcut,
  split = profile === 'article',
  onPreview,
  textareaRef,
  className,
  textareaClassName,
  describedBy,
}: MarkdownEditorProps) {
  const t = useT()
  const hydrated = useHydrated()
  const signedIn = useSignedIn()
  const csrf = useCsrf()
  const autoId = useId()
  const id = idProp ?? `md-${autoId}`
  const statusId = `${id}-status`
  const ta = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(textareaRef, () => ta.current as HTMLTextAreaElement, [])

  const [inner, setInner] = useState(defaultValue)
  const text = value ?? inner
  const textRef = useRef(text)
  textRef.current = text

  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [mod, setMod] = useState('Ctrl+')
  const [wide, setWide] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [uploads, setUploads] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setMod('⌘')
    if (!split) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [split])

  const setText = useCallback(
    (v: string) => {
      if (value === undefined) setInner(v)
      onChange?.(v)
    },
    [value, onChange],
  )

  // Grow with the content; never shrink below minRows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useEffect(() => {
    const el = ta.current
    if (!el || !hydrated) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [text, hydrated, tab])

  /** Apply an edit through the browser's editing stack so undo/redo keep working. */
  const apply = useCallback(
    (e: Edit) => {
      const el = ta.current
      if (!el) return
      el.focus()
      el.setSelectionRange(e.start, e.end)
      let ok = false
      try {
        ok =
          e.insert === ''
            ? e.start === e.end || document.execCommand('delete')
            : document.execCommand('insertText', false, e.insert)
      } catch {
        ok = false
      }
      if (!ok) {
        el.setRangeText(e.insert, e.start, e.end, 'end')
        setText(el.value)
      }
      el.setSelectionRange(e.select[0], e.select[1])
    },
    [setText],
  )

  const sel = (): Sel => {
    const el = ta.current!
    return { text: el.value, start: el.selectionStart, end: el.selectionEnd }
  }

  // --- images -------------------------------------------------------------
  const fileInput = useRef<HTMLInputElement>(null)
  function insertImages(files: File[]) {
    if (!uploadKind || files.length === 0) return
    for (const file of files) {
      const bad = precheck(file, uploadKind)
      if (bad) {
        setError(bad)
        continue
      }
      const n = ++uploadSeq
      const marker = `![${t('editor.uploading_image')}](uploading-${n})`
      const s = sel()
      // An image gets a paragraph of its own.
      const head = s.text.slice(0, s.start)
      const before = head === '' || head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n'
      const insert = `${before}${marker}\n`
      apply({
        start: s.start,
        end: s.end,
        insert,
        select: [s.start + insert.length, s.start + insert.length],
      })
      setUploads((u) => ({ ...u, [n]: 0 }))
      setError(null)
      const done = () =>
        setUploads((u) => {
          const { [n]: _, ...rest } = u
          return rest
        })
      uploadImage(file, uploadKind, csrf, (p) => setUploads((u) => (n in u ? { ...u, [n]: p } : u)))
        .then((m) => {
          const alt =
            file.name
              .replace(/\.[a-z0-9]+$/i, '')
              .replace(/[-_]+/g, ' ')
              .trim() || t('editor.image_alt')
          replaceMarker(marker, `![${alt}](${m.url})`, alt)
        })
        .catch((err: unknown) => {
          replaceMarker(`${marker}\n`, '', null)
          setError(err instanceof UploadError ? err.code : 'internal')
        })
        .finally(done)
    }
  }

  /** Swap an upload placeholder for the final Markdown, keeping the writer's place. */
  function replaceMarker(marker: string, next: string, alt: string | null) {
    const el = ta.current
    if (!el) return
    const at = el.value.indexOf(marker)
    if (at === -1) return
    const focused = document.activeElement === el
    const { selectionStart: s0, selectionEnd: e0 } = el
    const justAfter = s0 === e0 && (s0 === at + marker.length || s0 === at + marker.length + 1)
    const delta = next.length - marker.length
    const shift = (p: number) => (p >= at + marker.length ? p + delta : Math.min(p, at))
    apply({ start: at, end: at + marker.length, insert: next, select: [shift(s0), shift(e0)] })
    if (alt && justAfter && focused) el.setSelectionRange(at + 2, at + 2 + alt.length)
    else if (!focused) el.blur()
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imagesFrom(e.clipboardData)
    if (uploadKind && files.length) {
      e.preventDefault()
      insertImages(files)
    }
  }
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const onDragEnter = (e: DragEvent) => {
    if (!uploadKind || !hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragOver = (e: DragEvent) => {
    if (uploadKind && hasFiles(e)) e.preventDefault()
  }
  const onDragLeave = () => {
    if (!uploadKind) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (e: DragEvent) => {
    if (!uploadKind) return
    dragDepth.current = 0
    setDragging(false)
    const files = imagesFrom(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    setTab('write')
    const el = ta.current
    // Drop where the pointer is when the browser can tell us; else at the caret.
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offset: number } | null
    }
    if (el && e.target === el && doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(e.clientX, e.clientY)
      if (p) el.setSelectionRange(p.offset, p.offset)
    }
    insertImages(files)
  }

  // --- toolbar -------------------------------------------------------------
  const tools: Tool[] = [
    {
      key: 'bold',
      icon: Bold,
      label: t('editor.bold'),
      shortcut: 'B',
      run: () => apply(wrap(sel(), '**', '**', t('editor.bold_text'))),
    },
    {
      key: 'italic',
      icon: Italic,
      label: t('editor.italic'),
      shortcut: 'I',
      run: () => apply(wrap(sel(), '_', '_', t('editor.italic_text'))),
    },
    {
      key: 'link',
      icon: LinkIcon,
      label: t('editor.link'),
      shortcut: 'K',
      run: () => apply(link(sel(), t('editor.link_text'))),
    },
    {
      key: 'code',
      icon: Code,
      label: t('editor.code'),
      shortcut: 'E',
      run: () => apply(wrap(sel(), '`', '`', 'code')),
    },
    { key: 'codeblock', icon: SquareCode, label: t('editor.code_block'), run: () => apply(codeBlock(sel())) },
    ...(profile === 'article'
      ? [
          {
            key: 'heading',
            icon: Heading2,
            label: t('editor.heading'),
            run: () => apply(toggleLines(sel(), 'heading')),
          },
        ]
      : []),
    {
      key: 'quote',
      icon: TextQuote,
      label: t('editor.quote'),
      run: () => apply(toggleLines(sel(), 'quote')),
    },
    {
      key: 'bullet',
      icon: List,
      label: t('editor.bullet_list'),
      run: () => apply(toggleLines(sel(), 'bullet')),
    },
    {
      key: 'numbered',
      icon: ListOrdered,
      label: t('editor.numbered_list'),
      run: () => apply(toggleLines(sel(), 'numbered')),
    },
    ...(uploadKind
      ? [{ key: 'image', icon: ImagePlus, label: t('editor.image'), run: () => fileInput.current?.click() }]
      : []),
  ]
  const [focusIdx, setFocusIdx] = useState(0)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const onToolbarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
    let next = focusIdx
    if (e.key in keys) next = (focusIdx + keys[e.key]! + tools.length) % tools.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tools.length - 1
    else return
    e.preventDefault()
    setFocusIdx(next)
    toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key === 'Enter') {
      e.preventDefault()
      if (onSubmitShortcut) onSubmitShortcut()
      else ta.current?.form?.requestSubmit()
      return
    }
    if (meta && !e.shiftKey && !e.altKey) {
      const tool = tools.find((x) => x.shortcut && x.shortcut.toLowerCase() === e.key.toLowerCase())
      if (tool) {
        e.preventDefault()
        tool.run()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !meta && !e.altKey) {
      const edit = continueList(sel())
      if (edit) {
        e.preventDefault()
        apply(edit)
      }
      return
    }
    if (e.key === 'Tab' && !meta && !e.altKey) {
      const s = sel()
      if (inCodeBlock(s.text, s.start)) {
        e.preventDefault()
        apply(indent(s, e.shiftKey))
      }
    }
  }

  // --- preview ---------------------------------------------------------------
  const [preview, setPreview] = useState<{ html: string; for: string } | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle')
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview
  const showPreview = tab === 'preview' || (split && wide)
  const canPreview = hydrated && signedIn
  useEffect(() => {
    if (!canPreview || !showPreview) return
    if (preview?.for === text) return
    if (!text.trim()) {
      setPreview({ html: '', for: text })
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(
      async () => {
        setPreviewState('loading')
        try {
          const res = await fetch('/v1/markdown/preview', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
            credentials: 'same-origin',
            body: JSON.stringify({ body_md: text, profile }),
            signal: ctrl.signal,
          })
          if (!res.ok) throw new Error(String(res.status))
          const r = (await res.json()) as PreviewResult
          setPreview({ html: r.html, for: text })
          setPreviewState('idle')
          onPreviewRef.current?.(r)
        } catch (err) {
          if ((err as Error).name !== 'AbortError') setPreviewState('error')
        }
      },
      tab === 'preview' && !preview ? 0 : 500,
    )
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [canPreview, showPreview, text, profile, csrf, tab, preview])

  const count = maxLength !== undefined ? [...text].length : 0
  const over = maxLength !== undefined && count > maxLength
  const uploading = Object.values(uploads)
  const progress = uploading.length
    ? Math.round((uploading.reduce((a, b) => a + b, 0) / uploading.length) * 100)
    : 0
  const prose = profile === 'article' ? 'prose-bw prose-article' : 'prose-bw text-[15px]'
  const tabBtn = (k: 'write' | 'preview', text: string) => (
    <button
      type="button"
      role="tab"
      id={`${id}-tab-${k}`}
      aria-selected={tab === k}
      aria-controls={k === 'write' ? `${id}-write` : `${id}-preview`}
      onClick={() => setTab(k)}
      className={cx(
        '-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] transition-colors duration-150',
        tab === k ? 'border-lapis font-semibold text-ink' : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {text}
    </button>
  )

  const panel = (k: 'write' | 'preview') =>
    hydrated && canPreview ? { role: 'tabpanel', 'aria-labelledby': `${id}-tab-${k}` } : {}

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop zone around the textarea; keyboard users have the image button
    <div
      className={cx(
        'relative rounded-control border bg-surface transition-colors duration-150 focus-within:border-lapis',
        dragging ? 'border-lapis' : 'border-line',
        className,
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <label htmlFor={id} className={showLabel ? 'block px-3 pt-2 text-sm font-medium text-ink' : 'sr-only'}>
        {label}
      </label>

      <div className="flex min-h-9 items-stretch gap-1 border-b border-line px-1.5">
        {hydrated && canPreview && (
          <div role="tablist" aria-label={label} className={cx('flex shrink-0', split && 'lg:hidden')}>
            {tabBtn('write', t('editor.write'))}
            {tabBtn('preview', t('common.preview'))}
          </div>
        )}
        {hydrated ? (
          <div
            ref={toolbarRef}
            role="toolbar"
            aria-label={t('editor.toolbar')}
            aria-controls={id}
            onKeyDown={onToolbarKey}
            className={cx(
              'ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none]',
              tab === 'preview' && !(split && wide) && 'invisible',
            )}
          >
            {tools.map((tool, i) => {
              const Icon = tool.icon
              const hint = tool.shortcut ? `${tool.label} (${mod}${tool.shortcut})` : tool.label
              return (
                <button
                  key={tool.key}
                  type="button"
                  tabIndex={i === focusIdx ? 0 : -1}
                  aria-label={tool.label}
                  aria-keyshortcuts={
                    tool.shortcut ? `Control+${tool.shortcut} Meta+${tool.shortcut}` : undefined
                  }
                  title={hint}
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onFocus={() => setFocusIdx(i)}
                  onClick={tool.run}
                  className="grid size-8 shrink-0 place-items-center rounded-control text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-40"
                >
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        ) : (
          <p className="self-center px-1.5 py-2 text-xs text-muted">{t('compose.markdown_hint')}</p>
        )}
      </div>

      <div className={cx(split && 'lg:grid lg:grid-cols-2 lg:divide-x lg:divide-line')}>
        <div
          id={`${id}-write`}
          {...panel('write')}
          className={cx(tab === 'preview' && 'hidden', split && 'lg:block')}
        >
          <textarea
            ref={ta}
            id={id}
            name={name}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            rows={minRows}
            // biome-ignore lint/a11y/noAutofocus: only when the caller opens the editor on purpose (e.g. Reply)
            autoFocus={autoFocus}
            required={required}
            disabled={disabled}
            aria-describedby={[describedBy, statusId].filter(Boolean).join(' ')}
            aria-invalid={over || undefined}
            spellCheck
            className={cx(
              'block w-full resize-none bg-transparent px-3 py-2.5 text-base leading-relaxed text-ink [tab-size:4] placeholder:text-muted focus:outline-none',
              profile === 'article' && 'min-h-[60vh] px-4 py-4 font-mono text-[15px] leading-7',
              textareaClassName,
            )}
          />
        </div>
        {canPreview && (
          <div
            id={`${id}-preview`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-preview`}
            aria-busy={previewState === 'loading'}
            className={cx(
              'min-w-0',
              tab === 'write' && 'hidden',
              split && 'lg:block',
              profile === 'article' ? 'px-4 py-4 sm:px-6' : 'px-3 py-2.5',
            )}
          >
            {split && (
              <p className="mb-3 hidden font-mono text-[11px] font-medium uppercase tracking-wider text-muted lg:block">
                {t('common.preview')}
              </p>
            )}
            {previewState === 'error' ? (
              <p role="alert" className="text-sm text-danger">
                {t('editor.preview_failed')}
              </p>
            ) : preview?.html ? (
              <Html
                html={preview.html}
                className={cx(prose, 'text-ink', previewState === 'loading' && 'opacity-60')}
              />
            ) : (
              <p className="text-sm text-muted">
                {previewState === 'loading' ? t('editor.preview_loading') : t('editor.preview_empty')}
              </p>
            )}
          </div>
        )}
      </div>

      {(uploadKind || maxLength !== undefined || error) && (
        <div className="flex min-h-8 items-center gap-3 border-t border-line px-3 py-1.5 text-xs text-muted">
          <span id={statusId} role="status" aria-live="polite" className="min-w-0 flex-1 truncate">
            {error ? (
              <span className="text-danger">{t(`error.${error}`)}</span>
            ) : uploading.length > 0 ? (
              <span className="inline-flex items-center gap-2">
                {t('editor.uploading_progress', { count: uploading.length, percent: progress })}
                <span className="h-1 w-20 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                  <span
                    className="block h-full bg-lapis transition-[width] duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </span>
              </span>
            ) : hydrated && uploadKind ? (
              t('editor.image_hint')
            ) : null}
          </span>
          {maxLength !== undefined && (
            <span
              className={cx(
                'shrink-0 font-mono tabular-nums',
                over ? 'font-semibold text-danger' : count > maxLength * 0.9 && 'text-saffron',
              )}
            >
              {t('editor.counter', { count, max: maxLength })}
            </span>
          )}
        </div>
      )}
      {!(uploadKind || maxLength !== undefined || error) && (
        <span id={statusId} className="sr-only" aria-live="polite" />
      )}

      {uploadKind && (
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          tabIndex={-1}
          onChange={(e) => {
            insertImages(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-control border-2 border-dashed border-lapis bg-lapis-soft/80 text-sm font-medium text-lapis">
          {t('editor.drop_here')}
        </div>
      )}
    </div>
  )
}
