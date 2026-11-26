import { useState } from 'react'
import { useLibrary } from '../app/library'
import { useNav } from '../app/nav'
import { useCatalog } from '../app/catalog'
import { UserFileChecker } from '../components/Install'
import { api, isTauri, pickPath } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import type { Installation } from '../lib/types'
import { ConsoleIcon } from '../components/ConsoleIcon'

function Pending({ inst, onChange }: { inst: Installation; onChange: () => void }) {
  const [confirmInstaller, setConfirmInstaller] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const choose = async (path?: string) => {
    setErr(null)
    const p = path ?? await pickPath({ title: 'Elige el ejecutable del juego', extensions: ['exe'], defaultPath: inst.installDir })
    if (!p) return
    try { await api.setExecutable(inst.id, p); onChange() } catch (e) { setErr(String(e)) }
  }
  const pending = inst.config.pending
  return (
    <div className="pending">
      {pending === 'choose_exe' && (
        <>
          <p>Hay varios ejecutables. Elige cuál abre el juego:</p>
          <ul className="exe-list">
            {(inst.config.candidates ?? []).map((c) => (
              <li key={c}><button type="button" className="link mono" onClick={() => choose(c)}>{c.slice(inst.installDir.length + 1)}</button></li>
            ))}
          </ul>
        </>
      )}
      {pending === 'no_exe' && <p>No he encontrado ningún .exe dentro del archivo. Ábrelo en la carpeta y elige el ejecutable a mano.</p>}
      {pending === 'manual_extract' && <p>Este formato no se extrae automáticamente. Descomprímelo en la carpeta del juego y después elige el ejecutable.</p>}
      {pending === 'run_installer' && (
        <>
          <p>Es un instalador. Cuando lo abras, se ejecutará el programa de instalación del propio proyecto. Al terminar, elige el ejecutable que haya instalado.</p>
          {!confirmInstaller ? (
            <button type="button" className="btn-line" onClick={() => setConfirmInstaller(true)}>Abrir el instalador…</button>
          ) : (
            <span className="cand-actions">
              <span>¿Abrir el instalador descargado de la release oficial?</span>
              <button type="button" className="btn-primary" onClick={() => api.runInstaller(inst.id).then(() => setConfirmInstaller(false), (e) => setErr(String(e)))}>Sí, abrirlo</button>
              <button type="button" className="link" onClick={() => setConfirmInstaller(false)}>No</button>
            </span>
          )}
        </>
      )}
      <div className="actions">
        <button type="button" className="btn-line" onClick={() => choose()}>Elegir ejecutable…</button>
        <button type="button" className="link" onClick={() => api.openInstallFolder(inst.id)}>Abrir carpeta</button>
      </div>
      {err && <p className="note-line err">{err}</p>}
    </div>
  )
}

function InstallationRow({ inst }: { inst: Installation }) {
  const lib = useLibrary()
  const { go } = useNav()
  const { platformOf } = useCatalog()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const p = inst.projectData
  const act = (fn: () => Promise<unknown>) => () => { setErr(null); fn().then(lib.reload, (e) => setErr(String(e))) }
  const rules = p?.adapter?.userFiles ?? []

  return (
    <li className="inst">
      <div className="inst-icon"><ConsoleIcon slug={p?.platform ?? 'other'} size={42} /></div>
      <div className="inst-main">
        <div>
          <span className="game">{p?.gameTitle ?? inst.project}</span>
          <span className="muted"> · {p?.name}</span>
          <span className="mono muted"> · {inst.releaseTag}</span>
          {inst.updateAvailable && <span className="flag"> {inst.latestTag} disponible</span>}
        </div>
        <div className="mono muted ellipsis-wide" title={inst.installDir}>{inst.installDir}</div>
        <div className="note-line">
          {platformOf(p?.platform ?? '')?.name} · instalado el {fmtDateTime(inst.installedAt)}
          {inst.lastPlayedAt && <> · última vez {fmtDateTime(inst.lastPlayedAt)}</>}
        </div>
        {inst.state !== 'ready' && <Pending inst={inst} onChange={lib.reload} />}
        {open && (
          <div className="inst-more">
            {inst.executablePath && <p className="note-line">Ejecutable: <span className="mono">{inst.executablePath}</span></p>}
            {rules.map((r) => <UserFileChecker key={r.key} slug={inst.project} rule={r} installation={inst.id} />)}
            {inst.updateAvailable && <p className="note-line">Actualizar desde aquí llega en la fase 6. Mientras tanto puedes descargar la versión nueva desde la ficha.</p>}
          </div>
        )}
        {confirm && (
          <div className="pending">
            <p>¿Desinstalar {p?.name}? Se borrará la carpeta <span className="mono">{inst.installDir}</span>, <strong>incluidas las partidas guardadas y la configuración que el juego tenga dentro</strong>. No se puede deshacer.</p>
            <span className="cand-actions">
              <button type="button" className="btn-line err" onClick={act(() => api.uninstall(inst.id, true))}>Sí, borrar la carpeta</button>
              <button type="button" className="link" onClick={act(() => api.uninstall(inst.id, false))}>Quitar de la biblioteca sin borrar archivos</button>
              <button type="button" className="link" onClick={() => setConfirm(false)}>Cancelar</button>
            </span>
          </div>
        )}
        {err && <p className="note-line err">{err}</p>}
      </div>
      <div className="inst-end">
        {inst.state === 'ready'
          ? <button type="button" className="btn-primary" onClick={act(() => api.launch(inst.id))}>Ejecutar</button>
          : <span className="muted">Falta un paso</span>}
        <span className="dl-actions">
          <button type="button" className="link" onClick={() => api.openInstallFolder(inst.id)}>Carpeta</button>
          {inst.state === 'ready' && (
            <button type="button" className="link" onClick={act(async () => {
              const path = await pickPath({ title: 'Cambiar ejecutable', extensions: ['exe'], defaultPath: inst.installDir })
              if (path) await api.setExecutable(inst.id, path)
            })}>Cambiar ejecutable</button>
          )}
          <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? 'Menos' : 'Más'}</button>
          {p && <button type="button" className="link" onClick={() => go({ name: 'game', slug: p.game, project: p.slug })}>Ficha</button>}
          <button type="button" className="link" onClick={() => setConfirm(true)}>Desinstalar</button>
        </span>
      </div>
    </li>
  )
}

export function Library() {
  const { items } = useLibrary()
  const { go } = useNav()
  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Biblioteca</div>
        <h1 className="page-title">Tus proyectos instalados</h1>
        <p className="page-lede">Solo lo que está en tu PC. Cada juego vive en su propia carpeta; ejecutarlo es siempre una acción tuya.</p>
      </div>
      {!isTauri ? (
        <p className="empty">La biblioteca solo funciona en la app de escritorio.</p>
      ) : items.length === 0 ? (
        <p className="empty">Todavía no hay nada instalado. Busca un juego, descarga su ejecutable desde la ficha y pulsa «Instalar…». <button type="button" className="link" onClick={() => go({ name: 'discover' })}>Ir al catálogo</button></p>
      ) : (
        <ul className="list">{items.map((i) => <InstallationRow key={i.id} inst={i} />)}</ul>
      )}
    </main>
  )
}
