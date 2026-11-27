import { CatalogBrowser } from '../components/CatalogBrowser'
import { tr } from '../lib/i18n'

export function Search({ query }: { query: string }) {
  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">{tr('Búsqueda', 'Search')}</div>
        <h1 className="page-title">{tr('«', '“')}{query}{tr('»', '”')}</h1>
      </div>
      <CatalogBrowser q={query} layout="list" />
    </main>
  )
}
