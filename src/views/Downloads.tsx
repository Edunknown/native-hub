import { useState } from 'react'
import { useDownloads } from '../app/downloads'
import { useNav } from '../app/nav'
import { useTask } from '../app/task'
import { api, openExternal } from '../lib/api'
import { fmtDateTime, fmtSize } from '../lib/format'
import type { DownloadItem } from '../lib/types'
import { tr } from '../lib/i18n'

const STATE_LABEL: Record<DownloadItem['state'], string> = {
  queued: tr('En cola', 'Queued'),
  running: tr('Descargando', 'Downloading'),
  paused: tr('En pausa', 'Paused'),
  done: tr('Descargado', 'Downloaded'),
  failed: 'Error',
  cancelled: tr('Cancelado', 'Cancelled'),
}

function Verify({ d }: { d: DownloadItem }) {
  if (d.state !== 'done') return null
  if (d.verified === true) return <span className="yes">{tr('SHA-256 comprobado', 'SHA-256 verified')}</span>
  if (d.verified === false) return <span className="err">{tr('SHA-256 distinto', 'SHA-256 mismatch')}</span>
  return <span className="muted" title={d.sha256Local ?? ''}>{tr('Sin hash publicado · SHA-256 local registrado', 'No published hash · local SHA-256 recorded')}</span>
}

function Row({ d }: { d: DownloadItem }) {
  const { progress, reload } = useDownloads()
  const { go } = useNav()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const task = useTask()
  const p = progress[d.id]
  const done = d.state === 'running' && p ? p.done : d.done
  const total = (d.state === 'running' && p?.total) || d.total
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : null
  const act = (fn: () => Promise<unknown>) => () => fn().then(reload, reload)

  return (
    <li className="dl">
      <div className="dl-main">
        <div>
          <span className="game">{d.projectName ?? d.project}</span>
          {d.gameTitle && <span className="muted"> · {d.gameTitle}</span>}
          {d.releaseTag && <span className="mono muted"> · {d.releaseTag}</span>}
        </div>
        <div className="mono muted ellipsis-wide" title={d.assetName ?? ''}>{d.assetName}</div>
        {(d.state === 'running' || d.state === 'paused' || d.state === 'queued') && (
          <div className="dl-bar">
            <span className="bar wide"><i style={{ width: `${pct ?? 0}%` }} /></span>
            <span className="num muted">
              {fmtSize(done)}{total ? ` ${tr('de', 'of')} ${fmtSize(total)}` : ''}{pct != null ? ` · ${pct} %` : ''}
              {d.state === 'running' && p?.bytesPerSec ? ` · ${fmtSize(p.bytesPerSec)}/s` : ''}
            </span>
          </div>
        )}
        {d.error?.startsWith('ANTIVIRUS: ') ? (
          <div className="av">
            <p className="err">{d.error.slice('ANTIVIRUS: '.length)}</p>
            <p className="note-line">
              {tr('Pasa a menudo con proyectos nuevos que publican ejecutables sin firma digital, pero también es como se reparte el malware, sobre todo en repositorios recientes o con muchos forks. NATIVE HUB no intenta saltarse el antivirus. Antes de nada, revisa el repositorio (quién lo publica, cuántas estrellas tiene, si otros usuarios lo comentan) o prueba otra versión u otro archivo.', 'This often happens with new projects that publish unsigned executables, but it is also how malware spreads, especially in recent repositories or ones with many forks. NATIVE HUB never tries to bypass your antivirus. First review the repository (who publishes it, how many stars it has, whether other users discuss it) or try another version or file.')}
            </p>
            <span className="cand-actions">
              <button type="button" className="btn-line" onClick={() => openExternal(d.url.split('/releases/')[0])}>{tr('Ver el repositorio', 'View the repository')}</button>
              {d.gameSlug && <button type="button" className="link" onClick={() => go({ name: 'game', slug: d.gameSlug!, project: d.project })}>{tr('Elegir otra versión o archivo', 'Choose another version or file')}</button>}
            </span>
          </div>
        ) : d.error && <p className="note-line err">{d.error}</p>}
        {d.state === 'done' && (
          <p className="note-line">
            <Verify d={d} /> · {fmtSize(d.done)} · {fmtDateTime(d.finishedAt)}
          </p>
        )}
      </div>
      <div className="dl-end">
        <span className={d.state === 'done' ? 'yes-plain' : d.state === 'failed' ? 'err' : 'muted'}>{STATE_LABEL[d.state]}</span>
        <span className="dl-actions">
          {d.state === 'running' && <button type="button" className="link" onClick={act(() => api.downloadPause(d.id))}>{tr('Pausar', 'Pause')}</button>}
          {(d.state === 'paused' || d.state === 'failed') && <button type="button" className="btn-line" onClick={act(() => api.downloadResume(d.id))}>{d.state === 'failed' ? tr('Reintentar', 'Retry') : tr('Reanudar', 'Resume')}</button>}
          {(d.state === 'running' || d.state === 'queued' || d.state === 'paused') && <button type="button" className="link" onClick={act(() => api.downloadCancel(d.id))}>{tr('Cancelar', 'Cancel')}</button>}
          {d.state === 'done' && <button type="button" className="btn-line" onClick={() => api.downloadReveal(d.id)}>{tr('Mostrar en la carpeta', 'Show in folder')}</button>}
          {d.state === 'done' && !confirmDelete && <button type="button" className="link" onClick={() => setConfirmDelete(true)}>{tr('Borrar archivo', 'Delete file')}</button>}
          {d.state === 'done' && confirmDelete && (
            <>
              <button type="button" className="link err" onClick={act(() => task({ title: `${tr('Borrando', 'Deleting')} ${d.assetName ?? tr('el archivo', 'the file')}`, steps: [tr('Borrando el archivo descargado', 'Deleting the downloaded file'), tr('Actualizando la lista de descargas', 'Updating the downloads list')], minMs: 1400, done: tr('Borrado', 'Deleted') }, () => api.downloadRemove(d.id, true)))}>{tr('Sí, borrar', 'Yes, delete')}</button>
              <button type="button" className="link" onClick={() => setConfirmDelete(false)}>No</button>
            </>
          )}
          {(d.state === 'cancelled' || d.state === 'failed') && <button type="button" className="link" onClick={act(() => api.downloadRemove(d.id, true))}>{tr('Quitar', 'Remove')}</button>}
          {d.gameSlug && <button type="button" className="link" onClick={() => go({ name: 'game', slug: d.gameSlug!, project: d.project })}>{tr('Ficha', 'Page')}</button>}
        </span>
      </div>
    </li>
  )
}

export function Downloads() {
  const { items, available } = useDownloads()
  const active = items.filter((d) => ['running', 'queued', 'paused'].includes(d.state))
  const finished = items.filter((d) => !['running', 'queued', 'paused'].includes(d.state))

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">{tr('Descargas', 'Downloads')}</div>
        <h1 className="page-title">{tr('Descargas', 'Downloads')}</h1>
        <p className="page-lede">
          {tr('Cada descarga sale de la release oficial del proyecto, solo por HTTPS y desde GitHub, GitLab o Codeberg. Si el proyecto publica el SHA-256, se comprueba y un archivo que no coincide se descarta. Nada se descomprime ni se ejecuta hasta que lo instalas.', 'Every download comes from the project\'s official release, only over HTTPS and from GitHub, GitLab or Codeberg. If the project publishes a SHA-256, it is checked and a file that does not match is discarded. Nothing is unpacked or run until you install it.')}
        </p>
      </div>

      {!available ? (
        <p className="empty">{tr('Las descargas solo funcionan en la app de escritorio.', 'Downloads only work in the desktop app.')}</p>
      ) : items.length === 0 ? (
        <p className="empty">{tr('No hay descargas. Abre la ficha de un proyecto con ejecutable Windows y pulsa «Descargar».', 'No downloads. Open the page of a project with a Windows executable and press "Download".')}</p>
      ) : (
        <>
          {active.length > 0 && (
            <section>
              <div className="sec-head"><h2>{tr('En curso', 'In progress')}</h2><span className="aside">{active.length}</span></div>
              <ul className="list">{active.map((d) => <Row key={d.id} d={d} />)}</ul>
            </section>
          )}
          {finished.length > 0 && (
            <section>
              <div className="sec-head"><h2>{tr('Terminadas', 'Finished')}</h2><span className="aside">{finished.length}</span></div>
              <ul className="list">{finished.map((d) => <Row key={d.id} d={d} />)}</ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
