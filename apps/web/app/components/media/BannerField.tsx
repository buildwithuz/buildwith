// The profile banner control for settings.
//
//   <BannerField current={me.banner_url} action="/settings" />
//
// Same contract as AvatarField, with intents 'banner' (media_id) and
// 'banner-remove'; the crop is 3:1 at 1500×500.
import { Button, cx, Girih } from '@buildwith/ui'
import { ImagePlus } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { FormFields, useHydrated } from '../forms'
import { ImageCropper } from './ImageCropper'
import { ACCEPT, MAX_BYTES } from './upload'
import { usePhotoField } from './usePhotoField'

export function BannerField({
  current,
  action = '/settings',
}: {
  current: string | null | undefined
  action?: string
}) {
  const t = useT()
  const hydrated = useHydrated()
  const p = usePhotoField({ intent: 'banner', current, action })
  return (
    <div {...p.dropProps} className="flex flex-col gap-3">
      <button
        type="button"
        onClick={p.open}
        disabled={!hydrated}
        aria-label={t('media.change')}
        className={cx(
          'group relative block aspect-[3/1] w-full overflow-hidden rounded-card border transition-colors duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lapis disabled:cursor-default',
          p.over ? 'border-lapis bg-lapis-soft' : 'border-line bg-sunken',
          !p.shown && 'border-dashed',
        )}
      >
        {p.shown ? (
          <img src={p.shown} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center gap-3 text-muted">
            <Girih size={44} className="text-muted/40" />
            <span className="text-sm">{t('settings.no_banner')}</span>
          </span>
        )}
        {hydrated && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            <ImagePlus size={22} />
          </span>
        )}
      </button>
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
              value="banner-remove"
              className="h-8 rounded-control px-2 text-sm text-muted hover:bg-sunken hover:text-danger"
            >
              {t('settings.remove')}
            </button>
          </p.fetcher.Form>
        )}
        <p className="text-xs text-muted">
          {hydrated
            ? `${t('media.drop_hint')} · ${t('media.limits', { mb: MAX_BYTES.banner >> 20 })}`
            : t('media.needs_js')}
        </p>
      </div>
      {p.error && (
        <p role="alert" className="text-xs text-danger">
          {t(`error.${p.error}`)}
        </p>
      )}
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
      <ImageCropper file={p.file} kind="banner" onClose={p.closeCropper} onUploaded={p.onUploaded} />
    </div>
  )
}
