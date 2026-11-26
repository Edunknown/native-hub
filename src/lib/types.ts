// Tipos del dominio. Reflejan catalog/seed.json y, en la fase 2, las filas de SQLite.

export type PlatformFamily = 'Nintendo' | 'PlayStation' | 'Xbox' | 'Sega' | 'Otras'

export interface Platform {
  slug: string
  name: string
  short?: string
  family: PlatformFamily
}

export interface Game {
  slug: string
  title: string
  platform: string
}

export type ProjectKind = 'decomp_port' | 'static_recomp' | 'engine_reimpl' | 'source_port' | 'other'
export type Listing = 'library' | 'in_development' | 'hidden'

export interface Asset {
  name: string
  size: number
  url: string
  sha256: string | null
}

export interface Release {
  tag: string
  name: string | null
  publishedAt: string | null
  prerelease: boolean
  url: string
  assets: Asset[]
}

export interface Requirements {
  originalFiles: string | null
  extractedFiles: boolean
  keys: boolean
  manualBuild: boolean
}

export interface Project {
  slug: string
  game: string
  name: string
  developers: string
  kind: ProjectKind
  repo: { host: 'github' | 'gitlab' | 'other'; owner: string; name: string }
  repoUrl: string | null
  repoExists: boolean
  archived: boolean | null
  license: string | null
  pushedAt: string | null
  createdAt?: string | null
  release: Release | null
  windowsAsset: Asset | null
  hasWindowsExecutable: boolean
  listing: Listing
  requirements: Requirements
  checkedAt: string
}

export interface Catalog {
  generatedAt: string
  platforms: Platform[]
  games: Game[]
  projects: Project[]
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
