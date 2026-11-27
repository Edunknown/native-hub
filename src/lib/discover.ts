// Catalog filtering for the browser development backend. Mirrors query::discover in
// crates/core/src/query.rs so `npm run dev` behaves like the desktop app.

import type { DiscoverFilter, DiscoverResult, Platform, Project } from './types'

export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'´`]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

type Plat = Pick<Platform, 'slug' | 'name' | 'short' | 'family'>

const cmpTitle = (a: Project, b: Project) => a.gameTitle.localeCompare(b.gameTitle) || a.name.localeCompare(b.name)
const desc = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? b.localeCompare(a) : a ? -1 : b ? 1 : 0

export function discoverProjects(projects: Project[], platforms: Map<string, Plat>, f: DiscoverFilter): DiscoverResult {
  const terms = fold(f.q ?? '').split(' ').filter(Boolean)
  const status = new Set(f.status ?? [])
  const all = projects.filter((p) => {
    const pl = platforms.get(p.platform)
    if (f.listing && p.listing !== f.listing) return false
    if (f.kind && p.kind !== f.kind) return false
    if (f.platform && p.platform !== f.platform) return false
    if (f.family && pl?.family !== f.family) return false
    if (status.size && !status.has(p.devStatus ?? 'unknown')) return false
    if (f.hideInactive && (p.abandoned || p.takedown)) return false
    if (terms.length) {
      const hay = fold(`${p.gameTitle} ${p.name} ${p.developers ?? ''} ${p.repo.name ?? ''} ${pl?.name ?? ''} ${pl?.short ?? ''}`)
      if (!terms.every((t) => hay.includes(t))) return false
    }
    return true
  })
  const sort = f.sort ?? (terms.length ? 'relevance' : 'title')
  all.sort((a, b) => {
    switch (sort) {
      case 'updated': return desc(a.release?.publishedAt, b.release?.publishedAt) || cmpTitle(a, b)
      case 'newest': return desc(a.createdAt, b.createdAt) || cmpTitle(a, b)
      case 'stars': return (b.stars ?? 0) - (a.stars ?? 0) || cmpTitle(a, b)
      case 'relevance':
        return Number(b.listing === 'library') - Number(a.listing === 'library') || Number(a.takedown) - Number(b.takedown) || (b.stars ?? 0) - (a.stars ?? 0) || cmpTitle(a, b)
      default: return cmpTitle(a, b)
    }
  })
  const offset = Math.max(0, f.offset ?? 0)
  const limit = f.limit && f.limit > 0 ? Math.min(f.limit, 500) : 100
  return { total: all.length, items: all.slice(offset, offset + limit) }
}

/** True if any filter other than text, paging and sort is set. */
export function hasFilters(f: DiscoverFilter) {
  return Boolean(f.listing || f.kind || f.platform || f.family || f.status?.length || f.hideInactive)
}
