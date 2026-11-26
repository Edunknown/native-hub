// Capa de acceso a datos de la interfaz.
// Fase 1: sirve el catálogo semilla (catalog/seed.json, generado desde la API de GitHub).
// Fase 2: estas funciones pasarán a llamar a comandos Rust con invoke() y SQLite detrás.

import seed from '../../catalog/seed.json'
import type { Catalog, Game, Platform, Project } from './types'

const catalog = seed as unknown as Catalog

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function getCatalog(): Catalog {
  return catalog
}

export function platformOf(slug: string): Platform | undefined {
  return catalog.platforms.find((p) => p.slug === slug)
}

export function gameOf(slug: string): Game | undefined {
  return catalog.games.find((g) => g.slug === slug)
}

export function projectsForGame(gameSlug: string): Project[] {
  return catalog.projects.filter((p) => p.game === gameSlug)
}

export function libraryProjects(): Project[] {
  return catalog.projects.filter((p) => p.listing === 'library')
}

export function inDevelopment(): Project[] {
  return catalog.projects.filter((p) => p.listing === 'in_development')
}

export function gamesForPlatform(platformSlug: string): Game[] {
  return catalog.games.filter((g) => g.platform === platformSlug)
}

function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export interface SearchResult {
  game: Game
  platform?: Platform
  projects: Project[]
}

export function search(query: string): SearchResult[] {
  const q = norm(query.trim())
  if (!q) return []
  return catalog.games
    .map((game) => {
      const platform = platformOf(game.platform)
      const projects = projectsForGame(game.slug)
      const hay = [game.title, platform?.name, platform?.short, ...projects.flatMap((p) => [p.name, p.developers])]
        .filter(Boolean)
        .map((s) => norm(s as string))
      return { game, platform, projects, hit: hay.some((h) => h.includes(q)) }
    })
    .filter((r) => r.hit)
    .map(({ game, platform, projects }) => ({ game, platform, projects }))
}

/** Abre un enlace en el navegador del sistema (Tauri) o en una pestaña nueva (web). */
export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener')
  }
}
