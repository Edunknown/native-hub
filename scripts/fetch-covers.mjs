// Resuelve la portada de cada juego en IGDB y la guarda en catalog/sources/igdb-covers.json.
//
// La app nunca lleva credenciales: aquí solo se obtiene el identificador de imagen de IGDB
// (image_id) a partir del ID de IGDB que ya trae cada juego. La app descarga después la
// imagen pública de images.igdb.com y la guarda en su caché.
//
// Requiere una aplicación de Twitch (dev.twitch.tv, tipo «Confidencial») en estas variables:
//   IGDB_CLIENT_ID, IGDB_CLIENT_SECRET
//
// Uso:
//   node scripts/fetch-covers.mjs           resuelve solo los juegos que aún no tienen entrada
//   node scripts/fetch-covers.mjs --force   vuelve a consultarlos todos
//
// Después, `npm run catalog:build -- --offline` vuelca las portadas en catalog/catalog.json.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FORCE = process.argv.includes('--force')
const OUT = join(ROOT, 'catalog/sources/igdb-covers.json')
const BATCH = 500 // máximo de resultados por consulta en IGDB
const MIN_INTERVAL_MS = 300 // IGDB admite 4 peticiones por segundo

const clientId = process.env.IGDB_CLIENT_ID?.trim()
const secret = process.env.IGDB_CLIENT_SECRET?.trim()
if (!clientId || !secret) {
  console.error('Faltan IGDB_CLIENT_ID e IGDB_CLIENT_SECRET (aplicación de dev.twitch.tv). En Windows: setx IGDB_CLIENT_ID "…" y abre una terminal nueva.')
  process.exit(1)
}

const readJson = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : fallback)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// IDs de IGDB: los de las fuentes y los fijados a mano en manual.json (gameOverrides).
const recomp = await readJson(join(ROOT, 'catalog/sources/recompendium.json'), { games: [] })
const manual = await readJson(join(ROOT, 'catalog/sources/manual.json'), { games: [], gameOverrides: {} })
const ids = new Set()
for (const g of [...recomp.games, ...manual.games, ...Object.values(manual.gameOverrides ?? {})]) {
  if (Number.isInteger(g.igdb) && g.igdb > 0) ids.add(g.igdb)
}

const prev = await readJson(OUT, { covers: {} })
const covers = FORCE ? {} : { ...prev.covers }
const todo = [...ids].filter((id) => !(String(id) in covers)).sort((a, b) => a - b)
console.log(`${ids.size} juegos con ID de IGDB · ${todo.length} por consultar`)

// Token de aplicación (client credentials). Dura ~60 días; no se guarda en ningún sitio.
const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }),
})
if (!tokenRes.ok) {
  console.error(`Twitch rechazó las credenciales (${tokenRes.status}): ${await tokenRes.text()}`)
  process.exit(1)
}
const { access_token: token } = await tokenRes.json()

let last = 0
async function igdb(endpoint, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
    const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body,
    })
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue }
    if (!res.ok) throw new Error(`IGDB ${endpoint} ${res.status}: ${await res.text()}`)
    return res.json()
  }
  throw new Error(`IGDB ${endpoint}: demasiados reintentos`)
}

let found = 0
for (let i = 0; i < todo.length; i += BATCH) {
  const chunk = todo.slice(i, i + BATCH)
  const rows = await igdb('games', `fields id, cover.image_id, cover.width, cover.height; where id = (${chunk.join(',')}); limit ${BATCH};`)
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const id of chunk) {
    const c = byId.get(id)?.cover
    // null = consultado y sin portada en IGDB (no se vuelve a pedir salvo con --force).
    covers[id] = c?.image_id ? { imageId: c.image_id, width: c.width ?? null, height: c.height ?? null } : null
    if (c?.image_id) found++
  }
  console.log(`  ${Math.min(i + BATCH, todo.length)} / ${todo.length}`)
}

const sorted = Object.fromEntries(Object.entries(covers).sort(([a], [b]) => Number(a) - Number(b)))
await writeFile(OUT, JSON.stringify({
  $comment: 'Generado por scripts/fetch-covers.mjs. Identificadores de portada de IGDB (igdb.com) por ID de juego. Las imágenes no se incluyen: la app las descarga de images.igdb.com.',
  source: { name: 'IGDB', url: 'https://www.igdb.com', terms: 'https://www.igdb.com/terms' },
  fetchedAt: new Date().toISOString(),
  covers: sorted,
}, null, 1) + '\n')

const total = Object.values(sorted).filter(Boolean).length
console.log(`catalog/sources/igdb-covers.json · ${found} nuevas · ${total} juegos con portada · ${Object.keys(sorted).length - total} sin portada en IGDB`)
