import { useEffect, useMemo, useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useLive } from '../app/live'
import { api } from '../lib/api'
import { hasFilters } from '../lib/discover'
import { familyLabel, fmtNum, kindLabel, statusLabel } from '../lib/format'
import type { DevStatus, DiscoverFilter, Listing, Project, ProjectKind, SortOrder } from '../lib/types'
import { tr } from '../lib/i18n'
import { ErrorNote } from './ErrorNote'
import { ProjectTable } from './ProjectTable'
import { ExeFlag, ProjectRow } from './ProjectRow'

const PAGE = 100
const KEY = 'nh-browse-filters'

const LISTINGS: { id: Listing | undefined; label: string }[] = [
  { id: 'library', label: tr('Con ejecutable Windows', 'With a Windows executable') },
  { id: 'in_development', label: tr('En desarrollo o sin ejecutable', 'In development or no executable') },
  { id: undefined, label: tr('Todos', 'All') },
]
const KINDS: ProjectKind[] = ['static_recomp', 'decomp_port', 'native_layer', 'engine_reimpl', 'source_port', 'fan_remake', 'decompilation', 'other']
const STATUSES: DevStatus[] = ['complete', 'stable', 'playable', 'beta', 'experimental', 'unknown']

type Filters = Omit<DiscoverFilter, 'q' | 'offset' | 'limit'>

/** Filters are remembered per window (a convenience; nothing breaks without storage). */
function loadFilters(key: string, fallback: Filters): Filters {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (v && typeof v === 'object') return { ...fallback, ...v }
  } catch { /* no storage */ }
  return fallback
}
function saveFilters(key: string, f: Filters) {
  try { sessionStorage.setItem(key, JSON.stringify(f)) } catch { /* no storage */ }
}

/**
 * Catalog with filters and sort order. Discover shows it as a table; Search (with the text
 * from the header) as an editorial list.
 */
export function CatalogBrowser({ q, layout }: { q?: string; layout: 'table' | 'list' }) {
  const { platforms, summary } = useCatalog()
  const live = useLive()
  const searching = Boolean(q?.trim())
  // Searching starts with everything (installable first); browsing with what can be installed.
  const key = `${KEY}-${searching ? 'search' : 'browse'}`
  const defaults: Filters = searching ? {} : { listing: 'library' }
  const [f, setF] = useState<Filters>(() => loadFilters(key, defaults))
  const [items, setItems] = useState<Project[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Filters) => setF((prev) => {
    const next = { ...prev, ...patch }
    saveFilters(key, next)
    return next
  })
  const filter = useMemo<DiscoverFilter>(() => ({ ...f, q: q?.trim() || undefined }), [f, q])

  useEffect(() => {
    let alive = true
    api.discover({ ...filter, offset: 0, limit: PAGE }).then(
      (r) => { if (alive) { setItems(r.items); setTotal(r.total); setError(null) } },
      (e) => { if (alive) setError(String(e)) },
    )
    return () => { alive = false }
  }, [filter, live.version, summary.generatedAt])

  const more = () => api.discover({ ...filter, offset: items.length, limit: PAGE }).then((r) => setItems((prev) => [...prev, ...r.items]), (e) => setError(String(e)))

  const families = summary.families ?? []
  const sorts: { id: SortOrder | undefined; label: string }[] = [
    ...(searching ? [{ id: undefined, label: tr('Relevancia', 'Relevance') }] : [{ id: undefined, label: tr('Título', 'Title') }]),
    ...(searching ? [{ id: 'title' as SortOrder, label: tr('Título', 'Title') }] : []),
    { id: 'updated', label: tr('Última release', 'Latest release') },
    { id: 'newest', label: tr('Más nuevos', 'Newest') },
    { id: 'stars', label: tr('Más populares', 'Most popular') },
  ]
  const active = JSON.stringify(f) !== JSON.stringify(defaults) && (hasFilters(f) || f.sort != null || f.listing !== defaults.listing)

  return (
    <>
      <div className="filters" role="group" aria-label={tr('Disponibilidad', 'Availability')}>
        {LISTINGS.map((o) => (
          <button key={o.label} type="button" aria-pressed={f.listing === o.id} onClick={() => set({ listing: o.id })}>{o.label}</button>
        ))}
      </div>

      <div className="refine">
        <label>
          <span>{tr('Consola', 'Console')}</span>
          <select value={f.platform ?? (f.family ? `family:${f.family}` : '')} onChange={(e) => {
            const v = e.target.value
            set(v.startsWith('family:') ? { family: v.slice(7), platform: undefined } : { platform: v || undefined, family: undefined })
          }}>
            <option value="">{tr('Todas', 'All')}</option>
            {families.map((fam) => (
              <optgroup key={fam} label={familyLabel(fam)}>
                <option value={`family:${fam}`}>{tr('Todo', 'All of')} {familyLabel(fam)}</option>
                {platforms.filter((p) => p.family === fam && p.projectCount > 0).map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span>{tr('Tipo', 'Type')}</span>
          <select value={f.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || undefined) as ProjectKind | undefined })}>
            <option value="">{tr('Todos', 'All')}</option>
            {KINDS.map((k) => <option key={k} value={k}>{kindLabel[k]}</option>)}
          </select>
        </label>
        <label>
          <span>{tr('Estado', 'Status')}</span>
          <select value={f.status?.[0] ?? ''} onChange={(e) => set({ status: e.target.value ? [e.target.value as DevStatus] : undefined })}>
            <option value="">{tr('Cualquiera', 'Any')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
          </select>
        </label>
        <label>
          <span>{tr('Orden', 'Sort')}</span>
          <select value={f.sort ?? ''} onChange={(e) => set({ sort: (e.target.value || undefined) as SortOrder | undefined })}>
            {sorts.map((o) => <option key={o.label} value={o.id ?? ''}>{o.label}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={Boolean(f.hideInactive)} onChange={(e) => set({ hideInactive: e.target.checked || undefined })} />
          <span>{tr('Ocultar abandonados y retirados', 'Hide abandoned and taken down')}</span>
        </label>
        {active && <button type="button" className="link" onClick={() => { saveFilters(key, defaults); setF(defaults) }}>{tr('Quitar filtros', 'Clear filters')}</button>}
      </div>

      {error && <ErrorNote error={error} />}
      {total != null && <p className="muted num">{fmtNum(total)} {total === 1 ? tr('resultado', 'result') : tr('resultados', 'results')}</p>}
      {layout === 'table' ? <ProjectTable items={items} /> : (
        <ul className="list">
          {items.map((p) => <ProjectRow key={p.slug} project={p} end={<ExeFlag project={p} />} />)}
        </ul>
      )}
      {total === 0 && (
        <p className="empty">
          {searching
            ? tr('Nada en el catálogo coincide. Prueba con el nombre del juego, del proyecto o de la consola, o quita algún filtro.', 'Nothing in the catalog matches. Try the name of the game, the project or the console, or remove a filter.')
            : tr('Ningún proyecto del catálogo encaja con estos filtros.', 'No catalog project matches these filters.')}
        </p>
      )}
      {total != null && items.length < total && (
        <div><button type="button" className="btn-line" onClick={more}>{tr('Cargar', 'Load')} {Math.min(PAGE, total - items.length)} {tr('más', 'more')}</button></div>
      )}
    </>
  )
}
