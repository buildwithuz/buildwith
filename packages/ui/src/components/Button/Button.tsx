import { Slot } from 'radix-ui'
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cx } from '../../cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Render the child element (a link, say) with button styling. */
  asChild?: boolean
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-lapis text-on-accent hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:bg-sunken',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-surface text-danger border border-line hover:bg-sunken',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
}

export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) =>
  cx(
    'inline-flex select-none items-center justify-center whitespace-nowrap rounded-control font-medium',
    'transition-[background-color,opacity] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    extra,
  )

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', asChild, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={buttonClass(variant, size, className)}
      {...props}
    />
  )
})
