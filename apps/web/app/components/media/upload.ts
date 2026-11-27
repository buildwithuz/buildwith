// Browser-side image upload with progress. The API decodes, strips metadata and
// re-encodes every image; this only moves bytes and reports progress.

export type UploadKind = 'avatar' | 'banner' | 'note' | 'article' | 'cover'

export interface Uploaded {
  id: number
  url: string
  width: number
  height: number
  mime: string
}

/** A failed upload; `code` is an API ErrorCode (translate with t(`error.${code}`)). */
export class UploadError extends Error {
  constructor(public code: string) {
    super(code)
  }
}

/** Upload limits mirror apps/api/internal/media (checked again on the server). */
export const MAX_BYTES: Record<UploadKind, number> = {
  avatar: 5 << 20,
  banner: 8 << 20,
  note: 10 << 20,
  article: 10 << 20,
  cover: 10 << 20,
}

export const ACCEPT = 'image/jpeg,image/png,image/webp'

/** Rejects obviously wrong files before spending bandwidth. */
export function precheck(file: Blob, kind: UploadKind): string | null {
  if (!ACCEPT.split(',').includes(file.type)) return 'unsupported_media'
  if (file.size > MAX_BYTES[kind]) return 'too_large'
  return null
}

export function uploadImage(
  file: Blob,
  kind: UploadKind,
  csrf: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Uploaded> {
  const bad = precheck(file, kind)
  if (bad) return Promise.reject(new UploadError(bad))
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/v1/media')
    xhr.setRequestHeader('X-CSRF-Token', csrf)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status === 201) {
        onProgress?.(1)
        resolve(xhr.response as Uploaded)
      } else {
        const code = (xhr.response as { code?: string } | null)?.code
        reject(new UploadError(code ?? (xhr.status === 413 ? 'too_large' : 'internal')))
      }
    }
    xhr.onerror = () => reject(new UploadError('internal'))
    xhr.onabort = () => reject(new UploadError('aborted'))
    signal?.addEventListener('abort', () => xhr.abort())
    const body = new FormData()
    body.set('kind', kind)
    body.set('file', file, file instanceof File ? file.name : 'image')
    xhr.send(body)
  })
}

/** Image files from a paste or drop event, in order. */
export function imagesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter((f) => f.type.startsWith('image/'))
}
