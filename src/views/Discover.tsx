import { useEffect, useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useLive } from '../app/live'
import { Review } from './Review'
import { ProjectTable } from '../components/ProjectTable'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
import type { DiscoverFilter, Listing, Project, ProjectKind } from '../lib/types'
import { tr } from '../lib/i18n'

const LISTINGS: { id: Listing | undefined; label: string }[] = [
  { id: 'library', label: tr('Con ejecutable Windows', 'With a Windows executable') },
  { id: 'in_development', label: tr('En desarrollo o sin ejecutable', 'In development or no executable') },
  { id: undefined, label: tr('Todos', 'All') },
]

const KINDS: { id: ProjectKind | undefined; label: string }[] = [
  { id: undefined, label: tr('Todos los tipos', 'All types') },
  { id: 'static_recomp', label: tr('Recompilaciones', 'Recompilations') },
  { id: 'decomp_port', label: tr('Ports de decompilación', 'Decompilation ports') },
  { id: 'native_layer', label: tr('Capas nativas', 'Native layers') },
  { id: 'engine_reimpl', label: tr('Reimplementaciones', 'Reimplementations') },
  { id: 'source_port', label: 'Source ports' },
  { id: 'fan_remake', label: tr('Remakes de fans', 'Fan remakes') },
  { id: 'decompilation', label: tr('Decompilaciones', 'Decompilations') },
]

const PAGE = 100

export function Discover() {
  const { summary } = useCatalog()
  const live = useLive()
  const [mode, setMode] = useState<'catalog' | 'review'>('catalog')
  const [listing, setListing] = useState<Listing | undefined>('library')
  const [kind, setKind] = useState<ProjectKind | undefined>(undefined)
  const [items, setItems] = useState<Project[]>([])
  const [total, setTotal] = useState<number | null>(null)

  const load = (offset: number) => {
    const f: DiscoverFilter = { listing, kind, offset, limit: PAGE }
    return api.discover(f)
  }

  useEffect(() => {
    let alive = true
    load(0).then((r) => { if (alive) { setItems(r.items); setTotal(r.total) } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing, kind, live.version])

  const more = () => load(items.length).then((r) => setItems((prev) => [...prev, ...r.items]))

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">{tr('Descubrir', 'Discover')}</div>
        <h1 className="page-title">{tr('Catálogo', 'Catalog')}</h1>
        <p className="page-lede">
          {fmtNum(summary.projectCount)} {tr('proyectos de', 'projects for')} {fmtNum(summary.gameCount)} {tr('juegos. Un proyecto solo cuenta como instalable si su última release oficial publica un ejecutable para Windows que se ha podido identificar.', 'games. A project only counts as installable if its latest official release publishes a Windows executable that could be identified.')}
        </p>
      </div>

      <div className="filters" role="group" aria-label={tr('Sección', 'Section')}>
        <button type="button" aria-pressed={mode === 'catalog'} onClick={() => setMode('catalog')}>{tr('Catálogo', 'Catalog')}</button>
        <button type="button" aria-pressed={mode === 'review'} onClick={() => setMode('review')}>{tr('Cola de revisión', 'Review queue')}</button>
      </div>

      {mode === 'review' ? <Review /> : <>
      <div className="filters" role="group" aria-label={tr('Disponibilidad', 'Availability')}>
        {LISTINGS.map((f) => (
          <button key={f.label} type="button" aria-pressed={listing === f.id} onClick={() => setListing(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="filters small" role="group" aria-label={tr('Tipo', 'Type')}>
        {KINDS.map((f) => (
          <button key={f.label} type="button" aria-pressed={kind === f.id} onClick={() => setKind(f.id)}>{f.label}</button>
        ))}
      </div>

      {total != null && <p className="muted num">{fmtNum(total)} {tr('resultados', 'results')}</p>}
      <ProjectTable items={items} />
      {total === 0 && <p className="empty">{tr('Ningún proyecto del catálogo encaja con estos filtros.', 'No catalog project matches these filters.')}</p>}
      {total != null && items.length < total && (
        <div><button type="button" className="btn-line" onClick={more}>{tr('Cargar', 'Load')} {Math.min(PAGE, total - items.length)} {tr('más', 'more')}</button></div>
      )}

      <p className="devnote">{tr('Lo que encuentra el escáner va a la cola de revisión y no entra en el catálogo sin tu aprobación.', 'Whatever the scanner finds goes to the review queue and does not enter the catalog without your approval.')}</p>
      </>}
    </main>
  )
}
