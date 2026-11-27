import type { Lang, SessionInfo, Theme, User } from '@buildwith/api-client'
import type { Script } from '@buildwith/translit'
import { createContext } from 'react-router'

/** Everything a request knows about who is reading and how they like it. */
export interface Viewer {
  me: User | null
  csrf: string
  needsUsername: boolean
  devLogin: boolean
  lang: Lang
  script: Script
  theme: Theme
  /** The browser's Cookie header, forwarded to the API on the server. */
  cookie: string | null
  /** The X-Forwarded-For chain from the reverse proxy, passed on so the API sees the visitor's IP. */
  forwardedFor: string | null
}

export const viewerContext = createContext<Viewer>()

export type { SessionInfo }
