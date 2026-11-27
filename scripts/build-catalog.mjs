// Construye catalog/catalog.json: une las fuentes (manual + Recompendium) y comprueba
// en GitHub la última release de cada proyecto y si publica un ejecutable para Windows.
//
// Nada se inventa: lo que no se puede comprobar queda en null y la interfaz lo muestra
// como «por verificar». Un proyecto solo es instalable si su última release tiene un
// archivo Windows reconocible.
//
// Uso:
//   node scripts/build-catalog.mjs            comprueba lo no comprobado en las últimas 12 h
//   node scripts/build-catalog.mjs --force    vuelve a comprobarlo todo
//   node scripts/build-catalog.mjs --offline  solo une las fuentes, sin red
//
// La comprobación usa las páginas públicas de releases de github.com (no la API REST,
// cuyo límite sin token es de 60 consultas por hora). En la fase 3 la app hará esto
// con la API oficial, ETag y token opcional.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const args = new Set(process.argv.slice(2))
const FORCE = args.has('--force')
const OFFLINE = args.has('--offline')
const MAX_AGE_MS = 12 * 3600 * 1000
const CONCURRENCY = 6

const readJson = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : fallback)

const manual = await readJson(join(ROOT, 'catalog/sources/manual.json'))
const recomp = await readJson(join(ROOT, 'catalog/sources/recompendium.json'), { source: null, games: [], projects: [] })
const cachePath = join(ROOT, '.cache/releases.json')
const cache = await readJson(cachePath, {})

// ---------- 1. Unir fuentes ----------
const platforms = manual.platforms
const platformSlugs = new Set(platforms.map((p) => p.slug))
const games = new Map()
for (const g of recomp.games) games.set(g.slug, { ...g, source: 'recompendium' })
for (const g of manual.games) games.set(g.slug, { platforms: [g.platform], igdb: null, ...games.get(g.slug), ...g, source: 'manual' })

const key = (repo) => repo?.toLowerCase() ?? null
const projects = new Map()
for (const p of recomp.projects) {
  const repo = manual.repoMoves[p.repo] ?? p.repo
  const k = key(repo) ?? key(p.repoUrl)
  if (projects.has(k)) continue // mismo repositorio en dos fichas: se queda la primera
  const moved = repo !== p.repo
  // Si el repositorio cambió de dueño, el autor pasa a ser el dueño nuevo.
  const developers = moved && p.developers === p.repo.split('/')[0] ? repo.split('/')[0] : p.developers
  projects.set(k, { ...p, repo, developers, repoMovedFrom: moved ? p.repo : null, source: 'recompendium' })
}
for (const m of manual.projects) {
  const k = key(m.repo)
  const prev = projects.get(k)
  if (!prev && !m.game) {
    console.warn(`manual: ${m.repo} no está en las fuentes y no define juego; se ignora`)
    continue
  }
  projects.set(k, {
    tags: [], abandoned: false, takedown: false, forkOf: null, toolchain: null, homepage: null, requirementsText: null,
    summary: null, repoUrl: null, devStatus: 'unknown', games: m.game ? [m.game] : [],
    ...prev,
    ...m,
    source: prev ? `${prev.source}+manual` : 'manual',
  })
}

// Adaptadores revisados (catalog/adapters/*.json), uno por proyecto, por repositorio.
const { readdir } = await import('node:fs/promises')
const adapterDir = join(ROOT, 'catalog/adapters')
for (const f of existsSync(adapterDir) ? (await readdir(adapterDir)).filter((n) => n.endsWith('.json')) : []) {
  const a = JSON.parse(await readFile(join(adapterDir, f), 'utf8'))
  const target = projects.get(key(a.repo))
  if (!target) { console.warn(`adaptador ${f}: el repositorio ${a.repo} no está en el catálogo`); continue }
  target.adapter = a.adapter
}

for (const p of projects.values()) {
  if (!games.has(p.game)) throw new Error(`Proyecto ${p.repo}: juego desconocido ${p.game}`)
  p.platform ??= games.get(p.game).platform
  if (!platformSlugs.has(p.platform)) throw new Error(`Proyecto ${p.repo}: plataforma desconocida ${p.platform}`)
}

// Slugs estables y únicos a partir del repositorio.
const used = new Set()
for (const p of projects.values()) {
  const base = (p.repo ?? p.repoUrl.replace(/^https?:\/\/[^/]+\//, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  let slug = base, n = 2
  while (used.has(slug)) slug = `${base}-${n++}`
  used.add(slug)
  p.slug = slug
}

// ---------- 2. Comprobar releases en github.com ----------
const UA = { 'User-Agent': 'native-hub-catalog-builder' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, opts = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: UA, ...opts })
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * 2 ** attempt); continue }
    return res
  }
  throw new Error(`demasiados reintentos: ${url}`)
}

const SIZE_UNITS = { Bytes: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }

function parseAssets(html, repo, tag) {
  const assets = []
  const marker = `/${repo}/releases/download/`
  const parts = html.split(`href="${marker}`)
  for (const chunk of parts.slice(1)) {
    const path = chunk.slice(0, chunk.indexOf('"'))
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
    const sha = chunk.match(/sha256:([0-9a-f]{64})/)?.[1] ?? null
    const size = chunk.match(/>(\d+(?:\.\d+)?) (Bytes|KB|MB|GB)</)
    const date = chunk.match(/datetime="([^"]+)"/)?.[1] ?? null
    assets.push({
      name,
      url: `https://github.com${marker}${path}`,
      sha256: sha,
      size: size ? Math.round(parseFloat(size[1]) * SIZE_UNITS[size[2]]) : null,
      sizeApprox: true,
      uploadedAt: date,
    })
  }
  // Los «Source code (zip/tar.gz)» usan /archive/, no /releases/download/, así que no entran.
  return assets.filter((a) => a.url.includes(`/download/${encodeURIComponent(tag)}/`) || a.url.includes(`/download/${tag}/`))
}

async function checkRepo(repo) {
  const res = await get(`https://github.com/${repo}/releases/latest`, { redirect: 'manual' })
  if (res.status === 404) return { repoExists: false, release: null }
  const loc = res.headers.get('location') ?? ''
  const m = loc.match(/\/releases\/tag\/([^/?#]+)$/)
  if (!m) return { repoExists: true, release: null } // sin releases publicadas
  const tag = decodeURIComponent(m[1])
  const page = await get(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`)
  const html = page.ok ? await page.text() : ''
  const assets = parseAssets(html, repo, tag)
  const publishedAt = assets.map((a) => a.uploadedAt).filter(Boolean).sort().at(-1) ?? null
  return { repoExists: true, release: { tag, url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`, publishedAt, prerelease: null, assets } }
}

const ghRepos = [...projects.values()].filter((p) => p.repo).map((p) => p.repo)
const todo = OFFLINE ? [] : ghRepos.filter((r) => FORCE || !cache[r] || Date.now() - Date.parse(cache[r].checkedAt) > MAX_AGE_MS)
console.log(`${projects.size} proyectos · ${ghRepos.length} en GitHub · ${todo.length} por comprobar`)

let done = 0, failed = 0
async function worker() {
  while (todo.length) {
    const repo = todo.shift()
    try {
      cache[repo] = { ...(await checkRepo(repo)), checkedAt: new Date().toISOString() }
    } catch (err) {
      failed++
      console.warn(`  ${repo}: ${err.message} (se mantiene la comprobación anterior)`)
    }
    if (++done % 50 === 0) {
      console.log(`  ${done} comprobados…`)
      await writeFile(cachePath, JSON.stringify(cache))
    }
  }
}
await mkdir(join(ROOT, '.cache'), { recursive: true })
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
await writeFile(cachePath, JSON.stringify(cache))

// ---------- 3. Ejecutable Windows ----------
const NOT_WINDOWS = /(linux|mac|osx|darwin|apple|android|ios|switch|nro|appimage|flatpak|steamdeck|decky|symbols|pdb|debug|source|src|\.txt$|\.md$|\.sha256$|\.sig$|\.asc$|\.json$|\.deb$|\.rpm$|\.dmg$|\.apk$|\.tar\.|\.ipa$)/i
const WINDOWS = /(win|windows|msvc|mingw|\.exe$|\.msi$)/i

function pickWindowsAsset(p, assets) {
  if (!assets?.length) return null
  if (p.windowsAssetPattern) {
    const re = new RegExp(p.windowsAssetPattern)
    return assets.find((a) => re.test(a.name)) ?? null
  }
  const candidates = assets.filter((a) => WINDOWS.test(a.name) && !NOT_WINDOWS.test(a.name.replace(/windows/i, '')))
  // Preferir x64 y luego .zip/.exe/.msi/.7z
  const score = (a) => (/(x64|x86_64|win64|amd64)/i.test(a.name) ? 2 : 0) + (/\.(zip|exe|msi|7z)$/i.test(a.name) ? 1 : 0)
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null
}

// ---------- 4. Escribir ----------
const out = []
for (const p of projects.values()) {
  const c = p.repo ? cache[p.repo] : null
  const release = c?.release ?? null
  const windowsAsset = pickWindowsAsset(p, release?.assets)
  const installable = Boolean(windowsAsset) && !p.takedown
  // Si la release tiene archivos genéricos (.zip/.7z sin sistema en el nombre) no se puede
  // saber si son para Windows: queda «por verificar» hasta revisarlo a mano en manual.json.
  const ambiguous = !windowsAsset && (release?.assets ?? []).some((a) => /\.(zip|7z|rar|exe)$/i.test(a.name) && !NOT_WINDOWS.test(a.name))
  out.push({
    slug: p.slug,
    sourceId: p.sourceId ?? null,
    game: p.game,
    gameTitle: games.get(p.game).title,
    games: p.games,
    platform: p.platform,
    name: p.name,
    developers: p.developers ?? null,
    kind: p.kind,
    devStatus: p.devStatus,
    abandoned: p.abandoned,
    takedown: p.takedown,
    forkOf: p.forkOf ?? null,
    toolchain: p.toolchain ?? null,
    repo: p.repo ? { host: 'github', owner: p.repo.split('/')[0], name: p.repo.split('/')[1] } : { host: new URL(p.repoUrl).hostname, owner: null, name: null },
    repoUrl: p.repo ? `https://github.com/${p.repo}` : p.repoUrl,
    repoMovedFrom: p.repoMovedFrom ?? null,
    homepage: p.homepage ?? null,
    repoExists: c ? c.repoExists : null,
    release,
    windowsAsset,
    hasWindowsExecutable: !c || ambiguous ? null : Boolean(windowsAsset),
    listing: installable ? 'library' : 'in_development',
    summary: p.summary ?? null,
    requirementsText: p.requirementsText ?? null,
    requirements: p.requirements ?? null,
    tags: p.tags ?? [],
    adapter: p.adapter ?? null,
    stars: p.stars ?? null,
    createdAt: p.createdAt ?? null,
    pushedAt: p.pushedAt ?? null,
    license: p.license ?? null,
    source: p.source,
    checkedAt: c?.checkedAt ?? null,
  })
}
out.sort((a, b) => a.slug.localeCompare(b.slug))

const usedGames = new Set(out.flatMap((p) => p.games))
const catalog = {
  $comment: 'Generado por scripts/build-catalog.mjs. No editar a mano. Datos de Recompendium bajo CC BY-SA 4.0.',
  generatedAt: new Date().toISOString(),
  sources: [
    { name: 'NATIVE HUB (curado a mano)', url: null, license: null },
    recomp.source && { name: recomp.source.name, url: recomp.source.url, data: recomp.source.data, license: recomp.source.license, commit: recomp.source.commit },
  ].filter(Boolean),
  families: manual.families,
  platforms,
  games: [...games.values()].filter((g) => usedGames.has(g.slug)).sort((a, b) => a.title.localeCompare(b.title)),
  projects: out,
}
await writeFile(join(ROOT, 'catalog/catalog.json'), JSON.stringify(catalog) + '\n')

const lib = out.filter((p) => p.listing === 'library').length
const unchecked = out.filter((p) => p.checkedAt == null).length
console.log(`catalog/catalog.json · ${catalog.games.length} juegos · ${out.length} proyectos · ${lib} con ejecutable Windows · ${unchecked} sin comprobar · ${failed} errores`)
