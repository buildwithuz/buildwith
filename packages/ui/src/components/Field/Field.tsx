import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react'
import { cx } from '../../cx'

const base =
  'rounded-control border border-line bg-surface px-3 text-ink placeholder:text-muted ' +
  'transition-colors duration-150 focus:border-lapis focus:outline-none aria-[invalid=true]:border-danger'

// Full width unless the caller sets a width; two width utilities would fight.
const control = (className?: string) => cx(base, !/(^|\s)(w-|min-w-)/.test(className ?? '') && 'w-full')

type Size = 'sm' | 'md'
const heights: Record<Size, string> = { sm: 'h-8 text-sm', md: 'h-10 text-base' }

export const Input = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: Size }
>(function Input({ className, size = 'md', ...props }, ref) {
  return <input ref={ref} className={cx(control(className), heights[size], className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cx(control(className), 'min-h-24 py-2 text-base leading-relaxed', className)}
        {...props}
      />
    )
  },
)

export const Select = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: Size }
>(function Select({ className, size = 'md', ...props }, ref) {
  return <select ref={ref} className={cx(control(className), heights[size], 'pr-8', className)} {...props} />
})

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Render-prop receives the id and aria props to spread on the control. */
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
  className?: string
}

/** A labelled control with optional hint and error, wired for screen readers. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm text-ink', className)}>
      <input type="checkbox" className="size-4 accent-[var(--lapis)]" {...props} />
      {label}
    </label>
  )
}
