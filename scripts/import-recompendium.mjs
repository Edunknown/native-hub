// Importa el catálogo de Recompendium (https://recompendium.com) a catalog/sources/recompendium.json.
//
// Recompendium publica sus datos en https://github.com/Nio03/unricopie (src/data/).
// Licencia de los datos y textos: CC BY-SA 4.0. Hay que mantener la atribución y,
// si se redistribuye el catálogo derivado, compartirlo con la misma licencia.
//
// Uso:  node scripts/import-recompendium.mjs
// Clona (o actualiza) el repositorio en .cache/recompendium y lo convierte.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CACHE = join(ROOT, '.cache', 'recompendium')
const REPO_URL = 'https://github.com/Nio03/unricopie'

await mkdir(join(ROOT, '.cache'), { recursive: true })
if (existsSync(join(CACHE, '.git'))) {
  execFileSync('git', ['-C', CACHE, 'pull', '--ff-only', '-q'], { stdio: 'inherit' })
} else {
  execFileSync('git', ['clone', '--depth', '1', '-q', REPO_URL, CACHE], { stdio: 'inherit' })
}
const commit = execFileSync('git', ['-C', CACHE, 'rev-parse', 'HEAD']).toString().trim()
const commitDate = execFileSync('git', ['-C', CACHE, 'log', '-1', '--format=%cI']).toString().trim()

const DATA = join(CACHE, 'src', 'data')
const gamesYaml = parse(await readFile(join(DATA, 'games.yaml'), 'utf8'))
// Datos de GitHub que Recompendium refresca a diario: estrellas, fechas, licencia y fork.
const stats = JSON.parse(await readFile(join(DATA, 'stats.json'), 'utf8'))

// Carpeta de Recompendium → tipo de proyecto de NATIVE HUB.
const KIND_BY_CATEGORY = {
  'decomp-port': 'decomp_port',
  'fan-remake': 'fan_remake',
  'game-engine': 'engine_reimpl',
  'native-layer': 'native_layer',
  'source-port': 'source_port',
}
const STATUS = { fully: 'complete', playable: 'playable', experimental: 'experimental', stable: 'stable', usable: 'playable', beta: 'beta' }

const es = (v) => (v == null ? null : typeof v === 'string' ? v : (v.es ?? v.en ?? null))

const projects = []
const usedGames = new Set()

for (const folder of ['recomps', 'ports', 'decomps']) {
  for (const file of (await readdir(join(DATA, folder))).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const y = parse(await readFile(join(DATA, folder, file), 'utf8'))
    if (!y || (!y.repo && !y.repoUrl)) continue
    const gameSlug = y.games?.[0]
    if (!gameSlug || !gamesYaml[gameSlug]) continue
    const kind = folder === 'recomps' ? 'static_recomp' : folder === 'decomps' ? 'decompilation' : (KIND_BY_CATEGORY[y.category] ?? 'other')
    const gameTitle = gamesYaml[gameSlug].name
    const repoName = y.repo ? y.repo.split('/')[1] : null
    // Muchas fichas se llaman como el juego («Pokémon Pokopia (featureJosh)»): para el selector
    // de recompilador se usa el nombre del repositorio, que es lo que distingue a cada proyecto.
    const baseTitle = gameTitle.replace(/\s*\(\d{4}\)$/, '')
    const name = (y.name.startsWith(gameTitle) || y.name.startsWith(baseTitle)) && repoName ? repoName : y.name
    projects.push({
      sourceId: `${folder}/${file.replace(/\.ya?ml$/, '')}`,
      repo: y.repo ?? null,
      repoUrl: y.repoUrl ?? null,
      name,
      game: gameSlug,
      games: y.games,
      platform: y.console,
      kind,
      devStatus: STATUS[y.status] ?? 'unknown',
      abandoned: Boolean(y.abandoned),
      takedown: Boolean(y.takedown),
      developers: y.author ?? (y.repo ? y.repo.split('/')[0] : null),
      toolchain: y.toolchain ?? null,
      homepage: y.homepage ?? null,
      summary: es(y.desc),
      requirementsText: es(y.requirements),
      tags: y.tags ?? [],
      stars: stats[y.repo]?.stars ?? null,
      createdAt: stats[y.repo]?.createdAt ?? null,
      pushedAt: stats[y.repo]?.pushedAt ?? null,
      license: stats[y.repo]?.license ?? null,
      forkOf: y.forkOf?.label ?? stats[y.repo]?.fork ?? null,
    })
    for (const g of y.games ?? []) usedGames.add(g)
  }
}

const games = [...usedGames]
  .filter((slug) => gamesYaml[slug])
  .sort()
  .map((slug) => {
    const g = gamesYaml[slug]
    return { slug, title: g.name, platform: g.platforms?.[0] ?? 'other', platforms: g.platforms ?? [], year: g.year ?? null, igdb: g.igdb ?? null }
  })

const out = {
  source: {
    name: 'Recompendium',
    url: 'https://recompendium.com',
    data: REPO_URL,
    license: 'CC BY-SA 4.0',
    commit,
    commitDate,
  },
  games,
  projects,
}
await mkdir(join(ROOT, 'catalog', 'sources'), { recursive: true })
await writeFile(join(ROOT, 'catalog', 'sources', 'recompendium.json'), JSON.stringify(out, null, 1) + '\n')
console.log(`Recompendium ${commit.slice(0, 7)} (${commitDate}) · ${games.length} juegos · ${projects.length} proyectos`)
