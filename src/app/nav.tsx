import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { View } from '../lib/types'

interface Nav {
  view: View
  go: (v: View) => void
  back: () => void
  canGoBack: boolean
}

const NavCtx = createContext<Nav | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<View[]>([{ name: 'home' }])
  const go = useCallback((v: View) => setStack((s) => {
    const top = s[s.length - 1]
    // La búsqueda se reemplaza en sitio para no llenar el historial con cada tecla.
    if (top.name === 'search' && v.name === 'search') return [...s.slice(0, -1), v]
    return [...s, v]
  }), [])
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), [])
  const value = useMemo(
    () => ({ view: stack[stack.length - 1], go, back, canGoBack: stack.length > 1 }),
    [stack, go, back],
  )
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}

export function useNav() {
  const n = useContext(NavCtx)
  if (!n) throw new Error('useNav fuera de NavProvider')
  return n
}
