// Capa de acceso a datos de la interfaz.
// En la app de escritorio llama a los comandos Rust (SQLite). En el navegador (npm run dev)
// usa web-backend.ts, que hace las mismas consultas sobre catalog/catalog.json.

import type { DiscoverFilter, DiscoverResult, GameDetail, Home, Platform, Project, Summary } from './types'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// TAURI_ENV_PLATFORM solo existe al compilar con la CLI de Tauri: así el backend web
// (que incluye el catálogo entero en JavaScript) no entra en el ejecutable.
const loadWebBackend = import.meta.env.TAURI_ENV_PLATFORM ? null : () => import('./web-backend')

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri || !loadWebBackend) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, args)
  }
  const web = await loadWebBackend()
  return web.handle(cmd, args ?? {}) as Promise<T>
}

export const api = {
  summary: () => call<Summary>('catalog_summary'),
  platforms: () => call<Platform[]>('catalog_platforms'),
  platformProjects: (platform: string) => call<Project[]>('catalog_platform_projects', { platform }),
  game: (slug: string) => call<GameDetail>('catalog_game', { slug }),
  search: (q: string, limit = 100) => call<Project[]>('catalog_search', { q, limit }),
  discover: (f: DiscoverFilter) => call<DiscoverResult>('catalog_discover', { ...f }),
  home: () => call<Home>('catalog_home'),
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
