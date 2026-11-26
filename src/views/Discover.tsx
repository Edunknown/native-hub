import { useState } from 'react'
import { useNav } from '../app/nav'
import { gameOf, getCatalog, platformOf } from '../lib/api'
import { fmtDate, kindLabel } from '../lib/format'
import type { ProjectKind } from '../lib/types'

type Filter = 'all' | ProjectKind | 'in_development'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Instalables' },
  { id: 'static_recomp', label: 'Recompilaciones estáticas' },
  { id: 'decomp_port', label: 'Ports de decompilación' },
  { id: 'engine_reimpl', label: 'Reimplementaciones' },
  { id: 'in_development', label: 'En desarrollo' },
]

export function Discover() {
  const { go } = useNav()
  const [filter, setFilter] = useState<Filter>('all')
  const { projects } = getCatalog()

  const rows = projects
    .filter((p) => (filter === 'in_development' ? p.listing === 'in_development' : p.listing === 'library'))
    .filter((p) => filter === 'all' || filter === 'in_development' || p.kind === filter)
    .sort((a, b) => (gameOf(a.game)?.title ?? '').localeCompare(gameOf(b.game)?.title ?? ''))

  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Descubrir</div>
        <h1 className="page-title">Catálogo</h1>
        <p className="page-lede">Proyectos revisados uno a uno. Un proyecto solo aparece como instalable si su última release oficial publica un ejecutable para Windows.</p>
      </div>

      <div className="filters" role="group" aria-label="Filtrar">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      <table className="table">
        <thead>
          <tr><th>Juego</th><th>Proyecto</th><th>Consola</th><th>Tipo</th><th>Última release</th><th className="r">Ejecutable Windows</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const g = gameOf(p.game)
            return (
              <tr key={p.slug} className="click" onClick={() => go({ name: 'game', slug: p.game, project: p.slug })}>
                <td>{g?.title}</td>
                <td>{p.name} <span className="muted">· {p.developers}</span></td>
                <td className="muted">{g && platformOf(g.platform)?.name}</td>
                <td className="muted">{kindLabel[p.kind]}</td>
                <td>{p.release ? <><span className="mono">{p.release.tag}</span> <span className="muted num">· {fmtDate(p.release.publishedAt)}</span></> : <span className="tbd">sin release</span>}</td>
                <td className="r">{p.hasWindowsExecutable ? <span className="yes">Sí</span> : <span className="muted">No</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">Ningún proyecto del catálogo encaja con este filtro todavía.</p>}

      <p className="devnote">El descubrimiento automático (GitHub, GitLab y otras fuentes) llega en la fase 3. Lo que detecte irá a una cola de revisión y no entrará en el catálogo sin aprobación.</p>
    </main>
  )
}
