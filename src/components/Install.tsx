// Plan de instalación (fase 5): se enseña antes de hacer nada y se confirma con un botón.

import { useEffect, useState } from 'react'
import { useLibrary } from '../app/library'
import { useTask } from '../app/task'
import { useNav } from '../app/nav'
import { api, pickPath } from '../lib/api'
import type { InstallPlan, Installation, UserFileCheck, UserFileRule } from '../lib/types'

const METHOD: Record<InstallPlan['method'], string> = {
  extract_zip: 'ZIP portable',
  copy_exe: 'Ejecutable portable',
  installer: 'Instalador externo',
  manual: 'Extracción manual',
}

/** Comprueba un archivo del usuario (ROM, ISO…) contra las reglas del adaptador. No lo copia. */
export function UserFileChecker({ slug, rule, installation }: { slug: string; rule: UserFileRule; installation?: number }) {
  const task = useTask()
  const [res, setRes] = useState<{ path: string; r: UserFileCheck } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const pick = async () => {
    setErr(null)
    const path = await pickPath({ title: rule.label, extensions: rule.extensions.length ? rule.extensions : undefined })
    if (!path) return
    try {
      const r = await task({ title: `Comprobando ${rule.label}`, steps: ['Leyendo el archivo', 'Comprobando la cabecera', 'Comprobando el tamaño'], minMs: 1500 }, () => api.checkUserFile(slug, rule.key, path, installation))
      setRes({ path, r })
    } catch (e) { setErr(String(e)) }
  }
  return (
    <div className="ufile">
      <div className="ufile-head">
        <span>{rule.label}</span>
        <button type="button" className="btn-line" onClick={pick}>{res ? 'Comprobar otro archivo' : 'Comprobar mi archivo'}</button>
      </div>
      {rule.help && <p className="note-line">{rule.help}</p>}
      {res && (
        <div className="ufile-res">
          <p className={res.r.ok ? 'yes' : 'err'}>{res.r.ok ? 'Parece correcto' : 'No cumple lo que pide el proyecto'}</p>
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
        ? ['Preparando la carpeta del juego', 'Extrayendo archivos', 'Comprobando el contenido', 'Buscando el ejecutable', 'Registrando en la biblioteca']
        : plan?.method === 'copy_exe'
          ? ['Preparando la carpeta del juego', 'Copiando el ejecutable', 'Registrando en la biblioteca']
          : ['Preparando la carpeta del juego', 'Guardando el archivo descargado', 'Registrando en la biblioteca']
      const i = await task({ title: `Instalando ${plan?.name ?? ''}`, steps, minMs: 3200, done: 'Instalado' }, () => api.install(slug))
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
    return <div className="panel">{err ? <p className="note-line err">{err}</p> : <p className="note-line">Preparando el plan…</p>}</div>
  }

  if (done) {
    return (
      <div className="panel">
        <div className="eyebrow">Instalado</div>
        <p className="panel-title">{plan.name} está en <span className="mono">{done.installDir}</span></p>
        {done.state === 'ready'
          ? <p className="note-line">Listo para ejecutar. {plan.adapter?.userFiles.length ? 'Al abrirlo por primera vez te pedirá tus archivos.' : ''}</p>
          : <p className="note-line">Falta un paso: {done.config.pending === 'choose_exe' ? 'elegir cuál es el ejecutable del juego' : done.config.pending === 'run_installer' ? 'abrir el instalador' : 'terminarlo a mano'}. Lo tienes en la Biblioteca.</p>}
        <div className="actions">
          {done.state === 'ready' && <button type="button" className="btn-primary" onClick={() => api.launch(done.id)}>Ejecutar</button>}
          <button type="button" className="btn-line" onClick={() => go({ name: 'library' })}>Ir a la biblioteca</button>
          <button type="button" className="link" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Plan de instalación · {METHOD[plan.method]}</div>
          <p className="panel-title">{plan.name} <span className="muted">{plan.releaseTag}</span></p>
        </div>
        <span className={plan.reviewed ? 'yes' : 'muted'}>{plan.reviewed ? `Adaptador revisado (v${plan.adapter?.version})` : 'Instalación genérica'}</span>
      </div>
      <ol className="steps">
        {plan.steps.map((s, i) => <li key={i} className={s.done === false ? 'pending' : undefined}>{s.text}</li>)}
      </ol>
      {!plan.reviewed && (
        <p className="note-line">Este proyecto todavía no tiene un adaptador revisado: NATIVE HUB extrae el archivo y busca el ejecutable, pero no conoce sus pasos propios. Lee sus requisitos en la ficha.</p>
      )}
      {plan.adapter?.userFiles.map((r) => <UserFileChecker key={r.key} slug={slug} rule={r} />)}
      {plan.dirExists && <p className="note-line err">La carpeta {plan.installDir} ya existe y no está vacía. Bórrala o cambia la carpeta de juegos en Ajustes.</p>}
      {plan.alreadyInstalled != null && <p className="note-line">Ya está instalado. Gestiónalo desde la Biblioteca.</p>}
      {err && <p className="note-line err">{err}</p>}
      <div className="actions">
        <button type="button" className="btn-primary" disabled={busy || !plan.downloaded || plan.dirExists || plan.alreadyInstalled != null} onClick={run}>
          {busy ? 'Instalando…' : 'Instalar'}
        </button>
        <span className="mono muted ellipsis-wide" title={plan.installDir}>{plan.installDir}</span>
        <button type="button" className="link" onClick={onClose}>Cancelar</button>
      </div>
      {!plan.downloaded && <p className="note-line">Primero descarga el archivo.</p>}
    </div>
  )
}
