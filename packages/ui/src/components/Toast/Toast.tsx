import { Toast as T } from 'radix-ui'
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'
import { cx } from '../../cx'

type Tone = 'info' | 'error'
interface Item {
  id: number
  text: ReactNode
  tone: Tone
}

const Ctx = createContext<(text: ReactNode, tone?: Tone) => void>(() => {})

/** Toasts announce results of background actions; they never hold the only copy of an error. */
export function ToastProvider({ children, label }: { children: ReactNode; label: string }) {
  const [items, setItems] = useState<Item[]>([])
  const push = useCallback((text: ReactNode, tone: Tone = 'info') => {
    setItems((xs) => [...xs, { id: Date.now() + Math.random(), text, tone }])
  }, [])
  return (
    <Ctx.Provider value={push}>
      <T.Provider swipeDirection="down" duration={4000} label={label}>
        {children}
        {items.map((it) => (
          <T.Root
            key={it.id}
            onOpenChange={(open) => !open && setItems((xs) => xs.filter((x) => x.id !== it.id))}
            className={cx(
              'rounded-card border border-line bg-surface px-4 py-3 text-sm shadow-[0_8px_30px_rgba(0,0,0,0.12)]',
              it.tone === 'error' ? 'text-danger' : 'text-ink',
            )}
          >
            <T.Description>{it.text}</T.Description>
          </T.Root>
        ))}
        <T.Viewport className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100vw-32px)] max-w-sm -translate-x-1/2 flex-col gap-2 md:bottom-6" />
      </T.Provider>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
