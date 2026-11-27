// Backend de desarrollo para el navegador: mismas consultas que crates/core/src/query.rs,
// sobre catalog/catalog.json. Solo se carga fuera de Tauri (npm run dev).

import catalogJson from '../../catalog/catalog.json'
import type { Game, Platform, Project } from './types'
import { tr } from './i18n'

interface CatalogFile {
  generatedAt: string
  sources: unknown
  families: string[]
  platforms: Omit<Platform, 'projectCount' | 'installableCount'>[]
  games: Game[]
  projects: Project[]
}

const cat = catalogJson as unknown as CatalogFile
const FEATURED = 'the-legend-of-zelda-majoras-mask'

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'´`]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const gameMap = new Map(cat.games.map((g) => [g.slug, g]))
const platMap = new Map(cat.platforms.map((p) => [p.slug, p]))
const byLibThenStars = (a: Project, b: Project) =>
  Number(b.listing === 'library') - Number(a.listing === 'library') ||
  Number(a.takedown) - Number(b.takedown) ||
  (b.stars ?? 0) - (a.stars ?? 0) ||
  a.name.localeCompare(b.name)

function game(slug: string) {
  const g = gameMap.get(slug)
  if (!g) throw new Error(`no encontrado: juego ${slug}`)
  return { game: g, projects: cat.projects.filter((p) => p.games.includes(slug)).sort(byLibThenStars) }
}

const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  catalog_summary: () => ({
    generatedAt: cat.generatedAt,
    sources: cat.sources,
    projectCount: cat.projects.length,
    installableCount: cat.projects.filter((p) => p.listing === 'library').length,
    gameCount: cat.games.length,
    families: cat.families,
    schemaVersion: null,
  }),
  catalog_platforms: () =>
    cat.platforms.map((p) => {
      const ps = cat.projects.filter((x) => x.platform === p.slug)
      return { ...p, projectCount: ps.length, installableCount: ps.filter((x) => x.listing === 'library').length }
    }),
  catalog_platform_projects: ({ platform }) => cat.projects.filter((p) => p.platform === platform).sort(byLibThenStars),
  catalog_game: ({ slug }) => game(slug as string),
  catalog_search: ({ q, limit }) => {
    const terms = fold(String(q)).split(' ').filter(Boolean)
    if (!terms.length) return []
    return cat.projects
      .filter((p) => {
        const pl = platMap.get(p.platform)
        const hay = fold(`${p.gameTitle} ${p.name} ${p.developers ?? ''} ${p.repo.name ?? ''} ${pl?.name ?? ''} ${pl?.short ?? ''}`)
        return terms.every((t) => hay.includes(t))
      })
      .sort((a, b) => Number(b.listing === 'library') - Number(a.listing === 'library') || (b.stars ?? 0) - (a.stars ?? 0))
      .slice(0, Number(limit ?? 100))
  },
  catalog_discover: ({ listing, kind, platform, offset = 0, limit = 100 }) => {
    const all = cat.projects
      .filter((p) => (!listing || p.listing === listing) && (!kind || p.kind === kind) && (!platform || p.platform === platform))
      .sort((a, b) => a.gameTitle.localeCompare(b.gameTitle) || a.name.localeCompare(b.name))
    return { total: all.length, items: all.slice(Number(offset), Number(offset) + Number(limit)) }
  },
  catalog_home: () => {
    const updated = cat.projects
      .filter((p) => p.listing === 'library' && p.release?.publishedAt)
      .sort((a, b) => b.release!.publishedAt!.localeCompare(a.release!.publishedAt!))
      .slice(0, 6)
    const newest = cat.projects
      .filter((p) => p.createdAt && !p.takedown)
      .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!))
      .slice(0, 6)
    return { featured: gameMap.has(FEATURED) ? game(FEATURED) : null, updated, newest }
  },
}

const desktopOnly = () => { throw new Error(tr('Disponible solo en la app de escritorio (npm run tauri dev).', 'Only available in the desktop app (npm run tauri dev).')) }
Object.assign(handlers, {
  catalog_games_lookup: ({ q }: Record<string, unknown>) => {
    const t = fold(String(q))
    return cat.games.filter((g) => fold(g.title).includes(t)).slice(0, 20).map(({ slug, title, platform }) => ({ slug, title, platform }))
  },
  releases_status: () => ({ projectsWithRepo: 0, checkedLast24h: 0, neverChecked: 0, lastLiveCheck: null, rateLimit: null, unseenEvents: 0, busy: false, tokenConfigured: false, unsupported: true }),
  update_events: () => [],
  mark_events_seen: () => 0,
  candidates: () => ({ items: [], counts: { new: 0, approved: 0, rejected: 0 } }),
  refresh_project: desktopOnly, refresh_stale: desktopOnly, cancel_job: desktopOnly, scan_repositories: desktopOnly,
  downloads_list: () => [],
  installations_list: () => [],
  update_plan: desktopOnly, update_apply: desktopOnly, update_rollback: desktopOnly, update_discard: desktopOnly,
  install_root_get: () => ({ path: tr('Documentos', 'Documents') + '\\NATIVE HUB', default: true }),
  set_language: () => null,
  install_plan: desktopOnly, install_project: desktopOnly, install_root_set: desktopOnly, installation_set_exe: desktopOnly, installation_launch: desktopOnly,
  installation_open_folder: desktopOnly, installation_run_installer: desktopOnly, installation_uninstall: desktopOnly, user_file_check: desktopOnly, user_files_list: () => [],
  download_start: desktopOnly, project_releases: desktopOnly, download_asset: desktopOnly, download_pause: desktopOnly, download_resume: desktopOnly, download_cancel: desktopOnly, download_remove: desktopOnly, download_reveal: desktopOnly,
  approve_candidate: desktopOnly, sync_recompendium: desktopOnly, approve_suggested: desktopOnly, approve_all_suggested: desktopOnly, automation_get: desktopOnly, automation_set: desktopOnly, reject_candidate: desktopOnly, set_github_token: desktopOnly, clear_github_token: desktopOnly,
})

export async function handle(cmd: string, args: Record<string, unknown>) {
  const h = handlers[cmd]
  if (!h) throw new Error(`comando desconocido: ${cmd}`)
  return h(args)
}
