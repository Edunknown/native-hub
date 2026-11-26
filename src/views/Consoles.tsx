import { ConsoleIndex } from '../components/ConsoleIndex'
import { ProjectRow } from '../components/ProjectRow'
import { gamesForPlatform, platformOf, projectsForGame } from '../lib/api'

export function Consoles({ platform }: { platform?: string }) {
  const p = platform ? platformOf(platform) : undefined
  const projects = p ? gamesForPlatform(p.slug).flatMap((g) => projectsForGame(g.slug)) : []

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Consolas</div>
        <h1 className="page-title">{p ? p.name : 'Todas las consolas'}</h1>
        {!p && <p className="page-lede">El número indica los proyectos instalables. La lista de plataformas crecerá a medida que se incorporen proyectos nuevos.</p>}
      </div>

      {p && (
        <section>
          <div className="sec-head"><h2>Proyectos</h2><span className="aside">{projects.length}</span></div>
          {projects.length > 0 ? (
            <ul className="list">
              {projects.map((pr) => (
                <ProjectRow key={pr.slug} project={pr}
                  end={pr.hasWindowsExecutable ? <span className="yes">Ejecutable Windows</span> : <span>Solo código fuente</span>} />
              ))}
            </ul>
          ) : (
            <p className="empty">Aún no hay proyectos revisados para {p.name}. Cuando se aprueben aparecerán aquí.</p>
          )}
        </section>
      )}

      <section>
        <div className="sec-head"><h2>Plataformas</h2></div>
        <ConsoleIndex current={platform} showInDev={false} />
      </section>
    </main>
  )
}
