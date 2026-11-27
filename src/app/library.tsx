// Instalaciones (fase 5): la lista compartida por la Biblioteca, Inicio y las fichas.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, onAutoInstall } from '../lib/api'
import type { Installation } from '../lib/types'

interface LibraryCtx {
  items: Installation[]
  reload: () => void
  byProject: (slug: string) => Installation | undefined
}

const Ctx = createContext<LibraryCtx | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Installation[]>([])
  const reload = useCallback(() => { api.installations().then(setItems, () => {}) }, [])
  useEffect(() => { reload() }, [reload])
  // A ZIP that finished downloading is installed on its own: refresh when it is done.
  useEffect(() => {
    let off: (() => void) | undefined
    onAutoInstall((e) => { if (e.phase !== 'started') reload() }).then((u) => { off = u })
    return () => off?.()
  }, [reload])
  const value = useMemo<LibraryCtx>(() => ({
    items, reload, byProject: (slug) => items.find((i) => i.project === slug),
  }), [items, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLibrary() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useLibrary fuera de LibraryProvider')
  return c
}
