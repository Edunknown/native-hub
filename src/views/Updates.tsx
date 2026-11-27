import { useEffect, useState } from 'react'
import { useLive } from '../app/live'
import { useLibrary } from '../app/library'
import { useNav } from '../app/nav'
import { ProjectRow } from '../components/ProjectRow'
import { api } from '../lib/api'
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format'
import type { UpdateEvent, UpdateKind } from '../lib/types'
import { locale, tr } from '../lib/i18n'
import { ErrorNote } from '../components/ErrorNote'

const GROUPS: { kind: UpdateKind; title: string }[] = [
  { kind: 'new_version', title: tr('Nuevas versiones', 'New versions') },
  { kind: 'windows_build', title: tr('Ahora con ejecutable Windows', 'Now with a Windows executable') },
  { kind: 'withdrawn', title: tr('Releases retiradas', 'Withdrawn releases') },
  { kind: 'repo_missing', title: tr('Repositorios que ya no están', 'Repositories that are gone') },
  { kind: 'abandoned', title: tr('Proyectos abandonados', 'Abandoned projects') },
]

export function JobBar() {
  const { progress, cancel } = useLive()
  if (!progress) return null
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="jobbar">
      <span>{progress.job === 'scan' ? tr('Buscando proyectos nuevos', 'Searching for new projects') : progress.job === 'sync' ? tr('Sincronizando con Recompendium', 'Syncing with Recompendium') : progress.job === 'catalog' ? tr('Actualizando el catálogo', 'Updating the catalog') : tr('Comprobando releases', 'Checking releases')}</span>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="num">{progress.done} / {progress.total}</span>
      {progress.current && <span className="mono muted ellipsis">{progress.current}</span>}
      <button type="button" className="link" onClick={cancel}>{tr('Cancelar', 'Cancel')}</button>
    </div>
  )
}

export function QuotaLine() {
  const { status } = useLive()
  const r = status?.rateLimit
  if (!r) return <span className="muted">{tr('Cuota de GitHub: sin datos todavía', 'GitHub quota: no data yet')}</span>
  const reset = new Date(r.reset * 1000)
  const expired = reset.getTime() < Date.now()
  return (
    <span className="num">
      {tr('Cuota de GitHub', 'GitHub quota')}: {expired ? <>{tr('renovada', 'reset')}</> : <>{fmtNum(r.remaining)} {tr('de', 'of')} {fmtNum(r.limit)} {tr('consultas, se renueva a las', 'requests, resets at')} {reset.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</>}
      {status?.tokenConfigured ? tr(' · con token', ' · with token') : tr(' · sin token', ' · no token')}
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
        <div className="eyebrow">{tr('Actualizaciones', 'Updates')}</div>
        <h1 className="page-title">{tr('Actualizaciones', 'Updates')}</h1>
        <p className="page-lede">
          {tr('NATIVE HUB consulta la API oficial de cada repositorio para detectar versiones nuevas, releases retiradas y repositorios que desaparecen. Nada se descarga ni se sustituye sin tu permiso.', 'NATIVE HUB queries each repository\'s official API to detect new versions, withdrawn releases and repositories that disappear. Nothing is downloaded or replaced without your permission.')}
        </p>
      </div>

      {status?.unsupported ? (
        <p className="empty">{tr('La comprobación en vivo solo funciona en la app de escritorio. En el navegador ves el catálogo tal como se generó.', 'Live checks only work in the desktop app. In the browser you see the catalog as it was generated.')}</p>
      ) : (
        <section>
          <div className="sec-head"><h2>{tr('Estado', 'Status')}</h2><span className="aside"><QuotaLine /></span></div>
          <dl className="settings">
            <div><dt>{tr('Última comprobación en vivo', 'Last live check')}</dt><dd className="num">{fmtDateTime(status?.lastLiveCheck) ?? <span className="tbd">{tr('ninguna todavía', 'none yet')}</span>}</dd></div>
            <div><dt>{tr('Comprobados en 24 h', 'Checked in 24 h')}</dt><dd className="num">{fmtNum(status?.checkedLast24h ?? 0)} {tr('de', 'of')} {fmtNum(status?.projectsWithRepo ?? 0)} {tr('proyectos con repositorio', 'projects with a repository')}</dd></div>
            <div>
              <dt>{tr('Comprobar ahora', 'Check now')}</dt>
              <dd>
                <div className="actions">
                  <button type="button" className="btn-primary" disabled={status?.busy} onClick={live.startRefresh}>
                    {status?.busy ? tr('Comprobando…', 'Checking…') : tr('Comprobar los menos recientes', 'Check the least recent')}
                  </button>
                  <span className="note-line">{tr('Revisa hasta 200 proyectos no comprobados en las últimas 24 h, los más antiguos primero. Se detiene solo si se acaba la cuota de GitHub.', 'Checks up to 200 projects not checked in the last 24 h, oldest first. It stops on its own if the GitHub quota runs out.')}</span>
                </div>
                {live.error && <ErrorNote error={live.error} />}
              </dd>
            </div>
          </dl>
          <JobBar />
        </section>
      )}

      {mine.length > 0 && (
        <section>
          <div className="sec-head"><h2>{tr('Tus juegos con versión nueva', 'Your games with a new version')}</h2><button type="button" onClick={() => go({ name: 'library' })}>{tr('Actualizar en la biblioteca', 'Update in the library')}</button></div>
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
                    <span className="num">{fmtDate(e.detectedAt)}{!e.seen && <span className="flag">{tr(' nuevo', ' new')}</span>}</span>
                  </>} />
              ))}
            </ul>
          </section>
        )
      })}
      {events && events.length === 0 && !status?.unsupported && (
        <p className="empty">{tr('Todavía no se ha detectado ningún cambio. Las novedades aparecerán aquí después de cada comprobación.', 'No changes detected yet. News will show up here after each check.')}</p>
      )}
      <p className="devnote">{tr('Al actualizar un juego instalado se conservan tus partidas y tu configuración, y se puede deshacer.', 'Updating an installed game keeps your saves and settings, and can be undone.')}</p>
    </main>
  )
}
