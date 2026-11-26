import { ProjectRow } from '../components/ProjectRow'
import { search } from '../lib/api'
import { plural } from '../lib/format'

export function Search({ query }: { query: string }) {
  const results = search(query)
  const projects = results.flatMap((r) => r.projects)
  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Búsqueda</div>
        <h1 className="page-title">«{query}»</h1>
        <p className="page-lede">{plural(results.length, 'juego', 'juegos')} · {plural(projects.length, 'proyecto', 'proyectos')}</p>
      </div>
      {projects.length > 0 ? (
        <ul className="list">
          {projects.map((p) => (
            <ProjectRow key={p.slug} project={p}
              end={p.hasWindowsExecutable ? <span className="yes">Ejecutable Windows</span> : <span>Solo código fuente</span>} />
          ))}
        </ul>
      ) : (
        <p className="empty">Nada en el catálogo coincide. Si conoces un proyecto que falta, quedará registrado cuando llegue el descubrimiento automático (fase 3).</p>
      )}
    </main>
  )
}
