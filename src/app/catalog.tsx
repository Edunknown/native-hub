import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { Platform, Summary } from '../lib/types'
import { useAsync } from '../lib/useAsync'

interface CatalogCtx {
  summary: Summary
  platforms: Platform[]
  platformOf: (slug: string) => Platform | undefined
}

const Ctx = createContext<CatalogCtx | null>(null)

/** Carga una vez el resumen del catálogo y las plataformas, que usan casi todas las vistas. */
export function CatalogProvider({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  const state = useAsync(() => Promise.all([api.summary(), api.platforms()]), [])
  const value = useMemo(() => {
    if (state.status !== 'ok') return null
    const [summary, platforms] = state.data
    const map = new Map(platforms.map((p) => [p.slug, p]))
    return { summary, platforms, platformOf: (s: string) => map.get(s) }
  }, [state])

  useEffect(() => { if (state.status !== 'loading') onReady?.() }, [state.status, onReady])

  if (state.status === 'error') {
    return <div className="boot"><p>No se pudo abrir el catálogo.</p><p className="mono muted">{state.error}</p></div>
  }
  // Mientras carga, la animación de inicio cubre la ventana.
  if (!value) return <div className="boot" />
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCatalog() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCatalog fuera de CatalogProvider')
  return c
}
