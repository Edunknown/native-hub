// Actualizar una instalación (fase 6): descargar la versión nueva, revisar qué cambia y
// aplicarla conservando partidas y configuración. Se puede deshacer.

import { useEffect, useState } from 'react'
import { useDownloads } from '../app/downloads'
import { useLibrary } from '../app/library'
import { useTask } from '../app/task'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
import type { Installation, UpdatePlan } from '../lib/types'
import { tr } from '../lib/i18n'

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
      const pl = await task({ title: `${tr('Preparando', 'Preparing')} ${p.name} ${inst.latestTag ?? ''}`, steps: [tr('Abriendo la versión descargada', 'Opening the downloaded version'), tr('Extrayendo en una carpeta aparte', 'Extracting to a separate folder'), tr('Comparando con tu instalación', 'Comparing with your install'), tr('Buscando partidas y configuración que conservar', 'Finding saves and settings to keep')], minMs: 2600 }, () => api.updatePlan(inst.id))
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
      const r = await task({ title: `${tr('Actualizando', 'Updating')} ${p.name} ${tr('a', 'to')} ${plan?.newTag}`, steps: [tr('Guardando una copia de los archivos que cambian', 'Backing up the files that change'), tr('Reemplazando archivos', 'Replacing files'), tr('Añadiendo archivos nuevos', 'Adding new files'), tr('Conservando tus partidas y tu configuración', 'Keeping your saves and settings'), tr('Actualizando la biblioteca', 'Updating the library')], minMs: 3400, done: tr('Actualizado', 'Updated') }, () => api.updateApply(inst.id))
      setResult(tr(`Actualizado de ${r.fromTag} a ${r.toTag}: ${fmtNum(r.replaced)} archivos reemplazados, ${fmtNum(r.added)} nuevos y ${fmtNum(r.preserved)} conservados.`, `Updated from ${r.fromTag} to ${r.toTag}: ${fmtNum(r.replaced)} files replaced, ${fmtNum(r.added)} new and ${fmtNum(r.preserved)} kept.`))
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
          <div className="eyebrow">{tr('Actualizar', 'Update')}</div>
          <p className="panel-title">{p.name} <span className="mono muted">{inst.releaseTag} → {inst.latestTag}</span></p>
        </div>
        <button type="button" className="link" onClick={cancel}>{tr('Cerrar', 'Close')}</button>
      </div>

      {result ? (
        <>
          <p className="yes">{result}</p>
          <p className="note-line">{tr('Si algo no va bien, puedes deshacer la actualización desde «Más».', 'If something goes wrong, you can undo the update from "More".')}</p>
        </>
      ) : !downloaded ? (
        <>
          <p className="note-line">{tr('Primero se descarga la versión nueva desde la release oficial (con su SHA-256 si lo publica). Tu instalación no se toca hasta que revises los cambios y pulses «Aplicar».', 'First the new version is downloaded from the official release (with its SHA-256 if published). Your install is not touched until you review the changes and press "Apply".')}</p>
          <div className="actions">
            {dl && (dl.state === 'running' || dl.state === 'queued')
              ? <span className="muted">{tr('Descargando… sigue el progreso en Descargas.', 'Downloading… follow the progress in Downloads.')}</span>
              : <button type="button" className="btn-primary" onClick={() => dls.start(inst.project)}>{tr('Descargar', 'Download')} {inst.latestTag}</button>}
          </div>
        </>
      ) : !plan ? (
        <p className="note-line">{tr('Preparando…', 'Preparing…')}</p>
      ) : !plan.ready ? (
        <p className="note-line">
          {plan.reason === 'method'
            ? tr('Esta versión se publica como instalador o en un formato que no se actualiza automáticamente. Ábrelo desde Descargas o instala la versión nueva aparte.', 'This version is published as an installer or in a format that cannot be updated automatically. Open it from Downloads or install the new version separately.')
            : tr('No hay una versión nueva descargada.', 'No new version has been downloaded.')}
        </p>
      ) : (
        <>
          <dl className="compat">
            <div><dt>{tr('Archivos que se reemplazan', 'Files replaced')}</dt><dd className="num">{fmtNum(plan.replaced ?? 0)}</dd></div>
            <div><dt>{tr('Archivos nuevos', 'New files')}</dt><dd className="num">{fmtNum(plan.added ?? 0)}</dd></div>
            <div><dt>{tr('Se conservan (tuyos)', 'Kept (yours)')}</dt><dd className="num yes">{fmtNum(plan.preserved?.length ?? 0)}</dd></div>
            <div><dt>{tr('Solo en tu carpeta, no se tocan', 'Only in your folder, untouched')}</dt><dd className="num">{fmtNum(plan.keptOnlyYours ?? 0)}</dd></div>
          </dl>
          {plan.preserved && plan.preserved.length > 0 && (
            <div>
              <div className="eyebrow">{tr('Se conservan', 'Kept')}</div>
              <ul className="exe-list mono small-list">
                {plan.preserved.slice(0, 20).map((x) => (
                  <li key={x.path}>{x.path} <span className="muted">· {x.why === 'adapter' ? tr('protegido por el adaptador', 'protected by the adapter') : tr('cambiado después de instalar', 'changed after install')}</span></li>
                ))}
                {plan.preserved.length > 20 && <li className="muted">{tr('y', 'and')} {plan.preserved.length - 20} {tr('más', 'more')}</li>}
              </ul>
            </div>
          )}
          <p className="note-line">{tr('Antes de reemplazar nada se guarda una copia de los archivos que cambian. Si algo falla, se deja todo como estaba, y después puedes deshacer la actualización. Nada se borra de tu carpeta.', 'Before anything is replaced, the files that change are backed up. If something fails, everything is left as it was, and you can undo the update afterwards. Nothing is deleted from your folder.')}</p>
          <div className="actions">
            <button type="button" className="btn-primary" onClick={apply}>{tr('Aplicar la actualización', 'Apply the update')}</button>
            <button type="button" className="link" onClick={cancel}>{tr('Ahora no', 'Not now')}</button>
          </div>
        </>
      )}
      {err && <p className="note-line err">{err}</p>}
    </div>
  )
}
