#!/usr/bin/env node
// Copies catalog/adapters/*.json into catalog/catalog.json without rebuilding the rest
// (no network). Run it after editing an adapter; build-catalog.mjs does the same when it
// regenerates everything. `node scripts/check-catalog.mjs` fails if they drift apart.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const file = join(root, 'catalog/catalog.json')
const catalog = JSON.parse(readFileSync(file, 'utf8'))
const byRepo = new Map(catalog.projects.filter((p) => p.repo?.owner).map((p) => [`${p.repo.owner}/${p.repo.name}`.toLowerCase(), p]))
let n = 0
for (const f of readdirSync(join(root, 'catalog/adapters')).filter((x) => x.endsWith('.json'))) {
  const a = JSON.parse(readFileSync(join(root, 'catalog/adapters', f), 'utf8'))
  const p = byRepo.get(a.repo.toLowerCase())
  if (!p) { console.error(`${f}: ${a.repo} is not in the catalog`); process.exitCode = 1; continue }
  p.adapter = a.adapter
  n++
}
writeFileSync(file, JSON.stringify(catalog) + '\n')
console.log(`${n} adapters applied to catalog/catalog.json`)
