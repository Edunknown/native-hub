// Capa de acceso a datos de la interfaz.
// En la app de escritorio llama a los comandos Rust (SQLite). En el navegador (npm run dev)
// usa web-backend.ts, que hace las mismas consultas de catálogo sobre catalog/catalog.json;
// las funciones en vivo (releases, escáner, token) solo existen en la app.

import type {
  Approval, CandidateList, DownloadItem, DownloadProgress, InstallPlan, Installation, UserFileCheck, ProjectReleases, UpdatePlan, DiscoverFilter, DiscoverResult, GameDetail, Home, JobFinished, JobProgress,
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
  projectReleases: (slug: string) => call<ProjectReleases>('project_releases', { slug }),
  downloadAsset: (slug: string, url: string) => call<number>('download_asset', { slug, url }),
  downloads: () => call<DownloadItem[]>('downloads_list'),
  downloadPause: (id: number) => call<void>('download_pause', { id }),
  downloadResume: (id: number) => call<void>('download_resume', { id }),
  downloadCancel: (id: number) => call<void>('download_cancel', { id }),
  downloadRemove: (id: number, deleteFile: boolean) => call<void>('download_remove', { id, deleteFile }),
  downloadReveal: (id: number) => call<void>('download_reveal', { id }),

  installRoot: () => call<{ path: string; default: boolean }>('install_root_get'),
  setInstallRoot: (path: string | null) => call<{ path: string; default: boolean }>('install_root_set', { path }),
  installPlan: (slug: string) => call<InstallPlan>('install_plan', { slug }),
  install: (slug: string) => call<Installation>('install_project', { slug }),
  installations: () => call<Installation[]>('installations_list'),
  setExecutable: (id: number, path: string) => call<Installation>('installation_set_exe', { id, path }),
  launch: (id: number) => call<void>('installation_launch', { id }),
  openInstallFolder: (id: number) => call<void>('installation_open_folder', { id }),
  runInstaller: (id: number) => call<void>('installation_run_installer', { id }),
  uninstall: (id: number, deleteFiles: boolean) => call<void>('installation_uninstall', { id, deleteFiles }),
  checkUserFile: (slug: string, key: string, path: string, installation?: number) => call<UserFileCheck>('user_file_check', { slug, key, path, installation }),

  updatePlan: (id: number) => call<UpdatePlan>('update_plan', { id }),
  updateApply: (id: number) => call<{ fromTag: string; toTag: string; replaced: number; added: number; preserved: number }>('update_apply', { id }),
  updateRollback: (id: number) => call<Installation>('update_rollback', { id }),
  updateDiscard: (id: number) => call<void>('update_discard', { id }),

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

/** Selector de archivos o carpetas del sistema (solo en la app de escritorio). */
export async function pickPath(opts: { directory?: boolean; title?: string; extensions?: string[]; defaultPath?: string }): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const r = await open({
    directory: opts.directory ?? false,
    multiple: false,
    title: opts.title,
    defaultPath: opts.defaultPath,
    filters: opts.extensions ? [{ name: opts.extensions.join(', '), extensions: opts.extensions }] : undefined,
  })
  return typeof r === 'string' ? r : null
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
