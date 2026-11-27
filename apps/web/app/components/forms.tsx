import { useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import type { RootData } from '../root'

/** The CSRF token every mutating form must carry. */
export function CsrfField() {
  const root = useRouteLoaderData<RootData>('root')
  return <input type="hidden" name="_csrf" value={root?.csrf ?? ''} />
}

export function useHydrated() {
  const [h, setH] = useState(false)
  useEffect(() => setH(true), [])
  return h
}

/**
 * Marks a submission as coming from JavaScript, so the action answers with data
 * instead of redirecting. Rendered only after hydration: without JS the form
 * posts normally and the action sends the browser back.
 */
export function JsField() {
  return useHydrated() ? <input type="hidden" name="_js" value="1" /> : null
}

export function FormFields() {
  return (
    <>
      <CsrfField />
      <JsField />
    </>
  )
}

export function useCsrf(): string {
  return useRouteLoaderData<RootData>('root')?.csrf ?? ''
}
