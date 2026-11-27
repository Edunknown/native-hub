// Estado de las descargas (fase 4): lista y progreso en vivo, compartidos por la vista
// Descargas, la barra de estado y el botón de la ficha.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, isTauri, onDownloads } from '../lib/api'
import type { DownloadItem, DownloadProgress } from '../lib/types'

interface DownloadsCtx {
  items: DownloadItem[]
  progress: Record<number, DownloadProgress>
  reload: () => void
  start: (slug: string) => Promise<void>
  startAsset: (slug: string, url: string) => Promise<void>
  error: string | null
  available: boolean
}

const Ctx = createContext<DownloadsCtx | null>(null)

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<DownloadItem[]>([])
  const [progress, setProgress] = useState<Record<number, DownloadProgress>>({})
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api.downloads().then(setItems, () => {})
  }, [])

  useEffect(() => {
    reload()
    let off: (() => void) | undefined
    onDownloads(
      (p) => setProgress((prev) => ({ ...prev, [p.id]: p })),
      () => reload(),
    ).then((u) => { off = u })
    return () => off?.()
  }, [reload])

  // Recargar la lista de vez en cuando mientras haya algo en marcha (estado y bytes en disco).
  const active = items.some((d) => d.state === 'running' || d.state === 'queued')
  useEffect(() => {
    if (!active) return
    const t = setInterval(reload, 2000)
    return () => clearInterval(t)
  }, [active, reload])

  const value = useMemo<DownloadsCtx>(() => ({
    items, progress, reload, error, available: isTauri,
    start: async (slug: string) => {
      setError(null)
      try { await api.downloadStart(slug); reload() } catch (e) { setError(String(e)) }
    },
    startAsset: async (slug: string, url: string) => {
      setError(null)
      try { await api.downloadAsset(slug, url); reload() } catch (e) { setError(String(e)) }
    },
  }), [items, progress, reload, error])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDownloads() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDownloads fuera de DownloadsProvider')
  return c
}
