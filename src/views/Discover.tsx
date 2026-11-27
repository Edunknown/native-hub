import { useState } from 'react'
import { useCatalog } from '../app/catalog'
import { Review } from './Review'
import { CatalogBrowser } from '../components/CatalogBrowser'
import { fmtNum } from '../lib/format'
import { tr } from '../lib/i18n'

export function Discover() {
  const { summary } = useCatalog()
  const [mode, setMode] = useState<'catalog' | 'review'>('catalog')

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
      <CatalogBrowser layout="table" />

      <p className="devnote">{tr('Lo que encuentra el escáner va a la cola de revisión y no entra en el catálogo sin tu aprobación.', 'Whatever the scanner finds goes to the review queue and does not enter the catalog without your approval.')}</p>
      </>}
    </main>
  )
}
