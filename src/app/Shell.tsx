import { useEffect, useRef, type ReactNode } from 'react'
import { useCatalog } from './catalog'
import { useLive } from './live'
import { useDownloads } from './downloads'
import { fmtDateTime, fmtNum } from '../lib/format'
import type { View } from '../lib/types'
import { useNav } from './nav'
import type { Theme } from './theme'
import {
  IconConsoles, IconDiscover, IconDownload, IconHome, IconLibrary, IconSearch, IconSettings, IconTheme, IconUpdates, Mark,
} from './icons'

type Section = Exclude<View['name'], 'game' | 'search'>

const NAV: { name: Section; label: string; Icon: typeof IconHome }[] = [
  { name: 'home', label: 'Inicio', Icon: IconHome },
  { name: 'library', label: 'Biblioteca', Icon: IconLibrary },
  { name: 'discover', label: 'Descubrir', Icon: IconDiscover },
  { name: 'consoles', label: 'Consolas', Icon: IconConsoles },
  { name: 'updates', label: 'Actualiz.', Icon: IconUpdates },
  { name: 'downloads', label: 'Descargas', Icon: IconDownload },
]

function sectionOf(v: View): Section | null {
  if (v.name === 'game' || v.name === 'search') return null
  return v.name
}

export function Shell({ children, theme, onToggleTheme }: { children: ReactNode; theme: Theme; onToggleTheme: () => void }) {
  const { view, go, back } = useNav()
  const active = sectionOf(view)
  const q = view.name === 'search' ? view.query : ''
  const input = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const { summary } = useCatalog()
  const live = useLive()
  const unseen = live.status?.unseenEvents ?? 0
  const dls = useDownloads()
  const running = dls.items.find((d) => d.state === 'running')
  const queued = dls.items.filter((d) => d.state === 'running' || d.state === 'queued').length
  const rp = running ? dls.progress[running.id] : undefined
  const rTotal = rp?.total ?? running?.total
  const rPct = running && rTotal ? Math.round(((rp?.done ?? running.done) / rTotal) * 100) : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); input.current?.select() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (view.name !== 'search') scroller.current?.scrollTo({ top: 0 }) }, [view])

  const onSearch = (value: string) => {
    if (value.trim()) go({ name: 'search', query: value })
    else if (view.name === 'search') back()
  }

  const item = (name: Section, label: string, Icon: typeof IconHome) => (
    <button key={name} type="button" className="nav-item" aria-current={active === name ? 'page' : undefined}
      onClick={() => go({ name } as View)}>
      <Icon />
      {name === 'updates' && unseen > 0 && <span className="count num">{unseen > 99 ? '99+' : unseen}</span>}
      {name === 'downloads' && queued > 0 && <span className="count num">{queued}</span>}
      {label}
    </button>
  )

  return (
    <div className="app">
      <aside className="rail" aria-label="Navegación principal">
        <Mark className="mark" aria-label="NATIVE HUB" />
        <nav className="nav">{NAV.map((n) => item(n.name, n.label, n.Icon))}</nav>
        <div className="spacer" />
        {item('settings', 'Ajustes', IconSettings)}
      </aside>

      <div className="main">
        <header className="top">
          <button type="button" className="wordmark" onClick={() => go({ name: 'home' })}>NATIVE <span>HUB</span></button>
          <label className="search" htmlFor="q">
            <IconSearch />
            <input id="q" ref={input} type="search" placeholder="Buscar juego, proyecto o consola" autoComplete="off"
              value={q} onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { if (view.name === 'search') back(); input.current?.blur() } }} />
            <span className="kbd">Ctrl K</span>
          </label>
          <div className="top-actions">
            <button type="button" onClick={onToggleTheme} aria-label="Cambiar tema">
              <IconTheme />
              <span className="lbl">{theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}</span>
            </button>
          </div>
        </header>

        <div className="phase-note">
          <b>Fase 6 · actualizaciones.</b> Descarga, instala, ejecuta y actualiza conservando tus partidas.
        </div>

        <div className="scroll" ref={scroller}>{children}</div>

        <footer className="status" aria-label="Estado">
          <span>{live.progress ? `${live.progress.job === 'scan' ? 'Buscando proyectos' : 'Comprobando releases'} · ${live.progress.done}/${live.progress.total}` : running ? `Descargando ${running.projectName ?? running.project}${rPct != null ? ` · ${rPct} %` : ''}` : 'Sin descargas en curso'}</span>
          <span className="num">{fmtNum(summary.projectCount)} proyectos · {fmtNum(summary.installableCount)} con ejecutable Windows</span>
          <span className="push">Catálogo: última comprobación <span className="num">{fmtDateTime(summary.generatedAt)}</span></span>
        </footer>
      </div>
    </div>
  )
}
