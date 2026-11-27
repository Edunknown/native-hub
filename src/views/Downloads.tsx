import { useState } from 'react'
import { useDownloads } from '../app/downloads'
import { useNav } from '../app/nav'
import { api, openExternal } from '../lib/api'
import { fmtDateTime, fmtSize } from '../lib/format'
import type { DownloadItem } from '../lib/types'

const STATE_LABEL: Record<DownloadItem['state'], string> = {
  queued: 'En cola',
  running: 'Descargando',
  paused: 'En pausa',
  done: 'Descargado',
  failed: 'Error',
  cancelled: 'Cancelado',
}

function Verify({ d }: { d: DownloadItem }) {
  if (d.state !== 'done') return null
  if (d.verified === true) return <span className="yes">SHA-256 comprobado</span>
  if (d.verified === false) return <span className="err">SHA-256 distinto</span>
  return <span className="muted" title={d.sha256Local ?? ''}>Sin hash publicado · SHA-256 local registrado</span>
}

function Row({ d }: { d: DownloadItem }) {
  const { progress, reload } = useDownloads()
  const { go } = useNav()
  const [confirmDelete, setConfirmDelete] = useState(false)
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
              {fmtSize(done)}{total ? ` de ${fmtSize(total)}` : ''}{pct != null ? ` · ${pct} %` : ''}
              {d.state === 'running' && p?.bytesPerSec ? ` · ${fmtSize(p.bytesPerSec)}/s` : ''}
            </span>
          </div>
        )}
        {d.error?.startsWith('ANTIVIRUS: ') ? (
          <div className="av">
            <p className="err">{d.error.slice('ANTIVIRUS: '.length)}</p>
            <p className="note-line">
              Pasa a menudo con proyectos nuevos que publican ejecutables sin firma digital, pero también es como se reparte el malware, sobre todo en repositorios recientes o con muchos forks. NATIVE HUB no intenta saltarse el antivirus.
              Antes de nada, revisa el repositorio (quién lo publica, cuántas estrellas tiene, si otros usuarios lo comentan) o prueba otra versión u otro archivo.
            </p>
            <span className="cand-actions">
              <button type="button" className="btn-line" onClick={() => openExternal(d.url.split('/releases/')[0])}>Ver el repositorio</button>
              {d.gameSlug && <button type="button" className="link" onClick={() => go({ name: 'game', slug: d.gameSlug!, project: d.project })}>Elegir otra versión o archivo</button>}
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
          {d.state === 'running' && <button type="button" className="link" onClick={act(() => api.downloadPause(d.id))}>Pausar</button>}
          {(d.state === 'paused' || d.state === 'failed') && <button type="button" className="btn-line" onClick={act(() => api.downloadResume(d.id))}>{d.state === 'failed' ? 'Reintentar' : 'Reanudar'}</button>}
          {(d.state === 'running' || d.state === 'queued' || d.state === 'paused') && <button type="button" className="link" onClick={act(() => api.downloadCancel(d.id))}>Cancelar</button>}
          {d.state === 'done' && <button type="button" className="btn-line" onClick={() => api.downloadReveal(d.id)}>Mostrar en la carpeta</button>}
          {d.state === 'done' && !confirmDelete && <button type="button" className="link" onClick={() => setConfirmDelete(true)}>Borrar archivo</button>}
          {d.state === 'done' && confirmDelete && (
            <>
              <button type="button" className="link err" onClick={act(() => api.downloadRemove(d.id, true))}>Sí, borrar</button>
              <button type="button" className="link" onClick={() => setConfirmDelete(false)}>No</button>
            </>
          )}
          {(d.state === 'cancelled' || d.state === 'failed') && <button type="button" className="link" onClick={act(() => api.downloadRemove(d.id, true))}>Quitar</button>}
          {d.gameSlug && <button type="button" className="link" onClick={() => go({ name: 'game', slug: d.gameSlug!, project: d.project })}>Ficha</button>}
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
        <div className="eyebrow">Descargas</div>
        <h1 className="page-title">Descargas</h1>
        <p className="page-lede">
          Cada descarga sale de la release oficial del proyecto, solo por HTTPS y desde GitHub, GitLab o Codeberg. Si el proyecto publica el SHA-256, se comprueba y un archivo que no coincide se descarta. Nada se descomprime ni se ejecuta: eso llega con la instalación (fase 5).
        </p>
      </div>

      {!available ? (
        <p className="empty">Las descargas solo funcionan en la app de escritorio.</p>
      ) : items.length === 0 ? (
        <p className="empty">No hay descargas. Abre la ficha de un proyecto con ejecutable Windows y pulsa «Descargar».</p>
      ) : (
        <>
          {active.length > 0 && (
            <section>
              <div className="sec-head"><h2>En curso</h2><span className="aside">{active.length}</span></div>
              <ul className="list">{active.map((d) => <Row key={d.id} d={d} />)}</ul>
            </section>
          )}
          {finished.length > 0 && (
            <section>
              <div className="sec-head"><h2>Terminadas</h2><span className="aside">{finished.length}</span></div>
              <ul className="list">{finished.map((d) => <Row key={d.id} d={d} />)}</ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
