// Genera catalog/seed.json a partir de catalog/curated.json y la API oficial de GitHub.
// Prototipo del Release Manager (fase 3) para que la interfaz de la fase 1 trabaje con datos reales.
// Nada se inventa: si la API no devuelve un dato, queda en null y la interfaz muestra «por verificar».
//
// Uso:  node scripts/snapshot-releases.mjs        (opcional: GITHUB_TOKEN en el entorno)

import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../catalog/', import.meta.url)
const curated = JSON.parse(await readFile(new URL('curated.json', root), 'utf8'))

const headers = { 'User-Agent': 'native-hub-dev', Accept: 'application/vnd.github+json' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

const checkedAt = new Date().toISOString()
const projects = []
// Si la API falla (p. ej. límite de 60 peticiones/hora), se conserva la comprobación anterior con su fecha.
const previous = await readFile(new URL('seed.json', root), 'utf8').then(JSON.parse).catch(() => null)
const prevBySlug = new Map((previous?.projects ?? []).map((p) => [p.slug, p]))

for (const p of curated.projects) {
  const full = `${p.repo.owner}/${p.repo.name}`
  let repo, rel
  try {
    repo = await gh(`/repos/${full}`)
    rel = repo ? await gh(`/repos/${full}/releases/latest`) : null
  } catch (err) {
    const prev = prevBySlug.get(p.slug)
    console.warn(`${full}: ${err.message} · se mantiene la comprobación anterior`)
    if (prev) projects.push({ ...prev, ...p })
    continue
  }
  const pattern = new RegExp(p.windowsAssetPattern.replace(/^\(\?i\)/, ''), p.windowsAssetPattern.startsWith('(?i)') ? 'i' : '')
  const assets = (rel?.assets ?? []).map((a) => ({
    name: a.name,
    size: a.size,
    url: a.browser_download_url,
    sha256: typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7) : null,
  }))
  const winAsset = assets.find((a) => pattern.test(a.name)) ?? null

  projects.push({
    ...p,
    repoUrl: repo?.html_url ?? null,
    repoExists: Boolean(repo),
    archived: repo?.archived ?? null,
    license: repo?.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null,
    pushedAt: repo?.pushed_at ?? null,
    createdAt: repo?.created_at ?? null,
    release: rel
      ? {
          tag: rel.tag_name,
          name: rel.name,
          publishedAt: rel.published_at,
          prerelease: rel.prerelease,
          url: rel.html_url,
          assets,
        }
      : null,
    windowsAsset: winAsset,
    // Instalable = existe release y un asset Windows que encaja con el patrón del adaptador.
    hasWindowsExecutable: Boolean(winAsset),
    listing: winAsset ? 'library' : 'in_development',
    checkedAt,
  })
  console.log(`${full.padEnd(34)} ${rel?.tag_name ?? '(sin release)'}  ${winAsset?.name ?? '(sin asset Windows)'}`)
}

const seed = {
  $comment: 'Generado por scripts/snapshot-releases.mjs. No editar a mano.',
  generatedAt: checkedAt,
  platforms: curated.platforms,
  games: curated.games,
  projects,
}
await writeFile(new URL('seed.json', root), JSON.stringify(seed, null, 2) + '\n')
console.log(`\ncatalog/seed.json escrito · ${projects.length} proyectos · ${checkedAt}`)
