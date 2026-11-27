import { Girih, Mark } from '@buildwith/ui'
import type { ReactNode } from 'react'

/** The centered card used by sign-in, sign-out and username pages: girih star, mark, title. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-[calc(100dvh-14rem)] items-center justify-center py-6 sm:py-10">
      <div className="w-full max-w-[400px]">
        <div className="rounded-card border border-line bg-surface px-5 pb-6 pt-7 shadow-[0_1px_0_rgb(0_0_0/0.02),0_12px_40px_-20px_rgb(0_0_0/0.18)] sm:px-8 sm:pb-8 sm:pt-9">
          <div className="relative mx-auto mb-5 flex size-[104px] items-center justify-center">
            <Girih size={104} className="absolute inset-0 text-muted/35" />
            <span className="relative rounded-[14px] bg-surface p-2">
              <Mark size={40} />
            </span>
          </div>
          <h1 className="text-balance text-center text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && (
            <p className="mx-auto mt-2 max-w-[30ch] text-balance text-center text-[15px] leading-relaxed text-muted">
              {subtitle}
            </p>
          )}
          <div className="mt-7">{children}</div>
        </div>
        {footer && <div className="mt-5 px-2 text-center text-xs leading-relaxed text-muted">{footer}</div>}
      </div>
    </div>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-control border border-danger/30 bg-sunken px-3 py-2 text-sm text-danger"
    >
      {children}
    </p>
  )
}
