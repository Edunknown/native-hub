// Plan de instalación (fase 5): se enseña antes de hacer nada y se confirma con un botón.

import { useEffect, useState } from 'react'
import { useLibrary } from '../app/library'
import { useTask } from '../app/task'
import { useNav } from '../app/nav'
import { api, pickPath } from '../lib/api'
import type { InstallPlan, Installation, UserFileCheck, UserFileRule } from '../lib/types'
import { lang, tr } from '../lib/i18n'

const METHOD: Record<InstallPlan['method'], string> = {
  extract_zip: tr('ZIP portable', 'Portable ZIP'),
  copy_exe: tr('Ejecutable portable', 'Portable executable'),
  installer: tr('Instalador externo', 'External installer'),
  manual: tr('Extracción manual', 'Manual extraction'),
}

/** Comprueba un archivo del usuario (ROM, ISO…) contra las reglas del adaptador. No lo copia. */
export function UserFileChecker({ slug, rule: raw, installation }: { slug: string; rule: UserFileRule; installation?: number }) {
  // Rules read straight from the catalog carry both languages.
  const rule = lang === 'en' ? { ...raw, label: raw.labelEn ?? raw.label, help: raw.helpEn ?? raw.help } : raw
  const task = useTask()
  const [res, setRes] = useState<{ path: string; r: UserFileCheck } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const pick = async () => {
    setErr(null)
    const path = await pickPath({ title: rule.label, extensions: rule.extensions.length ? rule.extensions : undefined })
    if (!path) return
    try {
      const r = await task({ title: `${tr('Comprobando', 'Checking')} ${rule.label}`, steps: [tr('Leyendo el archivo', 'Reading the file'), tr('Comprobando la cabecera', 'Checking the header'), tr('Comprobando el tamaño', 'Checking the size')], minMs: 1500 }, () => api.checkUserFile(slug, rule.key, path, installation))
      setRes({ path, r })
    } catch (e) { setErr(String(e)) }
  }
  return (
    <div className="ufile">
      <div className="ufile-head">
        <span>{rule.label}</span>
        <button type="button" className="btn-line" onClick={pick}>{res ? tr('Comprobar otro archivo', 'Check another file') : tr('Comprobar mi archivo', 'Check my file')}</button>
      </div>
      {rule.help && <p className="note-line">{rule.help}</p>}
      {res && (
        <div className="ufile-res">
          <p className={res.r.ok ? 'yes' : 'err'}>{res.r.ok ? tr('Parece correcto', 'Looks right') : tr('No cumple lo que pide el proyecto', 'Does not match what the project requires')}</p>
          <p className="mono muted ellipsis-wide" title={res.path}>{res.path}</p>
          <ul className="checks">
            {res.r.checks.map((c) => <li key={c.check} className={c.ok ? 'ok' : 'bad'}>{c.text}</li>)}
          </ul>
        </div>
      )}
      {err && <p className="note-line err">{err}</p>}
    </div>
  )
}

export function InstallPanel({ slug, onClose, onInstalled }: { slug: string; onClose: () => void; onInstalled?: (i: Installation) => void }) {
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Installation | null>(null)
  const lib = useLibrary()
  const { go } = useNav()
  const task = useTask()

  useEffect(() => {
    api.installPlan(slug).then(setPlan, (e) => setErr(String(e)))
  }, [slug])

  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      const steps = plan?.method === 'extract_zip'
        ? [tr('Preparando la carpeta del juego', 'Preparing the game folder'), tr('Extrayendo archivos', 'Extracting files'), tr('Comprobando el contenido', 'Checking the contents'), tr('Buscando el ejecutable', 'Looking for the executable'), tr('Registrando en la biblioteca', 'Adding to the library')]
        : plan?.method === 'copy_exe'
          ? [tr('Preparando la carpeta del juego', 'Preparing the game folder'), tr('Copiando el ejecutable', 'Copying the executable'), tr('Registrando en la biblioteca', 'Adding to the library')]
          : [tr('Preparando la carpeta del juego', 'Preparing the game folder'), tr('Guardando el archivo descargado', 'Saving the downloaded file'), tr('Registrando en la biblioteca', 'Adding to the library')]
      const i = await task({ title: `${tr('Instalando', 'Installing')} ${plan?.name ?? ''}`, steps, minMs: 3200, done: tr('Instalado', 'Installed') }, () => api.install(slug))
      setDone(i)
      lib.reload()
      onInstalled?.(i)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!plan) {
    return <div className="panel">{err ? <p className="note-line err">{err}</p> : <p className="note-line">{tr('Preparando el plan…', 'Preparing the plan…')}</p>}</div>
  }

  if (done) {
    return (
      <div className="panel">
        <div className="eyebrow">{tr('Instalado', 'Installed')}</div>
        <p className="panel-title">{plan.name} {tr('está en', 'is in')} <span className="mono">{done.installDir}</span></p>
        {done.state === 'ready'
          ? <p className="note-line">{tr('Listo para ejecutar.', 'Ready to launch.')} {plan.adapter?.userFiles.length ? tr('Al abrirlo por primera vez te pedirá tus archivos.', 'The first time you open it, it will ask for your files.') : ''}</p>
          : <p className="note-line">{tr('Falta un paso', 'One step left')}: {done.config.pending === 'choose_exe' ? tr('elegir cuál es el ejecutable del juego', 'choose the game executable') : done.config.pending === 'run_installer' ? tr('abrir el instalador', 'run the installer') : tr('terminarlo a mano', 'finish it by hand')}. {tr('Lo tienes en la Biblioteca.', 'You will find it in the Library.')}</p>}
        <div className="actions">
          {done.state === 'ready' && <button type="button" className="btn-primary" onClick={() => api.launch(done.id)}>{tr('Ejecutar', 'Launch')}</button>}
          <button type="button" className="btn-line" onClick={() => go({ name: 'library' })}>{tr('Ir a la biblioteca', 'Go to the library')}</button>
          <button type="button" className="link" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">{tr('Plan de instalación', 'Install plan')} · {METHOD[plan.method]}</div>
          <p className="panel-title">{plan.name} <span className="muted">{plan.releaseTag}</span></p>
        </div>
        <span className={plan.reviewed ? 'yes' : 'muted'}>{plan.reviewed ? `${tr('Adaptador revisado', 'Reviewed adapter')} (v${plan.adapter?.version})` : tr('Instalación genérica', 'Generic install')}</span>
      </div>
      <ol className="steps">
        {plan.steps.map((s, i) => <li key={i} className={s.done === false ? 'pending' : undefined}>{s.text}</li>)}
      </ol>
      {!plan.reviewed && (
        <p className="note-line">{tr('Este proyecto todavía no tiene un adaptador revisado: NATIVE HUB extrae el archivo y busca el ejecutable, pero no conoce sus pasos propios. Lee sus requisitos en la ficha.', 'This project does not have a reviewed adapter yet: NATIVE HUB extracts the file and looks for the executable, but does not know its own steps. Read its requirements on the game page.')}</p>
      )}
      {plan.adapter?.userFiles.map((r) => <UserFileChecker key={r.key} slug={slug} rule={r} />)}
      {plan.dirExists && <p className="note-line err">{tr('La carpeta', 'The folder')} {plan.installDir} {tr('ya existe y no está vacía. Bórrala o cambia la carpeta de juegos en Ajustes.', 'already exists and is not empty. Delete it or change the games folder in Settings.')}</p>}
      {plan.alreadyInstalled != null && <p className="note-line">{tr('Ya está instalado. Gestiónalo desde la Biblioteca.', 'Already installed. Manage it from the Library.')}</p>}
      {err && <p className="note-line err">{err}</p>}
      <div className="actions">
        <button type="button" className="btn-primary" disabled={busy || !plan.downloaded || plan.dirExists || plan.alreadyInstalled != null} onClick={run}>
          {busy ? tr('Instalando…', 'Installing…') : tr('Instalar', 'Install')}
        </button>
        <span className="mono muted ellipsis-wide" title={plan.installDir}>{plan.installDir}</span>
        <button type="button" className="link" onClick={onClose}>{tr('Cancelar', 'Cancel')}</button>
      </div>
      {!plan.downloaded && <p className="note-line">{tr('Primero descarga el archivo.', 'Download the file first.')}</p>}
    </div>
  )
}
