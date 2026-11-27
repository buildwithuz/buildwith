import type { User } from '@buildwith/api-client'
import { Avatar, Button, cx, Input, Select, Textarea } from '@buildwith/ui'
import { Code2, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useT } from '../lib/i18n'
import { FormFields, useCsrf } from './forms'

const MAX = 500

type Uploaded = { id: number; url: string; alt: string }

/**
 * The note composer: text with a live character ring, an optional code block,
 * up to four images with required alt text, and who may reply. Works as a plain
 * form; JavaScript adds the counter, uploads and staying on the page.
 */
export function Composer({
  me,
  replyTo,
  quoteOf,
  placeholder,
  autoFocus,
  onPosted,
}: {
  me: User
  replyTo?: number
  quoteOf?: number
  placeholder?: string
  autoFocus?: boolean
  onPosted?: () => void
}) {
  const t = useT()
  const csrf = useCsrf()
  const f = useFetcher<{ ok?: boolean; error?: string; path?: string }>()
  const [text, setText] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [media, setMedia] = useState<Uploaded[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) {
      formRef.current?.reset()
      setText('')
      setMedia([])
      setShowCode(false)
      onPosted?.()
    }
  }, [f.state, f.data, onPosted])

  const left = MAX - [...text].length
  const busy = f.state !== 'idle' || uploading

  async function upload(files: FileList | null) {
    if (!files) return
    setUploadError(null)
    for (const file of Array.from(files).slice(0, 4 - media.length)) {
      setUploading(true)
      const body = new FormData()
      body.set('kind', 'note')
      body.set('file', file)
      const res = await fetch('/v1/media', { method: 'POST', body, headers: { 'X-CSRF-Token': csrf } })
      setUploading(false)
      if (!res.ok) {
        const e = await res.json().catch(() => ({ code: 'internal' }))
        setUploadError(t(`error.${e.code}`))
        continue
      }
      const m = await res.json()
      setMedia((xs) => [...xs, { id: m.id, url: m.url, alt: '' }])
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <f.Form ref={formRef} method="post" action="/actions/note-new" className="flex gap-3 py-3">
      <FormFields />
      {replyTo && <input type="hidden" name="reply_to_id" value={replyTo} />}
      {quoteOf && <input type="hidden" name="quote_of_id" value={quoteOf} />}
      <Avatar name={me.display_name || me.username} src={me.avatar_url} accent={me.accent} size={40} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Textarea
          name="body_md"
          aria-label={t('compose.note')}
          placeholder={placeholder ?? t('compose.note_placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus={autoFocus}
          rows={text.length > 80 ? 4 : 2}
          className="resize-y border-transparent bg-transparent px-0 text-[17px] focus:border-transparent"
        />
        {showCode && (
          <div className="flex flex-col gap-2 rounded-card border border-line p-2">
            <Input name="code_lang" placeholder={t('compose.code_lang')} aria-label={t('compose.code_lang')} className="h-8 w-40 font-mono text-sm" />
            <Textarea name="code_body" aria-label={t('compose.code')} rows={5} className="font-mono text-sm" spellCheck={false} />
          </div>
        )}
        {media.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {media.map((m, i) => (
              <div key={m.id} className="flex flex-col gap-1">
                <div className="relative">
                  <img src={m.url} alt="" className="h-28 w-full rounded-control object-cover" />
                  <button
                    type="button"
                    onClick={() => setMedia((xs) => xs.filter((x) => x.id !== m.id))}
                    className="absolute right-1 top-1 rounded-full bg-ink/70 p-1 text-paper"
                    aria-label={t('common.delete')}
                  >
                    <X size={14} />
                  </button>
                </div>
                <input type="hidden" name="media_id" value={m.id} />
                <Input
                  name="media_alt"
                  required
                  placeholder={t('compose.alt')}
                  aria-label={t('compose.alt')}
                  value={m.alt}
                  onChange={(e) => setMedia((xs) => xs.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
        )}
        {(f.data?.error || uploadError) && (
          <p role="alert" className="text-sm text-danger">
            {uploadError ?? t(`error.${f.data?.error}`)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            aria-pressed={showCode}
            aria-label={t('compose.add_code')}
            className={cx('rounded-control p-1.5 hover:bg-sunken', showCode ? 'text-lapis' : 'text-muted')}
          >
            <Code2 size={18} strokeWidth={1.75} />
          </button>
          <label
            className={cx('cursor-pointer rounded-control p-1.5 text-muted hover:bg-sunken', media.length >= 4 && 'pointer-events-none opacity-40')}
            aria-label={t('compose.add_image')}
          >
            <ImagePlus size={18} strokeWidth={1.75} />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => upload(e.target.files)}
            />
          </label>
          {!replyTo && (
            <Select name="reply_policy" aria-label={t('compose.who_can_reply')} className="h-8 w-auto text-xs">
              <option value="everyone">{t('compose.reply_everyone')}</option>
              <option value="following">{t('compose.reply_following')}</option>
              <option value="mentioned">{t('compose.reply_mentioned')}</option>
            </Select>
          )}
          <span className="ml-auto flex items-center gap-3">
            <CharRing left={left} label={t('compose.chars_left', { count: left })} />
            <Button type="submit" size="sm" disabled={busy || left < 0 || (!text.trim() && media.length === 0 && !showCode && !quoteOf)}>
              {t(replyTo ? 'common.reply' : 'common.post')}
            </Button>
          </span>
        </div>
      </div>
    </f.Form>
  )
}

function CharRing({ left, label }: { left: number; label: string }) {
  const used = Math.min(1, (MAX - left) / MAX)
  const r = 9
  const c = 2 * Math.PI * r
  const color = left < 0 ? 'var(--danger)' : left < 50 ? 'var(--saffron)' : 'var(--lapis)'
  return (
    <span className="flex items-center gap-1.5" title={label}>
      {left < 50 && <span className={cx('font-mono text-xs', left < 0 ? 'text-danger' : 'text-muted')}>{left}</span>}
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
        <circle
          cx="11"
          cy="11"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - used)}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

