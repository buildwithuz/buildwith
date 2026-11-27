// Shared state for AvatarField and BannerField: pick (click, drop, paste) →
// crop → upload → save through a page action, with an optimistic preview.
import { useToast } from '@buildwith/ui'
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useT } from '../../lib/i18n'
import { useCsrf } from '../forms'
import { ACCEPT, imagesFrom, type Uploaded } from './upload'

export interface PhotoResult {
  intent?: string
  ok?: boolean
  error?: string
}

export function usePhotoField({
  intent,
  current,
  action,
}: {
  intent: 'avatar' | 'banner'
  current: string | null | undefined
  action: string
}) {
  const t = useT()
  const toast = useToast()
  const csrf = useCsrf()
  const fetcher = useFetcher<PhotoResult>()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  /** undefined = show `current`; null = removed; string = just uploaded. */
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  const removing = fetcher.formData?.get('intent') === `${intent}-remove`
  const shown = removing ? null : preview === undefined ? (current ?? null) : preview

  const seen = useRef<PhotoResult | undefined>(undefined)
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data || seen.current === fetcher.data) return
    seen.current = fetcher.data
    if (fetcher.data.error) {
      setPreview(undefined)
      setError(fetcher.data.error)
      toast(t(`error.${fetcher.data.error}`), 'error')
    } else if (fetcher.data.ok) {
      toast(t(fetcher.data.intent?.endsWith('-remove') ? 'media.removed' : 'media.updated'))
    }
  }, [fetcher.state, fetcher.data, t, toast])

  function pick(files: File[] | FileList | null | undefined) {
    const f = files ? Array.from(files)[0] : undefined
    if (!f) return
    if (!ACCEPT.split(',').includes(f.type)) {
      setError('unsupported_media')
      return
    }
    setError(null)
    setFile(f)
  }

  function onUploaded(m: Uploaded) {
    setPreview(m.url)
    fetcher.submit({ intent, media_id: String(m.id), _csrf: csrf, _js: '1' }, { method: 'post', action })
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      pick(imagesFrom(e.dataTransfer))
    },
    onPaste: (e: React.ClipboardEvent) => {
      const files = imagesFrom(e.clipboardData)
      if (files.length) {
        e.preventDefault()
        pick(files)
      }
    },
  }

  return {
    fetcher,
    inputRef,
    file,
    closeCropper: () => setFile(null),
    onUploaded,
    pick,
    shown,
    error,
    over,
    dropProps,
    onRemoveSubmit: () => {
      setPreview(undefined)
      setError(null)
    },
    open: () => inputRef.current?.click(),
  }
}
