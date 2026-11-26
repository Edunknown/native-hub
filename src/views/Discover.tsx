import { useEffect, useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useLive } from '../app/live'
import { Review } from './Review'
import { ProjectTable } from '../components/ProjectTable'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
import type { DiscoverFilter, Listing, Project, ProjectKind } from '../lib/types'

const LISTINGS: { id: Listing | undefined; label: string }[] = [
  { id: 'library', label: 'Con ejecutable Windows' },
  { id: 'in_development', label: 'En desarrollo o sin ejecutable' },
  { id: undefined, label: 'Todos' },
]

const KINDS: { id: ProjectKind | undefined; label: string }[] = [
  { id: undefined, label: 'Todos los tipos' },
  { id: 'static_recomp', label: 'Recompilaciones' },
  { id: 'decomp_port', label: 'Ports de decompilación' },
  { id: 'native_layer', label: 'Capas nativas' },
  { id: 'engine_reimpl', label: 'Reimplementaciones' },
  { id: 'source_port', label: 'Source ports' },
  { id: 'fan_remake', label: 'Remakes de fans' },
  { id: 'decompilation', label: 'Decompilaciones' },
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
        <div className="eyebrow">Descubrir</div>
        <h1 className="page-title">Catálogo</h1>
        <p className="page-lede">
          {fmtNum(summary.projectCount)} proyectos de {fmtNum(summary.gameCount)} juegos. Un proyecto solo cuenta como instalable si su última release oficial publica un ejecutable para Windows que se ha podido identificar.
        </p>
      </div>

      <div className="filters" role="group" aria-label="Sección">
        <button type="button" aria-pressed={mode === 'catalog'} onClick={() => setMode('catalog')}>Catálogo</button>
        <button type="button" aria-pressed={mode === 'review'} onClick={() => setMode('review')}>Cola de revisión</button>
      </div>

      {mode === 'review' ? <Review /> : <>
      <div className="filters" role="group" aria-label="Disponibilidad">
        {LISTINGS.map((f) => (
          <button key={f.label} type="button" aria-pressed={listing === f.id} onClick={() => setListing(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="filters small" role="group" aria-label="Tipo">
        {KINDS.map((f) => (
          <button key={f.label} type="button" aria-pressed={kind === f.id} onClick={() => setKind(f.id)}>{f.label}</button>
        ))}
      </div>

      {total != null && <p className="muted num">{fmtNum(total)} resultados</p>}
      <ProjectTable items={items} />
      {total === 0 && <p className="empty">Ningún proyecto del catálogo encaja con estos filtros.</p>}
      {total != null && items.length < total && (
        <div><button type="button" className="btn-line" onClick={more}>Cargar {Math.min(PAGE, total - items.length)} más</button></div>
      )}

      <p className="devnote">Lo que encuentra el escáner va a la cola de revisión y no entra en el catálogo sin tu aprobación.</p>
      </>}
    </main>
  )
}
