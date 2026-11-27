// The avatar control for settings.
//
//   <AvatarField user={me} action="/settings" />
//
// "Change" (or a dropped / pasted image) opens the cropper; the crop is uploaded
// from the browser, then the page action at `action` receives
// { intent: 'avatar', media_id } and should call PUT /users/me/avatar.
// "Remove" posts { intent: 'avatar-remove' } and works without JavaScript.
// The action should answer { intent, ok: true } or { intent, error }.
import type { User } from '@buildwith/api-client'
import { Avatar, Button, cx } from '@buildwith/ui'
import { Camera } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { FormFields, useHydrated } from '../forms'
import { ImageCropper } from './ImageCropper'
import { ACCEPT, MAX_BYTES } from './upload'
import { usePhotoField } from './usePhotoField'

export function AvatarField({ user, action = '/settings' }: { user: User; action?: string }) {
  const t = useT()
  const hydrated = useHydrated()
  const p = usePhotoField({ intent: 'avatar', current: user.avatar_url, action })
  const name = user.display_name || user.username
  return (
    <div
      {...p.dropProps}
      className={cx(
        'flex items-center gap-4 rounded-card border border-dashed p-4 transition-colors duration-150',
        p.over ? 'border-lapis bg-lapis-soft' : 'border-line',
      )}
    >
      <button
        type="button"
        onClick={p.open}
        disabled={!hydrated}
        aria-label={t('media.change')}
        className="group relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lapis disabled:cursor-default"
      >
        <Avatar name={name} src={p.shown} accent={user.accent} size={72} />
        {hydrated && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            <Camera size={20} />
          </span>
        )}
      </button>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {hydrated && (
            <Button variant="secondary" size="sm" onClick={p.open}>
              {t(p.shown ? 'media.change' : 'media.add')}
            </Button>
          )}
          {p.shown && (
            <p.fetcher.Form method="post" action={action} onSubmit={p.onRemoveSubmit}>
              <FormFields />
              <button
                type="submit"
                name="intent"
                value="avatar-remove"
                className="h-8 rounded-control px-2 text-sm text-muted hover:bg-sunken hover:text-danger"
              >
                {t('settings.remove')}
              </button>
            </p.fetcher.Form>
          )}
        </div>
        <p className="text-xs text-muted">
          {hydrated
            ? `${t('media.drop_hint')} · ${t('media.limits', { mb: MAX_BYTES.avatar >> 20 })}`
            : t('media.needs_js')}
        </p>
        {p.error && (
          <p role="alert" className="text-xs text-danger">
            {t(`error.${p.error}`)}
          </p>
        )}
      </div>
      <input
        ref={p.inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          p.pick(e.target.files)
          e.target.value = ''
        }}
      />
      <ImageCropper file={p.file} kind="avatar" onClose={p.closeCropper} onUploaded={p.onUploaded} />
    </div>
  )
}
