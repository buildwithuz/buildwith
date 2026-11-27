import { createContext, useContext } from 'react'

/** The per-request CSP nonce. Set on the server only; empty in the browser. */
export const NonceContext = createContext<string | undefined>(undefined)

export const useNonce = () => useContext(NonceContext)
