import { data } from 'react-router'

/** "@aziz" → "aziz"; anything else is not a profile and 404s. */
export function usernameFrom(handle: string | undefined): string {
  if (!handle?.startsWith('@') || handle.length < 3) throw data(null, { status: 404 })
  return handle.slice(1)
}
