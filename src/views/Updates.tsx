import { useEffect, useState } from 'react'
import { useLive } from '../app/live'
import { useLibrary } from '../app/library'
import { useNav } from '../app/nav'
import { ProjectRow } from '../components/ProjectRow'
import { api } from '../lib/api'
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format'
import type { UpdateEvent, UpdateKind } from '../lib/types'

const GROUPS: { kind: UpdateKind; title: string }[] = [
  { kind: 'new_version', title: 'Nuevas versiones' },
  { kind: 'windows_build', title: 'Ahora con ejecutable Windows' },
  { kind: 'withdrawn', title: 'Releases retiradas' },
  { kind: 'repo_missing', title: 'Repositorios que ya no están' },
  { kind: 'abandoned', title: 'Proyectos abandonados' },
]

export function JobBar() {
  const { progress, cancel } = useLive()
  if (!progress) return null
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="jobbar">
      <span>{progress.job === 'scan' ? 'Buscando proyectos nuevos' : 'Comprobando releases'}</span>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="num">{progress.done} / {progress.total}</span>
      {progress.current && <span className="mono muted ellipsis">{progress.current}</span>}
      <button type="button" className="link" onClick={cancel}>Cancelar</button>
    </div>
  )
}

export function QuotaLine() {
  const { status } = useLive()
  const r = status?.rateLimit
  if (!r) return <span className="muted">Cuota de GitHub: sin datos todavía</span>
  const reset = new Date(r.reset * 1000)
  const expired = reset.getTime() < Date.now()
  return (
    <span className="num">
      Cuota de GitHub: {expired ? <>renovada</> : <>{fmtNum(r.remaining)} de {fmtNum(r.limit)} consultas, se renueva a las {reset.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</>}
      {status?.tokenConfigured ? ' · con token' : ' · sin token'}
    </span>
  )
}

export function Updates() {
  const live = useLive()
  const lib = useLibrary()
  const { go } = useNav()
  const mine = lib.items.filter((i) => i.updateAvailable)
  const { status, version } = live
  const [events, setEvents] = useState<UpdateEvent[] | null>(null)

  useEffect(() => {
    api.updateEvents(200).then((e) => {
      setEvents(e)
      if (e.some((x) => !x.seen)) api.markEventsSeen().then(live.reload, () => {})
    }, () => setEvents([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Actualizaciones</div>
        <h1 className="page-title">Actualizaciones</h1>
        <p className="page-lede">
          NATIVE HUB consulta la API oficial de cada repositorio para detectar versiones nuevas, releases retiradas y repositorios que desaparecen. Nada se descarga ni se sustituye sin tu permiso.
        </p>
      </div>

      {status?.unsupported ? (
        <p className="empty">La comprobación en vivo solo funciona en la app de escritorio. En el navegador ves el catálogo tal como se generó.</p>
      ) : (
        <section>
          <div className="sec-head"><h2>Estado</h2><span className="aside"><QuotaLine /></span></div>
          <dl className="settings">
            <div><dt>Última comprobación en vivo</dt><dd className="num">{fmtDateTime(status?.lastLiveCheck) ?? <span className="tbd">ninguna todavía</span>}</dd></div>
            <div><dt>Comprobados en 24 h</dt><dd className="num">{fmtNum(status?.checkedLast24h ?? 0)} de {fmtNum(status?.projectsWithRepo ?? 0)} proyectos con repositorio</dd></div>
            <div>
              <dt>Comprobar ahora</dt>
              <dd>
                <div className="actions">
                  <button type="button" className="btn-primary" disabled={status?.busy} onClick={live.startRefresh}>
                    {status?.busy ? 'Comprobando…' : 'Comprobar los menos recientes'}
                  </button>
                  <span className="note-line">Revisa hasta 200 proyectos no comprobados en las últimas 24 h, los más antiguos primero. Se detiene solo si se acaba la cuota de GitHub.</span>
                </div>
                {live.error && <p className="note-line err">{live.error}</p>}
              </dd>
            </div>
          </dl>
          <JobBar />
        </section>
      )}

      {mine.length > 0 && (
        <section>
          <div className="sec-head"><h2>Tus juegos con versión nueva</h2><button type="button" onClick={() => go({ name: 'library' })}>Actualizar en la biblioteca</button></div>
          <ul className="list">
            {mine.map((i) => (
              <ProjectRow key={i.id} project={i.projectData}
                end={<span className="mono">{i.releaseTag} → <span className="yes-plain">{i.latestTag}</span></span>} />
            ))}
          </ul>
        </section>
      )}

      {GROUPS.map(({ kind, title }) => {
        const list = (events ?? []).filter((e) => e.kind === kind)
        if (!list.length) return null
        return (
          <section key={kind}>
            <div className="sec-head"><h2>{title}</h2><span className="aside">{list.length}</span></div>
            <ul className="list">
              {list.map((e) => (
                <ProjectRow key={e.id} project={e.project}
                  end={<>
                    {e.toTag && <span className="mono">{e.fromTag ? `${e.fromTag} → ` : ''}<span className="yes-plain">{e.toTag}</span></span>}
                    <span className="num">{fmtDate(e.detectedAt)}{!e.seen && <span className="flag"> nuevo</span>}</span>
                  </>} />
              ))}
            </ul>
          </section>
        )
      })}
      {events && events.length === 0 && !status?.unsupported && (
        <p className="empty">Todavía no se ha detectado ningún cambio. Las novedades aparecerán aquí después de cada comprobación.</p>
      )}
      <p className="devnote">Al actualizar un juego instalado se conservan tus partidas y tu configuración, y se puede deshacer.</p>
    </main>
  )
}
