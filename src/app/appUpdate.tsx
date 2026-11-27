// Updates of NATIVE HUB itself. The installed app checks latest.json in the GitHub releases
// (signed with the updater key) and asks before installing. The portable build only announces
// the new version and opens its release page.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isTauri, openExternal } from '../lib/api'
import { tr } from '../lib/i18n'
import { ErrorNote } from '../components/ErrorNote'

const RELEASES = 'https://github.com/Edunknown/native-hub/releases'
const SKIP_KEY = 'nh-skip-update'

type Phase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'

interface AvailableUpdate {
  version: string
  notes: string | null
  install: (onProgress: (done: number, total: number | null) => void) => Promise<void>
}

interface AppUpdateCtx {
  phase: Phase
  current: string | null
  update: AvailableUpdate | null
  portable: boolean
  progress: { done: number; total: number | null } | null
  error: string | null
  check: (manual: boolean) => Promise<void>
  install: () => Promise<void>
  dismiss: () => void
  dismissed: boolean
}

const Ctx = createContext<AppUpdateCtx | null>(null)

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [current, setCurrent] = useState<string | null>(null)
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)
  const [portable, setPortable] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const check = useCallback(async (manual: boolean) => {
    if (!isTauri) return
    setError(null)
    setPhase('checking')
    try {
      const { check: checkUpdate } = await import('@tauri-apps/plugin-updater')
      const u = await checkUpdate()
      if (!u) { setUpdate(null); setPhase('none'); return }
      let skipped: string | null = null
      try { skipped = localStorage.getItem(SKIP_KEY) } catch { /* no storage */ }
      setDismissed(!manual && skipped === u.version)
      setUpdate({
        version: u.version,
        notes: u.body ?? null,
        install: async (onProgress) => {
          let done = 0
          let total: number | null = null
          await u.downloadAndInstall((e) => {
            if (e.event === 'Started') total = e.data.contentLength ?? null
            if (e.event === 'Progress') done += e.data.chunkLength
            onProgress(done, total)
          })
        },
      })
      setPhase('available')
    } catch (e) {
      setPhase('error')
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    import('@tauri-apps/api/app').then((m) => m.getVersion()).then(setCurrent, () => {})
    import('@tauri-apps/api/core').then((m) => m.invoke<boolean>('is_portable')).then(setPortable, () => {})
    // First check a little after startup, so it does not compete with loading the catalog.
    const t = setTimeout(() => { check(false) }, 8000)
    return () => clearTimeout(t)
  }, [check])

  const install = useCallback(async () => {
    if (!update) return
    if (portable) { await openExternal(`${RELEASES}/tag/v${update.version}`); return }
    setError(null)
    setPhase('downloading')
    try {
      await update.install((done, total) => setProgress({ done, total }))
      setPhase('ready')
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (e) {
      setPhase('error')
      setError(String(e))
    }
  }, [update, portable])

  const dismiss = useCallback(() => {
    if (update) { try { localStorage.setItem(SKIP_KEY, update.version) } catch { /* no storage */ } }
    setDismissed(true)
  }, [update])

  const value = useMemo(() => ({ phase, current, update, portable, progress, error, check, install, dismiss, dismissed }),
    [phase, current, update, portable, progress, error, check, install, dismiss, dismissed])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppUpdate() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAppUpdate outside AppUpdateProvider')
  return c
}

/** Bar under the top header when a new version of NATIVE HUB is available. */
export function AppUpdateBanner() {
  const u = useAppUpdate()
  if (!u.update || u.dismissed || u.phase === 'none' || u.phase === 'checking') return null
  const pct = u.progress?.total ? Math.round((u.progress.done / u.progress.total) * 100) : null
  return (
    <div className="phase-note app-update" role="status">
      <b>{tr(`NATIVE HUB ${u.update.version} está disponible.`, `NATIVE HUB ${u.update.version} is available.`)}</b>{' '}
      {u.phase === 'downloading' ? (
        <span>{tr('Descargando la actualización', 'Downloading the update')}{pct != null ? ` · ${pct} %` : '…'}</span>
      ) : u.phase === 'ready' ? (
        <span>{tr('Reiniciando…', 'Restarting…')}</span>
      ) : (
        <>
          <span className="muted">
            {u.portable
              ? tr('Esta es la versión portable: descarga el ZIP nuevo desde la release.', 'This is the portable build: download the new ZIP from the release.')
              : tr('Se descarga de la release oficial, se comprueba su firma y NATIVE HUB se reinicia. Tus juegos y ajustes se conservan.', 'It is downloaded from the official release, its signature is verified and NATIVE HUB restarts. Your games and settings are kept.')}
          </span>{' '}
          <button type="button" className="link" onClick={u.install}>
            {u.portable ? tr('Abrir la release', 'Open the release') : tr('Actualizar y reiniciar', 'Update and restart')}
          </button>{' '}
          <button type="button" className="link" onClick={() => openExternal(`${RELEASES}/tag/v${u.update!.version}`)}>{tr('Novedades', 'What’s new')}</button>{' '}
          <button type="button" className="link" onClick={u.dismiss}>{tr('Ahora no', 'Not now')}</button>
        </>
      )}
      {u.error && <span className="err"> {u.error}</span>}
    </div>
  )
}

/** Settings row: current version and a manual check. */
export function AppUpdateSetting() {
  const u = useAppUpdate()
  if (!isTauri) return <span className="tbd">{tr('Solo en la app de escritorio', 'Desktop app only')}</span>
  return (
    <>
      <p><span className="mono">{u.current ? `v${u.current}` : '—'}</span>{u.portable && <span className="muted"> · {tr('portable', 'portable')}</span>}</p>
      <div className="actions">
        <button type="button" className="btn-line" disabled={u.phase === 'checking' || u.phase === 'downloading'} onClick={() => u.check(true)}>
          {u.phase === 'checking' ? tr('Comprobando…', 'Checking…') : tr('Buscar actualizaciones', 'Check for updates')}
        </button>
        {u.update && u.phase === 'available' && (
          <button type="button" className="btn-primary" onClick={u.install}>
            {u.portable ? tr(`Abrir la release ${u.update.version}`, `Open release ${u.update.version}`) : tr(`Actualizar a ${u.update.version}`, `Update to ${u.update.version}`)}
          </button>
        )}
      </div>
      <p className="note-line">
        {u.phase === 'none' && <>{tr('Tienes la última versión.', 'You have the latest version.')} </>}
        {u.portable
          ? tr('NATIVE HUB avisa cuando hay una versión nueva en GitHub. En la versión portable se descarga a mano.', 'NATIVE HUB tells you when a new version is on GitHub. In the portable build you download it yourself.')
          : tr('NATIVE HUB comprueba al arrancar si hay una versión nueva en GitHub y te pregunta antes de instalarla. Las actualizaciones van firmadas.', 'NATIVE HUB checks GitHub for a new version on startup and asks before installing it. Updates are signed.')}
      </p>
      {u.error && <ErrorNote error={u.error} />}
    </>
  )
}
