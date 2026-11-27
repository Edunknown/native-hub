import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, onCatalogUpdated } from '../lib/api'
import type { Platform, Summary } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { lang, tr } from '../lib/i18n'

interface CatalogCtx {
  summary: Summary
  platforms: Platform[]
  platformOf: (slug: string) => Platform | undefined
}

const Ctx = createContext<CatalogCtx | null>(null)

/** Carga una vez el resumen del catálogo y las plataformas, que usan casi todas las vistas. */
export function CatalogProvider({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  // Bumped when a newer catalog arrives from GitHub, so the summary and platforms reload.
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let off: (() => void) | undefined
    onCatalogUpdated(() => setVersion((v) => v + 1)).then((u) => { off = u })
    return () => off?.()
  }, [])
  const state = useAsync(() => api.setLanguage(lang).catch(() => {}).then(() => Promise.all([api.summary(), api.platforms()])), [version])
  // useAsync keeps the previous data until the new query resolves, so nothing flickers.
  const shown = state
  const value = useMemo(() => {
    if (shown.status !== 'ok') return null
    const [summary, platforms] = shown.data
    const map = new Map(platforms.map((p) => [p.slug, p]))
    return { summary, platforms, platformOf: (s: string) => map.get(s) }
  }, [shown])

  useEffect(() => { if (shown.status !== 'loading') onReady?.() }, [shown.status, onReady])

  if (shown.status === 'error') {
    return <div className="boot"><p>{tr('No se pudo abrir el catálogo.', 'Could not open the catalog.')}</p><p className="mono muted">{shown.error}</p></div>
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
