import type { User } from '@buildwith/api-client'
import { Avatar, Button, cx, Input, Select, Textarea } from '@buildwith/ui'
import { Code2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useT } from '../lib/i18n'
import { FormFields, useHydrated } from './forms'
import { ImageDropzone, useImageUploads } from './media/ImageDropzone'
import { imagesFrom } from './media/upload'

const MAX = 500

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
  const hydrated = useHydrated()
  const f = useFetcher<{ ok?: boolean; error?: string; path?: string }>()
  const [text, setText] = useState('')
  const [showCode, setShowCode] = useState(false)
  const uploads = useImageUploads({ kind: 'note', max: 4 })
  const resetUploads = uploads.reset
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (f.state === 'idle' && f.data?.ok) {
      formRef.current?.reset()
      setText('')
      resetUploads()
      setShowCode(false)
      onPosted?.()
    }
  }, [f.state, f.data, onPosted, resetUploads])

  const left = MAX - [...text].length
  const busy = f.state !== 'idle' || !uploads.ready

  return (
    <f.Form
      ref={formRef}
      method="post"
      action="/actions/note-new"
      className="flex gap-3 py-3"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        uploads.add(imagesFrom(e.dataTransfer))
      }}
    >
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
          onPaste={uploads.onPaste}
          autoFocus={autoFocus}
          rows={text.length > 80 ? 4 : 2}
          className="resize-y border-transparent bg-transparent px-0 text-[17px] focus:border-transparent"
        />
        {showCode && (
          <div className="flex flex-col gap-2 rounded-card border border-line p-2">
            <Input
              name="code_lang"
              placeholder={t('compose.code_lang')}
              aria-label={t('compose.code_lang')}
              size="sm"
              className="w-48 font-mono"
            />
            <Textarea
              name="code_body"
              aria-label={t('compose.code')}
              rows={5}
              className="font-mono text-sm"
              spellCheck={false}
            />
          </div>
        )}
        <ImageDropzone uploads={uploads} />
        {f.data?.error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${f.data.error}`)}
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
          {!replyTo && (
            <Select
              name="reply_policy"
              aria-label={t('compose.who_can_reply')}
              size="sm"
              className="w-auto text-xs"
            >
              <option value="everyone">{t('compose.reply_everyone')}</option>
              <option value="following">{t('compose.reply_following')}</option>
              <option value="mentioned">{t('compose.reply_mentioned')}</option>
            </Select>
          )}
          <span className="ml-auto flex items-center gap-3">
            <CharRing left={left} label={t('compose.chars_left', { count: left })} />
            <Button
              type="submit"
              size="sm"
              disabled={
                busy ||
                left < 0 ||
                !uploads.allHaveAlt ||
                (hydrated && !text.trim() && uploads.items.length === 0 && !showCode && !quoteOf)
              }
            >
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
      {left < 50 && (
        <span className={cx('font-mono text-xs', left < 0 ? 'text-danger' : 'text-muted')}>{left}</span>
      )}
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
