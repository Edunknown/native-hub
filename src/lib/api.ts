// Capa de acceso a datos de la interfaz.
// En la app de escritorio llama a los comandos Rust (SQLite). En el navegador (npm run dev)
// usa web-backend.ts, que hace las mismas consultas de catálogo sobre catalog/catalog.json;
// las funciones en vivo (releases, escáner, token) solo existen en la app.

import type {
  Approval, CandidateList, DownloadItem, DownloadProgress, DiscoverFilter, DiscoverResult, GameDetail, Home, JobFinished, JobProgress,
  Platform, Project, RefreshResult, ReleasesStatus, Summary, UpdateEvent,
} from './types'

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
  gamesLookup: (q: string) => call<{ slug: string; title: string; platform: string }[]>('catalog_games_lookup', { q }),

  releasesStatus: () => call<ReleasesStatus>('releases_status'),
  refreshProject: (slug: string) => call<RefreshResult>('refresh_project', { slug }),
  refreshStale: (maxAgeHours = 24, limit = 200) => call<boolean>('refresh_stale', { maxAgeHours, limit }),
  cancelJob: () => call<void>('cancel_job'),
  updateEvents: (limit = 100) => call<UpdateEvent[]>('update_events', { limit }),
  markEventsSeen: () => call<number>('mark_events_seen'),

  scan: () => call<boolean>('scan_repositories'),
  candidates: (status: 'new' | 'approved' | 'rejected' = 'new') => call<CandidateList>('candidates', { status }),
  approve: (approval: Approval) => call<string>('approve_candidate', { approval }),
  reject: (id: number) => call<void>('reject_candidate', { id }),

  downloadStart: (slug: string) => call<number>('download_start', { slug }),
  downloads: () => call<DownloadItem[]>('downloads_list'),
  downloadPause: (id: number) => call<void>('download_pause', { id }),
  downloadResume: (id: number) => call<void>('download_resume', { id }),
  downloadCancel: (id: number) => call<void>('download_cancel', { id }),
  downloadRemove: (id: number, deleteFile: boolean) => call<void>('download_remove', { id, deleteFile }),
  downloadReveal: (id: number) => call<void>('download_reveal', { id }),

  setGithubToken: (value: string) => call<{ ok: boolean }>('set_github_token', { value }),
  clearGithubToken: () => call<void>('clear_github_token'),
}

/** Escucha el progreso y el final de los trabajos en segundo plano. Devuelve la función para dejar de escuchar. */
export async function onJobs(progress: (p: JobProgress) => void, finished: (f: JobFinished) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const a = await listen<JobProgress>('job-progress', (e) => progress(e.payload))
  const b = await listen<JobFinished>('job-finished', (e) => finished(e.payload))
  return () => { a(); b() }
}

/** Escucha el progreso de las descargas. */
export async function onDownloads(progress: (p: DownloadProgress) => void, finished: (f: { id: number; state: string }) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const a = await listen<DownloadProgress>('download-progress', (e) => progress(e.payload))
  const b = await listen<{ id: number; state: string }>('download-finished', (e) => finished(e.payload))
  return () => { a(); b() }
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
