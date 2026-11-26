// Estado de las funciones en vivo (fase 3): cuota de GitHub, trabajos en segundo plano
// (comprobar releases, escanear repositorios) y novedades sin ver.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, onJobs } from '../lib/api'
import type { JobFinished, JobProgress, ReleasesStatus } from '../lib/types'

interface LiveCtx {
  status: ReleasesStatus | null
  progress: JobProgress | null
  lastFinished: JobFinished | null
  /** Cambia cada vez que termina un trabajo: las vistas lo usan para recargar. */
  version: number
  reload: () => void
  startRefresh: () => Promise<void>
  startScan: () => Promise<void>
  cancel: () => Promise<void>
  error: string | null
}

const Ctx = createContext<LiveCtx | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ReleasesStatus | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [lastFinished, setLastFinished] = useState<JobFinished | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api.releasesStatus().then(setStatus, (e) => setError(String(e)))
  }, [])

  useEffect(() => {
    reload()
    let off: (() => void) | undefined
    onJobs(
      (p) => setProgress(p),
      (f) => {
        setProgress(null)
        setLastFinished(f)
        setVersion((v) => v + 1)
        reload()
      },
    ).then((u) => { off = u })
    return () => off?.()
  }, [reload])

  const run = useCallback(async (fn: () => Promise<boolean>) => {
    setError(null)
    try {
      const started = await fn()
      if (!started) setError('Ya hay una comprobación en marcha.')
      reload()
    } catch (e) {
      setError(String(e))
    }
  }, [reload])

  const value = useMemo<LiveCtx>(() => ({
    status, progress, lastFinished, version, reload, error,
    startRefresh: () => run(() => api.refreshStale(24, 200)),
    startScan: () => run(() => api.scan()),
    cancel: async () => { await api.cancelJob().catch(() => {}) },
  }), [status, progress, lastFinished, version, reload, error, run])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLive() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useLive fuera de LiveProvider')
  return c
}
