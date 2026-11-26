// Tipos del dominio. Reflejan catalog/catalog.json y lo que devuelven los comandos Rust
// (crates/core/src/query.rs).

export interface Platform {
  slug: string
  name: string
  short: string | null
  family: string
  projectCount: number
  installableCount: number
}

export interface Game {
  slug: string
  title: string
  platform: string
  year: number | null
}

export type ProjectKind =
  | 'static_recomp' | 'decomp_port' | 'engine_reimpl' | 'source_port'
  | 'native_layer' | 'fan_remake' | 'decompilation' | 'other'
export type Listing = 'library' | 'in_development' | 'hidden'
export type DevStatus = 'complete' | 'stable' | 'playable' | 'beta' | 'experimental' | 'unknown'

export interface Asset {
  name: string
  url: string
  size: number | null
  sizeApprox?: boolean
  sha256: string | null
}

export interface Release {
  tag: string
  url: string
  publishedAt: string | null
  prerelease: boolean | null
  assets: Asset[]
}

export interface Requirements {
  originalFiles: string | null
  extractedFiles: boolean | null
  keys: boolean | null
  manualBuild: boolean | null
}

export interface Project {
  slug: string
  game: string
  gameTitle: string
  games: string[]
  platform: string
  name: string
  developers: string | null
  kind: ProjectKind
  devStatus: DevStatus
  abandoned: boolean
  takedown: boolean
  forkOf: string | null
  toolchain: string | null
  repo: { host: string; owner: string | null; name: string | null }
  repoUrl: string
  repoMovedFrom: string | null
  homepage: string | null
  repoExists: boolean | null
  release: Release | null
  windowsAsset: Asset | null
  hasWindowsExecutable: boolean | null
  listing: Listing
  summary: string | null
  requirementsText: string | null
  requirements: Requirements | null
  tags: string[]
  stars: number | null
  createdAt: string | null
  pushedAt: string | null
  license: string | null
  source: string
  checkedAt: string | null
}

export interface Source {
  name: string
  url: string | null
  data?: string
  license: string | null
  commit?: string
}

export interface Summary {
  generatedAt: string | null
  sources: Source[] | null
  projectCount: number
  installableCount: number
  gameCount: number
  families: string[]
  schemaVersion: number | null
}

export interface GameDetail {
  game: Game
  projects: Project[]
}

export interface Home {
  featured: GameDetail | null
  updated: Project[]
  newest: Project[]
}

export interface DiscoverFilter {
  listing?: Listing
  kind?: ProjectKind
  platform?: string
  offset?: number
  limit?: number
}

export interface DiscoverResult {
  total: number
  items: Project[]
}

export type View =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'discover' }
  | { name: 'consoles'; platform?: string }
  | { name: 'updates' }
  | { name: 'downloads' }
  | { name: 'settings' }
  | { name: 'game'; slug: string; project?: string }
  | { name: 'search'; query: string }
