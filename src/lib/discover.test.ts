import { describe, expect, it } from 'vitest'
import { discoverProjects, fold, hasFilters } from './discover'
import type { Project } from './types'

const p = (o: Partial<Project>): Project => ({
  slug: 'x', game: 'g', gameTitle: 'Game', games: ['g'], platform: 'n64', name: 'Proj', developers: null, kind: 'decomp_port',
  devStatus: 'stable', abandoned: false, takedown: false, listing: 'library', repo: { host: 'github', owner: 'o', name: 'r' },
  release: null, stars: 0, createdAt: null, ...o,
} as Project)

const platforms = new Map([
  ['n64', { slug: 'n64', name: 'Nintendo 64', short: 'N64', family: 'Nintendo' }],
  ['ps2', { slug: 'ps2', name: 'PlayStation 2', short: 'PS2', family: 'PlayStation' }],
])

const projects = [
  p({ slug: 'soh', gameTitle: 'The Legend of Zelda: Ocarina of Time', name: 'Ship of Harkinian', stars: 50, release: { tag: '9', publishedAt: '2026-01-01T00:00:00Z' } as Project['release'] }),
  p({ slug: 'mm', gameTitle: 'Majora’s Mask', name: 'Zelda64Recomp', kind: 'static_recomp', stars: 99, createdAt: '2024-05-01T00:00:00Z' }),
  p({ slug: 'ps2', gameTitle: 'Pokémon Ruby', platform: 'ps2', name: 'pr', listing: 'in_development', devStatus: 'experimental', abandoned: true }),
]

describe('discoverProjects', () => {
  it('matches every word, without accents, in game, project or console', () => {
    expect(discoverProjects(projects, platforms, { q: 'zelda ocarina' }).items.map((x) => x.slug)).toEqual(['soh'])
    expect(discoverProjects(projects, platforms, { q: 'pokemon' }).total).toBe(1)
    expect(discoverProjects(projects, platforms, { q: 'n64' }).total).toBe(2)
  })
  it('filters by family, status and inactive', () => {
    expect(discoverProjects(projects, platforms, { family: 'PlayStation' }).total).toBe(1)
    expect(discoverProjects(projects, platforms, { status: ['experimental'] }).total).toBe(1)
    expect(discoverProjects(projects, platforms, { hideInactive: true }).total).toBe(2)
  })
  it('sorts', () => {
    expect(discoverProjects(projects, platforms, { sort: 'stars' }).items[0].slug).toBe('mm')
    expect(discoverProjects(projects, platforms, { sort: 'updated' }).items[0].slug).toBe('soh')
    expect(discoverProjects(projects, platforms, { sort: 'newest' }).items[0].slug).toBe('mm')
    expect(discoverProjects(projects, platforms, { q: 'a' }).items.at(-1)?.slug).toBe('ps2')
  })
  it('pages', () => {
    const r = discoverProjects(projects, platforms, { limit: 1, offset: 1 })
    expect(r.total).toBe(3)
    expect(r.items).toHaveLength(1)
  })
})

it('fold and hasFilters', () => {
  expect(fold('Pokémon: Ruby’s')).toBe('pokemon rubys')
  expect(hasFilters({ q: 'x', sort: 'stars' })).toBe(false)
  expect(hasFilters({ platform: 'n64' })).toBe(true)
})
