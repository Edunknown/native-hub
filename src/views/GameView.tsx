import { useNav } from '../app/nav'
import { IconBack } from '../app/icons'
import { GameFeature } from '../components/GameFeature'
import { gameOf, projectsForGame } from '../lib/api'
import { fmtDate, fmtDateTime } from '../lib/format'

export function GameView({ slug, project }: { slug: string; project?: string }) {
  const { back, canGoBack } = useNav()
  const game = gameOf(slug)
  if (!game) return <main className="content"><p className="empty">Juego no encontrado en el catálogo.</p></main>
  const projects = projectsForGame(slug)

  return (
    <main className="content tight">
      {canGoBack && (
        <div><button type="button" className="link" onClick={back}><IconBack width={14} height={14} />Volver</button></div>
      )}
      {/* key: reinicia el selector al cambiar de juego */}
      <GameFeature key={`${slug}:${project ?? ''}`} game={game} eyebrow="Ficha del juego" initialProject={project} />

      <section>
        <div className="sec-head"><h2>Proyectos para este juego</h2><span className="aside">Datos de GitHub</span></div>
        <table className="table">
          <thead>
            <tr><th>Proyecto</th><th>Repositorio</th><th>Última release</th><th>Último commit</th><th className="r">Comprobado</th></tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.slug}>
                <td>{p.name}{p.archived && <span className="muted"> · archivado</span>}</td>
                <td className="mono">{p.repo.owner}/{p.repo.name}</td>
                <td>{p.release ? <><span className="mono">{p.release.tag}</span> <span className="muted num">· {fmtDate(p.release.publishedAt)}</span></> : <span className="tbd">sin release</span>}</td>
                <td className="num">{fmtDate(p.pushedAt) ?? <span className="tbd">—</span>}</td>
                <td className="r num muted">{fmtDateTime(p.checkedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
