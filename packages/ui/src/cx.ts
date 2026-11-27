import { type ClassValue, clsx } from 'clsx'

/** Join class names; falsy values are dropped. */
export function cx(...v: ClassValue[]): string {
  return clsx(v)
}
