import { ExeFlag, ProjectRow } from '../components/ProjectRow'
import { api } from '../lib/api'
import { plural } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { tr } from '../lib/i18n'

export function Search({ query }: { query: string }) {
  const results = useAsync(() => api.search(query, 200), [query])
  const projects = results.status === 'ok' ? results.data : []
  const games = new Set(projects.map((p) => p.game)).size

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">{tr('Búsqueda', 'Search')}</div>
        <h1 className="page-title">{tr('«', '“')}{query}{tr('»', '”')}</h1>
        {results.status === 'ok' && <p className="page-lede">{plural(games, tr('juego', 'game'), tr('juegos', 'games'))} · {plural(projects.length, tr('proyecto', 'project'), tr('proyectos', 'projects'))}</p>}
      </div>
      {projects.length > 0 ? (
        <ul className="list">
          {projects.map((p) => <ProjectRow key={p.slug} project={p} end={<ExeFlag project={p} />} />)}
        </ul>
      ) : results.status === 'ok' ? (
        <p className="empty">{tr('Nada en el catálogo coincide. Prueba con el nombre del juego, del proyecto o de la consola.', 'Nothing in the catalog matches. Try the name of the game, the project or the console.')}</p>
      ) : null}
    </main>
  )
}
