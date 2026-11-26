import { useCatalog } from '../app/catalog'
import { ConsoleIndex } from '../components/ConsoleIndex'
import { ProjectTable } from '../components/ProjectTable'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
import { useAsync } from '../lib/useAsync'

export function Consoles({ platform }: { platform?: string }) {
  const { platformOf } = useCatalog()
  const p = platform ? platformOf(platform) : undefined
  const projects = useAsync(() => (platform ? api.platformProjects(platform) : Promise.resolve([])), [platform])

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Consolas{p ? ` · ${p.family}` : ''}</div>
        <h1 className="page-title">{p ? p.name : 'Todas las consolas'}</h1>
        {p ? (
          <p className="page-lede">{fmtNum(p.projectCount)} proyectos · {fmtNum(p.installableCount)} con ejecutable Windows</p>
        ) : (
          <p className="page-lede">El número indica cuántos proyectos hay de cada plataforma. La lista crece a medida que se incorporan proyectos nuevos.</p>
        )}
      </div>

      {p && projects.status === 'ok' && (
        projects.data.length > 0
          ? <ProjectTable items={projects.data} showPlatform={false} />
          : <p className="empty">Aún no hay proyectos para {p.name}. Cuando se incorporen aparecerán aquí.</p>
      )}

      <section>
        <div className="sec-head"><h2>Plataformas</h2></div>
        <ConsoleIndex current={platform} />
      </section>
    </main>
  )
}
