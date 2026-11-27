// The typed client for the buildwith.uz API. Every type and path comes from
// src/generated/schema.ts, which `pnpm gen` builds from packages/api-spec.
import createFetchClient, { type Client } from 'openapi-fetch'
import type { components, paths } from './generated/schema'

export type { components, paths }
export type Schemas = components['schemas']

export type User = Schemas['User']
export type Profile = Schemas['Profile']
export type SessionInfo = Schemas['SessionInfo']
export type Link = Schemas['Link']
export type LinkKind = Schemas['LinkKind']
export type Note = Schemas['Note']
export type Article = Schemas['Article']
export type Comment = Schemas['Comment']
export type Tag = Schemas['Tag']
export type Media = Schemas['Media']
export type FeedItem = Schemas['FeedItem']
export type Notification = Schemas['Notification']
export type ModAction = Schemas['ModAction']
export type ApiError = Schemas['Error']
export type ErrorCode = Schemas['ErrorCode']
export type Lang = Schemas['Lang']
export type Script = Schemas['Script']
export type Theme = Schemas['Theme']

export type ApiClient = Client<paths>

export interface ClientOptions {
  /** Absolute API origin on the server (SSR), "" in the browser (same origin). */
  baseUrl: string
  /** The incoming request's Cookie header, forwarded when rendering on the server. */
  cookie?: string | null
  /** The CSRF token for mutations. */
  csrf?: string
  /** The incoming X-Forwarded-For header, so the API sees the visitor's address, not ours. */
  forwardedFor?: string | null
  fetch?: typeof fetch
}

export function createClient(opts: ClientOptions): ApiClient {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.csrf) headers['x-csrf-token'] = opts.csrf
  if (opts.forwardedFor) headers['x-forwarded-for'] = opts.forwardedFor
  return createFetchClient<paths>({
    baseUrl: `${opts.baseUrl}/v1`,
    headers,
    credentials: 'same-origin',
    fetch: opts.fetch,
  })
}

/** Narrow an unknown error body to the API's Error shape. */
export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e
}
