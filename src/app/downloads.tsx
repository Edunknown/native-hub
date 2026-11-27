// Estado de las descargas (fase 4): lista y progreso en vivo, compartidos por la vista
// Descargas, la barra de estado y el botón de la ficha.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, isTauri, onAutoInstall, onDownloadFallback, onDownloads, type AutoInstall } from '../lib/api'
import type { DownloadItem, DownloadProgress } from '../lib/types'

interface DownloadsCtx {
  items: DownloadItem[]
  progress: Record<number, DownloadProgress>
  reload: () => void
  start: (slug: string) => Promise<void>
  startAsset: (slug: string, url: string) => Promise<void>
  error: string | null
  available: boolean
  /** Automatic install of a downloaded ZIP, by project. */
  autoInstall: Record<string, AutoInstall>
  /** ZIP queued because the .exe could not be downloaded, by project (file name). */
  fallback: Record<string, string>
}

const Ctx = createContext<DownloadsCtx | null>(null)

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<DownloadItem[]>([])
  const [progress, setProgress] = useState<Record<number, DownloadProgress>>({})
  const [error, setError] = useState<string | null>(null)
  const [autoInstall, setAutoInstall] = useState<Record<string, AutoInstall>>({})
  const [fallback, setFallback] = useState<Record<string, string>>({})

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
    let offA: (() => void) | undefined
    let offF: (() => void) | undefined
    onAutoInstall((e) => { setAutoInstall((prev) => ({ ...prev, [e.slug]: e })); reload() }).then((u) => { offA = u })
    onDownloadFallback((e) => { setFallback((prev) => ({ ...prev, [e.slug]: e.name })); reload() }).then((u) => { offF = u })
    return () => { off?.(); offA?.(); offF?.() }
  }, [reload])

  // Recargar la lista de vez en cuando mientras haya algo en marcha (estado y bytes en disco).
  const active = items.some((d) => d.state === 'running' || d.state === 'queued')
  useEffect(() => {
    if (!active) return
    const t = setInterval(reload, 2000)
    return () => clearInterval(t)
  }, [active, reload])

  const value = useMemo<DownloadsCtx>(() => ({
    items, progress, reload, error, available: isTauri, autoInstall, fallback,
    start: async (slug: string) => {
      setError(null)
      try { await api.downloadStart(slug); reload() } catch (e) { setError(String(e)) }
    },
    startAsset: async (slug: string, url: string) => {
      setError(null)
      try { await api.downloadAsset(slug, url); reload() } catch (e) { setError(String(e)) }
    },
  }), [items, progress, reload, error, autoInstall, fallback])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDownloads() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDownloads fuera de DownloadsProvider')
  return c
}
