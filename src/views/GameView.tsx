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

export function GameView({ slug, project }: { slug: string; project?: string }) {
  const { back, canGoBack } = useNav()
  const live = useLive()
  const task = useTask()
  const loaded = useAsync(() => api.game(slug), [slug, live.version])
  const [fresh, setFresh] = useState<{ slug: string; detail: GameDetail } | null>(null)
  const detail = fresh?.slug === slug ? { status: 'ok' as const, data: fresh.detail } : loaded
  const live_ok = !live.status?.unsupported
  const refresh = async (projectSlug: string) => {
    const r = await task({ title: 'Comprobando la release', steps: ['Consultando el repositorio oficial', 'Leyendo la última release', 'Buscando el ejecutable Windows'], minMs: 1800 }, () => api.refreshProject(projectSlug))
    setFresh({ slug, detail: r.detail })
    live.reload()
    const ev = r.outcome.events
    if (r.outcome.status === 'repo_missing') return 'El repositorio ya no existe.'
    if (r.outcome.status === 'no_release') return 'El proyecto no tiene releases publicadas.'
    if (ev.includes('new_version')) return `Hay una versión nueva: ${r.outcome.tag}.`
    return `Sin cambios: la última release sigue siendo ${r.outcome.tag}.`
  }
  if (detail.status === 'loading') return <main className="content"><p className="empty">Cargando…</p></main>
  if (detail.status === 'error') return <main className="content"><p className="empty">No se encontró el juego en el catálogo.</p></main>
  const { projects } = detail.data

  return (
    <main className="content tight">
      {canGoBack && (
        <div><button type="button" className="link" onClick={back}><IconBack width={14} height={14} />Volver</button></div>
      )}
      {/* key: reinicia el selector al cambiar de juego */}
      <GameFeature key={`${slug}:${project ?? ''}`} detail={detail.data} eyebrow="Ficha del juego" initialProject={project}
        onRefresh={live_ok ? refresh : undefined} />

      <section>
        <div className="sec-head"><h2>Proyectos para este juego</h2><span className="aside">Datos de GitHub</span></div>
        <table className="table">
          <thead>
            <tr><th>Proyecto</th><th>Repositorio</th><th>Última release</th><th>Último commit</th><th className="r">Estrellas</th><th className="r">Comprobado</th></tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.slug}>
                <td>{p.name}{p.takedown && <span className="muted"> · retirado</span>}{p.abandoned && <span className="muted"> · abandonado</span>}</td>
                <td className="mono">{p.repoUrl.replace(/^https?:\/\/(github\.com\/)?/, '')}</td>
                <td>{p.release ? <><span className="mono">{p.release.tag}</span> <span className="muted num">· {fmtDate(p.release.publishedAt)}</span></> : <span className="tbd">sin release</span>}</td>
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
