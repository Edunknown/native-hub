import { ExeFlag, ProjectRow } from '../components/ProjectRow'
import { api } from '../lib/api'
import { plural } from '../lib/format'
import { useAsync } from '../lib/useAsync'

export function Search({ query }: { query: string }) {
  const results = useAsync(() => api.search(query, 200), [query])
  const projects = results.status === 'ok' ? results.data : []
  const games = new Set(projects.map((p) => p.game)).size

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Búsqueda</div>
        <h1 className="page-title">«{query}»</h1>
        {results.status === 'ok' && <p className="page-lede">{plural(games, 'juego', 'juegos')} · {plural(projects.length, 'proyecto', 'proyectos')}</p>}
      </div>
      {projects.length > 0 ? (
        <ul className="list">
          {projects.map((p) => <ProjectRow key={p.slug} project={p} end={<ExeFlag project={p} />} />)}
        </ul>
      ) : results.status === 'ok' ? (
        <p className="empty">Nada en el catálogo coincide. Prueba con el nombre del juego, del proyecto o de la consola.</p>
      ) : null}
    </main>
  )
}
