import { useRouteLoaderData } from 'react-router'
import type { RootData } from '../root'

export function useMe() {
  return useRouteLoaderData<RootData>('root')?.me ?? null
}

export function useSignedIn() {
  return Boolean(useMe())
}
