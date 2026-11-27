#!/usr/bin/env node
// Validates catalog/catalog.json and catalog/adapters/*.json (run in CI).
// Exits with code 1 and lists every problem found.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const problems = []
const fail = (msg) => problems.push(msg)

const catalog = JSON.parse(readFileSync(join(root, 'catalog/catalog.json'), 'utf8'))

const unique = (items, key, what) => {
  const seen = new Set()
  for (const it of items) {
    const k = typeof key === 'function' ? key(it) : it[key]
    if (seen.has(k)) fail(`${what}: duplicate ${k}`)
    seen.add(k)
  }
  return seen
}

const platforms = unique(catalog.platforms, 'slug', 'platform')
const games = unique(catalog.games, 'slug', 'game')
unique(catalog.projects, 'slug', 'project')
unique(
  catalog.projects.filter((p) => p.repo),
  (p) => `${p.repo.host}/${p.repo.owner}/${p.repo.name}`.toLowerCase(),
  'repository',
)

for (const g of catalog.games) {
  if (!platforms.has(g.platform)) fail(`game ${g.slug}: unknown platform ${g.platform}`)
}

const LISTINGS = new Set(['library', 'in_development', 'hidden'])
for (const p of catalog.projects) {
  const where = `project ${p.slug}`
  if (!games.has(p.game)) fail(`${where}: unknown game ${p.game}`)
  if (!platforms.has(p.platform)) fail(`${where}: unknown platform ${p.platform}`)
  if (!LISTINGS.has(p.listing)) fail(`${where}: unknown listing ${p.listing}`)
  // Never installable without a real release that publishes a Windows executable.
  if (p.listing === 'library') {
    if (!p.release) fail(`${where}: in the library without a release`)
    if (p.takedown) fail(`${where}: in the library after a takedown`)
  }
  if (p.windowsAsset) {
    const asset = p.release?.assets?.find((a) => a.name === p.windowsAsset.name || a.url === p.windowsAsset.url)
    if (!asset) fail(`${where}: windowsAsset is not one of the release assets`)
    const url = p.windowsAsset.url ?? asset?.url
    if (url && !/^https:\/\//.test(url)) fail(`${where}: windowsAsset URL is not HTTPS`)
  }
}

// Adapters
const repos = new Map(
  catalog.projects.filter((p) => p.repo).map((p) => [`${p.repo.owner}/${p.repo.name}`.toLowerCase(), p]),
)
const adapterDir = join(root, 'catalog/adapters')
const ids = new Set()
const TEST_STATUS = new Set(['untested', 'install', 'played', 'issues'])
for (const file of readdirSync(adapterDir).filter((f) => f.endsWith('.json'))) {
  const where = `adapter ${file}`
  let doc
  try {
    doc = JSON.parse(readFileSync(join(adapterDir, file), 'utf8'))
  } catch (e) {
    fail(`${where}: invalid JSON (${e.message})`)
    continue
  }
  const a = doc.adapter
  if (!doc.repo || !a) {
    fail(`${where}: needs "repo" and "adapter"`)
    continue
  }
  if (!repos.has(doc.repo.toLowerCase())) fail(`${where}: repo ${doc.repo} is not in the catalog`)
  if (ids.has(a.id)) fail(`${where}: duplicate id ${a.id}`)
  ids.add(a.id)
  if (!Number.isInteger(a.version) || a.version < 1) fail(`${where}: version must be a positive integer`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.reviewedAt ?? '')) fail(`${where}: reviewedAt must be YYYY-MM-DD`)
  if (a.firstRun && !a.firstRunEn) fail(`${where}: firstRun without firstRunEn`)
  if ((a.notes?.length ?? 0) !== (a.notesEn?.length ?? 0)) fail(`${where}: notes and notesEn differ in length`)
  if (a.exeHint) {
    try {
      new RegExp(a.exeHint)
    } catch {
      // exeHint may be a plain file name; only reject obviously broken patterns
    }
  }
  for (const f of a.userFiles ?? []) {
    const w = `${where} userFiles.${f.key}`
    if (!f.key || !f.label || !f.labelEn) fail(`${w}: needs key, label and labelEn`)
    if (f.help && !f.helpEn) fail(`${w}: help without helpEn`)
    for (const m of f.magic ?? []) if (!/^([0-9a-fA-F]{2})+$/.test(m)) fail(`${w}: magic ${m} is not hex`)
    for (const h of f.sha1 ?? []) if (!/^[0-9a-fA-F]{40}$/.test(h)) fail(`${w}: sha1 ${h} is not valid`)
    if (f.minSize && f.maxSize && f.minSize > f.maxSize) fail(`${w}: minSize > maxSize`)
  }
  if (a.tested) {
    for (const t of Array.isArray(a.tested) ? a.tested : [a.tested]) {
      if (!TEST_STATUS.has(t.status)) fail(`${where}: tested.status must be one of ${[...TEST_STATUS].join(', ')}`)
      if (t.status !== 'untested' && !/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? '')) fail(`${where}: tested.date must be YYYY-MM-DD`)
    }
  }
}

if (problems.length) {
  console.error(`Catalog check failed (${problems.length}):`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(
  `Catalog OK: ${catalog.platforms.length} platforms, ${catalog.games.length} games, ${catalog.projects.length} projects, ${ids.size} adapters`,
)
