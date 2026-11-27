// Actualizar una instalación (fase 6): descargar la versión nueva, revisar qué cambia y
// aplicarla conservando partidas y configuración. Se puede deshacer.

import { useEffect, useState } from 'react'
import { useDownloads } from '../app/downloads'
import { useLibrary } from '../app/library'
import { useTask } from '../app/task'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
import type { Installation, UpdatePlan } from '../lib/types'

export function UpdatePanel({ inst, onClose }: { inst: Installation; onClose: () => void }) {
  const lib = useLibrary()
  const task = useTask()
  const dls = useDownloads()
  const [plan, setPlan] = useState<UpdatePlan | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const p = inst.projectData

  // Descarga de la versión nueva (la recomendada de la última release).
  const dl = dls.items.find((d) => d.project === inst.project && d.releaseTag === inst.latestTag && d.state !== 'cancelled')
  const downloaded = dl?.state === 'done'

  const prepare = async () => {
    setErr(null)
    try {
      const pl = await task({ title: `Preparando ${p.name} ${inst.latestTag ?? ''}`, steps: ['Abriendo la versión descargada', 'Extrayendo en una carpeta aparte', 'Comparando con tu instalación', 'Buscando partidas y configuración que conservar'], minMs: 2600 }, () => api.updatePlan(inst.id))
      setPlan(pl)
    } catch (e) { setErr(String(e)) }
  }

  useEffect(() => {
    if (downloaded && !plan) prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloaded])

  const apply = async () => {
    setErr(null)
    try {
      const r = await task({ title: `Actualizando ${p.name} a ${plan?.newTag}`, steps: ['Guardando una copia de los archivos que cambian', 'Reemplazando archivos', 'Añadiendo archivos nuevos', 'Conservando tus partidas y tu configuración', 'Actualizando la biblioteca'], minMs: 3400, done: 'Actualizado' }, () => api.updateApply(inst.id))
      setResult(`Actualizado de ${r.fromTag} a ${r.toTag}: ${fmtNum(r.replaced)} archivos reemplazados, ${fmtNum(r.added)} nuevos y ${fmtNum(r.preserved)} conservados.`)
      lib.reload()
    } catch (e) { setErr(String(e)) }
  }

  const cancel = async () => {
    if (plan?.ready) await api.updateDiscard(inst.id).catch(() => {})
    onClose()
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Actualizar</div>
          <p className="panel-title">{p.name} <span className="mono muted">{inst.releaseTag} → {inst.latestTag}</span></p>
        </div>
        <button type="button" className="link" onClick={cancel}>Cerrar</button>
      </div>

      {result ? (
        <>
          <p className="yes">{result}</p>
          <p className="note-line">Si algo no va bien, puedes deshacer la actualización desde «Más».</p>
        </>
      ) : !downloaded ? (
        <>
          <p className="note-line">Primero se descarga la versión nueva desde la release oficial (con su SHA-256 si lo publica). Tu instalación no se toca hasta que revises los cambios y pulses «Aplicar».</p>
          <div className="actions">
            {dl && (dl.state === 'running' || dl.state === 'queued')
              ? <span className="muted">Descargando… sigue el progreso en Descargas.</span>
              : <button type="button" className="btn-primary" onClick={() => dls.start(inst.project)}>Descargar {inst.latestTag}</button>}
          </div>
        </>
      ) : !plan ? (
        <p className="note-line">Preparando…</p>
      ) : !plan.ready ? (
        <p className="note-line">
          {plan.reason === 'method'
            ? 'Esta versión se publica como instalador o en un formato que no se actualiza automáticamente. Ábrelo desde Descargas o instala la versión nueva aparte.'
            : 'No hay una versión nueva descargada.'}
        </p>
      ) : (
        <>
          <dl className="compat">
            <div><dt>Archivos que se reemplazan</dt><dd className="num">{fmtNum(plan.replaced ?? 0)}</dd></div>
            <div><dt>Archivos nuevos</dt><dd className="num">{fmtNum(plan.added ?? 0)}</dd></div>
            <div><dt>Se conservan (tuyos)</dt><dd className="num yes">{fmtNum(plan.preserved?.length ?? 0)}</dd></div>
            <div><dt>Solo en tu carpeta, no se tocan</dt><dd className="num">{fmtNum(plan.keptOnlyYours ?? 0)}</dd></div>
          </dl>
          {plan.preserved && plan.preserved.length > 0 && (
            <div>
              <div className="eyebrow">Se conservan</div>
              <ul className="exe-list mono small-list">
                {plan.preserved.slice(0, 20).map((x) => (
                  <li key={x.path}>{x.path} <span className="muted">· {x.why === 'adapter' ? 'protegido por el adaptador' : 'cambiado después de instalar'}</span></li>
                ))}
                {plan.preserved.length > 20 && <li className="muted">y {plan.preserved.length - 20} más</li>}
              </ul>
            </div>
          )}
          <p className="note-line">Antes de reemplazar nada se guarda una copia de los archivos que cambian. Si algo falla, se deja todo como estaba, y después puedes deshacer la actualización. Nada se borra de tu carpeta.</p>
          <div className="actions">
            <button type="button" className="btn-primary" onClick={apply}>Aplicar la actualización</button>
            <button type="button" className="link" onClick={cancel}>Ahora no</button>
          </div>
        </>
      )}
      {err && <p className="note-line err">{err}</p>}
    </div>
  )
}
