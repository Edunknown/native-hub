import { useState } from 'react'
import { useLive } from '../app/live'
import { useTask } from '../app/task'
import { useNav } from '../app/nav'
import { IconBack } from '../app/icons'
import { GameFeature } from '../components/GameFeature'
import { api } from '../lib/api'
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format'
import type { GameDetail } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { tr } from '../lib/i18n'

export function GameView({ slug, project }: { slug: string; project?: string }) {
  const { back, canGoBack } = useNav()
  const live = useLive()
  const task = useTask()
  const loaded = useAsync(() => api.game(slug), [slug, live.version])
  const [fresh, setFresh] = useState<{ slug: string; detail: GameDetail } | null>(null)
  const detail = fresh?.slug === slug ? { status: 'ok' as const, data: fresh.detail } : loaded
  const live_ok = !live.status?.unsupported
  const refresh = async (projectSlug: string) => {
    const r = await task({ title: tr('Comprobando la release', 'Checking the release'), steps: [tr('Consultando el repositorio oficial', 'Querying the official repository'), tr('Leyendo la última release', 'Reading the latest release'), tr('Buscando el ejecutable Windows', 'Looking for the Windows executable')], minMs: 1800 }, () => api.refreshProject(projectSlug))
    setFresh({ slug, detail: r.detail })
    live.reload()
    const ev = r.outcome.events
    if (r.outcome.status === 'repo_missing') return tr('El repositorio ya no existe.', 'The repository no longer exists.')
    if (r.outcome.status === 'no_release') return tr('El proyecto no tiene releases publicadas.', 'The project has no published releases.')
    if (ev.includes('new_version')) return `${tr('Hay una versión nueva', 'A new version is available')}: ${r.outcome.tag}.`
    return `${tr('Sin cambios: la última release sigue siendo', 'No changes: the latest release is still')} ${r.outcome.tag}.`
  }
  if (detail.status === 'loading') return <main className="content"><p className="empty">{tr('Cargando…', 'Loading…')}</p></main>
  if (detail.status === 'error') return <main className="content"><p className="empty">{tr('No se encontró el juego en el catálogo.', 'Game not found in the catalog.')}</p></main>
  const { projects } = detail.data

  return (
    <main className="content tight">
      {canGoBack && (
        <div><button type="button" className="link" onClick={back}><IconBack width={14} height={14} />{tr('Volver', 'Back')}</button></div>
      )}
      {/* key: reinicia el selector al cambiar de juego */}
      <GameFeature key={`${slug}:${project ?? ''}`} detail={detail.data} eyebrow={tr('Ficha del juego', 'Game page')} initialProject={project}
        onRefresh={live_ok ? refresh : undefined} />

      <section>
        <div className="sec-head"><h2>{tr('Proyectos para este juego', 'Projects for this game')}</h2><span className="aside">{tr('Datos de GitHub', 'GitHub data')}</span></div>
        <table className="table">
          <thead>
            <tr><th>{tr('Proyecto', 'Project')}</th><th>{tr('Repositorio', 'Repository')}</th><th>{tr('Última release', 'Latest release')}</th><th>{tr('Último commit', 'Last commit')}</th><th className="r">{tr('Estrellas', 'Stars')}</th><th className="r">{tr('Comprobado', 'Checked')}</th></tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.slug}>
                <td>{p.name}{p.takedown && <span className="muted">{tr(' · retirado', ' · taken down')}</span>}{p.abandoned && <span className="muted">{tr(' · abandonado', ' · abandoned')}</span>}</td>
                <td className="mono">{p.repoUrl.replace(/^https?:\/\/(github\.com\/)?/, '')}</td>
                <td>{p.release ? <><span className="mono">{p.release.tag}</span> <span className="muted num">· {fmtDate(p.release.publishedAt)}</span></> : <span className="tbd">{tr('sin release', 'no release')}</span>}</td>
                <td className="num">{fmtDate(p.pushedAt) ?? <span className="tbd">—</span>}</td>
                <td className="r num">{p.stars != null ? fmtNum(p.stars) : <span className="tbd">—</span>}</td>
                <td className="r num muted">{fmtDateTime(p.checkedAt) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
