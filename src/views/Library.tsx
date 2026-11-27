import { useState } from 'react'
import { useLibrary } from '../app/library'
import { useTask } from '../app/task'
import { useNav } from '../app/nav'
import { useCatalog } from '../app/catalog'
import { UserFileChecker } from '../components/Install'
import { api, isTauri, pickPath } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import type { Installation } from '../lib/types'
import { ConsoleIcon } from '../components/ConsoleIcon'
import { UpdatePanel } from '../components/UpdatePanel'
import { tr } from '../lib/i18n'

function Pending({ inst, onChange }: { inst: Installation; onChange: () => void }) {
  const task = useTask()
  const [confirmInstaller, setConfirmInstaller] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const choose = async (path?: string) => {
    setErr(null)
    const p = path ?? await pickPath({ title: tr('Elige el ejecutable del juego', 'Choose the game executable'), extensions: ['exe'], defaultPath: inst.installDir })
    if (!p) return
    try {
      await task({ title: tr('Guardando el ejecutable', 'Saving the executable'), steps: [tr('Comprobando el ejecutable', 'Checking the executable'), tr('Guardándolo en la instalación', 'Saving it to the install')], minMs: 1000 }, () => api.setExecutable(inst.id, p))
      onChange()
    } catch (e) { setErr(String(e)) }
  }
  const pending = inst.config.pending
  return (
    <div className="pending">
      {pending === 'choose_exe' && (
        <>
          <p>{tr('Hay varios ejecutables. Elige cuál abre el juego:', 'There are several executables. Choose the one that opens the game:')}</p>
          <ul className="exe-list">
            {(inst.config.candidates ?? []).map((c) => (
              <li key={c}><button type="button" className="link mono" onClick={() => choose(c)}>{c.slice(inst.installDir.length + 1)}</button></li>
            ))}
          </ul>
        </>
      )}
      {pending === 'no_exe' && <p>{tr('No he encontrado ningún .exe dentro del archivo. Ábrelo en la carpeta y elige el ejecutable a mano.', 'No .exe was found inside the file. Open it in the folder and choose the executable by hand.')}</p>}
      {pending === 'manual_extract' && <p>{tr('Este formato no se extrae automáticamente. Descomprímelo en la carpeta del juego y después elige el ejecutable.', 'This format is not extracted automatically. Unpack it into the game folder and then choose the executable.')}</p>}
      {pending === 'run_installer' && (
        <>
          <p>{tr('Es un instalador. Cuando lo abras, se ejecutará el programa de instalación del propio proyecto. Al terminar, elige el ejecutable que haya instalado.', 'It is an installer. Opening it runs the project\'s own setup program. When it finishes, choose the executable it installed.')}</p>
          {!confirmInstaller ? (
            <button type="button" className="btn-line" onClick={() => setConfirmInstaller(true)}>{tr('Abrir el instalador…', 'Run the installer…')}</button>
          ) : (
            <span className="cand-actions">
              <span>{tr('¿Abrir el instalador descargado de la release oficial?', 'Run the installer downloaded from the official release?')}</span>
              <button type="button" className="btn-primary" onClick={() => api.runInstaller(inst.id).then(() => setConfirmInstaller(false), (e) => setErr(String(e)))}>{tr('Sí, abrirlo', 'Yes, run it')}</button>
              <button type="button" className="link" onClick={() => setConfirmInstaller(false)}>No</button>
            </span>
          )}
        </>
      )}
      <div className="actions">
        <button type="button" className="btn-line" onClick={() => choose()}>{tr('Elegir ejecutable…', 'Choose executable…')}</button>
        <button type="button" className="link" onClick={() => api.openInstallFolder(inst.id)}>{tr('Abrir carpeta', 'Open folder')}</button>
      </div>
      {err && <p className="note-line err">{err}</p>}
    </div>
  )
}

function InstallationRow({ inst }: { inst: Installation }) {
  const lib = useLibrary()
  const task = useTask()
  const { go } = useNav()
  const { platformOf } = useCatalog()
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
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
          {inst.updateAvailable && <span className="flag"> {inst.latestTag} {tr('disponible', 'available')}</span>}
        </div>
        <div className="mono muted ellipsis-wide" title={inst.installDir}>{inst.installDir}</div>
        <div className="note-line">
          {platformOf(p?.platform ?? '')?.name} · {tr('instalado el', 'installed')} {fmtDateTime(inst.installedAt)}
          {inst.lastPlayedAt && <> · {tr('última vez', 'last played')} {fmtDateTime(inst.lastPlayedAt)}</>}
        </div>
        {inst.state !== 'ready' && <Pending inst={inst} onChange={lib.reload} />}
        {open && (
          <div className="inst-more">
            {inst.executablePath && <p className="note-line">{tr('Ejecutable', 'Executable')}: <span className="mono">{inst.executablePath}</span></p>}
            {rules.map((r) => <UserFileChecker key={r.key} slug={inst.project} rule={r} installation={inst.id} />)}
            {inst.config.updateBackup && (
              <p className="note-line">
                {tr('Actualizado de', 'Updated from')} {inst.config.updateBackup.fromTag} {tr('a', 'to')} {inst.config.updateBackup.toTag}.{' '}
                <button type="button" className="link" onClick={act(() => task({ title: `${tr('Deshaciendo la actualización de', 'Undoing the update of')} ${p?.name ?? ''}`, steps: [tr('Restaurando los archivos anteriores', 'Restoring the previous files'), tr('Quitando los archivos nuevos', 'Removing the new files'), tr('Actualizando la biblioteca', 'Updating the library')], minMs: 2200, done: `${tr('Vuelve a estar en', 'Back on')} ${inst.config.updateBackup?.fromTag}` }, () => api.updateRollback(inst.id)))}>{tr('Deshacer la actualización', 'Undo the update')}</button>
              </p>
            )}
          </div>
        )}
        {updating && <UpdatePanel inst={inst} onClose={() => { setUpdating(false); lib.reload() }} />}
        {confirm && (
          <div className="pending">
            <p>{tr('¿Desinstalar', 'Uninstall')} {p?.name}? {tr('Se borrará la carpeta', 'This deletes the folder')} <span className="mono">{inst.installDir}</span>, <strong>{tr('incluidas las partidas guardadas y la configuración que el juego tenga dentro', 'including any saves and settings the game keeps inside it')}</strong>. {tr('No se puede deshacer.', 'This cannot be undone.')}</p>
            <span className="cand-actions">
              <button type="button" className="btn-line err" onClick={act(() => task({ title: `${tr('Desinstalando', 'Uninstalling')} ${p?.name ?? ''}`, steps: [tr('Cerrando la instalación', 'Closing the install'), tr('Borrando los archivos del juego', 'Deleting the game files'), tr('Actualizando la biblioteca', 'Updating the library')], minMs: 2400, done: tr('Desinstalado', 'Uninstalled') }, () => api.uninstall(inst.id, true)))}>{tr('Sí, borrar la carpeta', 'Yes, delete the folder')}</button>
              <button type="button" className="link" onClick={act(() => task({ title: `${tr('Quitando', 'Removing')} ${p?.name ?? ''} ${tr('de la biblioteca', 'from the library')}`, steps: [tr('Quitando la instalación de la biblioteca', 'Removing the install from the library')], minMs: 1000 }, () => api.uninstall(inst.id, false)))}>{tr('Quitar de la biblioteca sin borrar archivos', 'Remove from library without deleting files')}</button>
              <button type="button" className="link" onClick={() => setConfirm(false)}>{tr('Cancelar', 'Cancel')}</button>
            </span>
          </div>
        )}
        {err && <p className="note-line err">{err}</p>}
      </div>
      <div className="inst-end">
        {inst.state === 'ready'
          ? <button type="button" className="btn-primary" onClick={act(() => api.launch(inst.id))}>{tr('Ejecutar', 'Launch')}</button>
          : <span className="muted">{tr('Falta un paso', 'One step left')}</span>}
        {inst.updateAvailable && !updating && (
          <button type="button" className="btn-line" onClick={() => setUpdating(true)}>{tr('Actualizar a', 'Update to')} {inst.latestTag}</button>
        )}
        <span className="dl-actions">
          <button type="button" className="link" onClick={() => api.openInstallFolder(inst.id)}>{tr('Carpeta', 'Folder')}</button>
          {inst.state === 'ready' && (
            <button type="button" className="link" onClick={act(async () => {
              const path = await pickPath({ title: tr('Cambiar ejecutable', 'Change executable'), extensions: ['exe'], defaultPath: inst.installDir })
              if (path) await task({ title: tr('Cambiando el ejecutable', 'Changing the executable'), steps: [tr('Comprobando el ejecutable', 'Checking the executable'), tr('Guardándolo en la instalación', 'Saving it to the install')], minMs: 1000 }, () => api.setExecutable(inst.id, path))
            })}>{tr('Cambiar ejecutable', 'Change executable')}</button>
          )}
          <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? tr('Menos', 'Less') : tr('Más', 'More')}</button>
          {p && <button type="button" className="link" onClick={() => go({ name: 'game', slug: p.game, project: p.slug })}>{tr('Ficha', 'Page')}</button>}
          <button type="button" className="link" onClick={() => setConfirm(true)}>{tr('Desinstalar', 'Uninstall')}</button>
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
        <div className="eyebrow">{tr('Biblioteca', 'Library')}</div>
        <h1 className="page-title">{tr('Tus proyectos instalados', 'Your installed projects')}</h1>
        <p className="page-lede">{tr('Solo lo que está en tu PC. Cada juego vive en su propia carpeta; ejecutarlo es siempre una acción tuya.', 'Only what is on your PC. Each game lives in its own folder; launching it is always your call.')}</p>
      </div>
      {!isTauri ? (
        <p className="empty">{tr('La biblioteca solo funciona en la app de escritorio.', 'The library only works in the desktop app.')}</p>
      ) : items.length === 0 ? (
        <p className="empty">{tr('Todavía no hay nada instalado. Busca un juego, descarga su ejecutable desde la ficha y pulsa «Instalar…».', 'Nothing installed yet. Find a game, download its executable from its page and press "Install…".')} <button type="button" className="link" onClick={() => go({ name: 'discover' })}>{tr('Ir al catálogo', 'Go to the catalog')}</button></p>
      ) : (
        <ul className="list">{items.map((i) => <InstallationRow key={i.id} inst={i} />)}</ul>
      )}
    </main>
  )
}
