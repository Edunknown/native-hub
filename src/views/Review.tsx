// Cola de revisión: lo que encuentra el escáner. Nada entra en el catálogo sin aprobarlo aquí.

import { useEffect, useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useLive } from '../app/live'
import { useTask } from '../app/task'
import { useNav } from '../app/nav'
import { api, openExternal } from '../lib/api'
import { fmtDate, fmtNum, kindLabel } from '../lib/format'
import type { Candidate, CandidateList, ProjectKind } from '../lib/types'
import { JobBar, QuotaLine } from './Updates'

type Status = 'new' | 'approved' | 'rejected'
const SOURCES: { id: string | undefined; label: string }[] = [
  { id: undefined, label: 'Todas las fuentes' },
  { id: 'recompendium', label: 'Recompendium' },
  { id: 'github-search', label: 'GitHub' },
  { id: 'gitlab-search', label: 'GitLab' },
]
const TABS: { id: Status; label: string }[] = [
  { id: 'new', label: 'Pendientes' },
  { id: 'approved', label: 'Aprobados' },
  { id: 'rejected', label: 'Rechazados' },
]

function ApproveForm({ c, onDone, onCancel }: { c: Candidate; onDone: () => void; onCancel: () => void }) {
  const { platforms } = useCatalog()
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<{ slug: string; title: string; platform: string }[]>([])
  const [game, setGame] = useState<{ slug: string; title: string } | null>(null)
  const [platform, setPlatform] = useState('')
  const [kind, setKind] = useState<ProjectKind>('static_recomp')
  const [name, setName] = useState(c.fullName.split('/')[1])
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const task = useTask()

  useEffect(() => {
    if (game || q.trim().length < 2) { setMatches([]); return }
    let alive = true
    api.gamesLookup(q).then((m) => alive && setMatches(m))
    return () => { alive = false }
  }, [q, game])

  const submit = async () => {
    setErr(null)
    if (!platform) return setErr('Elige la plataforma original.')
    if (!game && !q.trim()) return setErr('Elige un juego del catálogo o escribe el título de uno nuevo.')
    setSaving(true)
    try {
      await task({ title: `Añadiendo ${name} al catálogo`, steps: ['Creando la ficha del proyecto', 'Comprobando su release en GitHub', 'Buscando el ejecutable Windows', 'Añadiéndolo al catálogo'], minMs: 2600, done: 'Añadido al catálogo' },
        () => api.approve({ candidateId: c.id, game: game?.slug, newGameTitle: game ? undefined : q.trim(), platform, kind, name }))
      onDone()
    } catch (e) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="approve">
      <label>
        <span>Juego</span>
        {game ? (
          <span className="chosen">{game.title} <button type="button" className="link" onClick={() => { setGame(null); setQ('') }}>cambiar</button></span>
        ) : (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca en el catálogo o escribe un título nuevo" />
        )}
      </label>
      {!game && matches.length > 0 && (
        <ul className="suggest">
          {matches.map((m) => (
            <li key={m.slug}><button type="button" onClick={() => { setGame(m); setPlatform(m.platform) }}>{m.title}</button></li>
          ))}
        </ul>
      )}
      {!game && q.trim() && <p className="note-line">Si no eliges uno de la lista, se creará el juego «{q.trim()}».</p>}
      <label>
        <span>Plataforma original</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">Elige…</option>
          {platforms.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      </label>
      <label>
        <span>Tipo</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)}>
          {Object.entries(kindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label>
        <span>Nombre del proyecto</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {err && <p className="note-line err">{err}</p>}
      <div className="actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={submit}>{saving ? 'Aprobando…' : 'Aprobar y añadir al catálogo'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancelar</button>
      </div>
      <p className="note-line">Al aprobarlo se comprueba su release. Solo será instalable si publica un ejecutable Windows.</p>
    </div>
  )
}

function Suggested({ c, onChanged }: { c: Candidate; onChanged: () => void }) {
  const { platformOf } = useCatalog()
  const task = useTask()
  const s = c.suggestion!
  return (
    <div className="suggest-box">
      <span className="note-line">Sugerido por Recompendium: <span className="fg">{s.gameTitle}</span> · {platformOf(s.platform)?.name ?? s.platform} · {kindLabel[s.kind] ?? s.kind}{s.takedown ? ' · retirado por DMCA' : ''}</span>
      <button type="button" className="btn-line" onClick={() => task({ title: `Añadiendo ${s.name} al catálogo`, steps: ['Creando la ficha del juego y del proyecto', 'Comprobando su release', 'Buscando el ejecutable Windows'], minMs: 1800, done: 'Añadido' }, () => api.approveSuggested(c.id)).then(onChanged, () => {})}>Aprobar</button>
    </div>
  )
}

function CandidateRow({ c, onChanged }: { c: Candidate; onChanged: () => void }) {
  const { go } = useNav()
  const [open, setOpen] = useState(false)
  const task = useTask()
  const flags = [c.isFork && 'fork', c.archived && 'archivado', c.abandoned && 'sin cambios en más de un año'].filter(Boolean)
  return (
    <li className="cand">
      <div className="cand-main">
        <div>
          <a className="game" onClick={() => openExternal(c.repoUrl)}>{c.fullName}</a>
          {c.stars != null && <span className="muted num"> · ★ {fmtNum(c.stars)}</span>}
          {c.language && <span className="muted"> · {c.language}</span>}
        </div>
        {c.description && <p className="sub">{c.description}</p>}
        <p className="note-line">
          Encontrado por {c.reason} · {fmtDate(c.detectedAt)}
          {c.pushedAt && <> · último cambio {fmtDate(c.pushedAt)}</>}
          {flags.length > 0 && <> · {flags.join(' · ')}</>}
        </p>
      </div>
      <div className="cand-end">
        {c.windowsAsset ? <span className="yes" title={c.windowsAsset}>Ejecutable Windows</span>
          : c.releaseChecked ? <span className="muted">{c.releaseTag ? `Release ${c.releaseTag}, sin Windows` : 'Sin release'}</span>
            : <span className="tbd">release sin comprobar</span>}
        {c.status === 'new' && !open && (
          <span className="cand-actions">
            <button type="button" className={c.suggestion ? 'link' : 'btn-line'} onClick={() => setOpen(true)}>{c.suggestion ? 'Cambiar datos…' : 'Aprobar…'}</button>
            <button type="button" className="link" onClick={() => task({ title: `Descartando ${c.fullName}`, steps: ['Descartando el candidato'], minMs: 800 }, () => api.reject(c.id)).then(onChanged, () => {})}>Rechazar</button>
          </span>
        )}
        {c.status === 'approved' && c.projectSlug && c.projectGame && (
          <button type="button" className="link" onClick={() => go({ name: 'game', slug: c.projectGame!, project: c.projectSlug! })}>Ver ficha</button>
        )}
      </div>
      {c.status === 'new' && c.suggestion && !open && <Suggested c={c} onChanged={onChanged} />}
      {open && <ApproveForm c={c} onDone={() => { setOpen(false); onChanged() }} onCancel={() => setOpen(false)} />}
    </li>
  )
}

export function Review() {
  const live = useLive()
  const [tab, setTab] = useState<Status>('new')
  const [source, setSource] = useState<string | undefined>(undefined)
  const [confirmAll, setConfirmAll] = useState(false)
  const task = useTask()
  const [data, setData] = useState<CandidateList | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api.candidates(tab, source).then(setData, () => setData({ items: [], counts: { new: 0, approved: 0, rejected: 0 } }))
  }, [tab, source, tick, live.version])

  const pendingRecomp = data?.bySource?.recompendium?.new ?? 0

  if (live.status?.unsupported) {
    return <p className="empty">El escáner y la cola de revisión solo funcionan en la app de escritorio.</p>
  }

  return (
    <>
      <div className="actions">
        <button type="button" className="btn-primary" disabled={live.status?.busy} onClick={live.startScan}>
          {live.status?.busy ? 'Trabajando…' : 'Buscar proyectos nuevos en GitHub'}
        </button>
        <button type="button" className="btn-line" disabled={live.status?.busy} onClick={live.startSync}>Sincronizar con Recompendium</button>
        <span className="note-line"><QuotaLine /></span>
      </div>
      <p className="note-line">La búsqueda mira GitHub y GitLab. La sincronización trae las fichas nuevas de Recompendium con juego, consola y tipo ya rellenos. Todo llega aquí y nada entra en el catálogo sin que lo apruebes.</p>
      {live.error && <p className="note-line err">{live.error}</p>}
      <JobBar />
      {live.lastFinished?.job === 'sync' && live.lastFinished.result.sync != null && (
        <p className="note-line">
          Recompendium: {String((live.lastFinished.result.sync as { entries: number }).entries)} fichas, {String((live.lastFinished.result.sync as { newCandidates: number }).newCandidates)} nuevas en la cola
          {(live.lastFinished.result.sync as { remaining: number }).remaining > 0 ? ` (quedan ${(live.lastFinished.result.sync as { remaining: number }).remaining} para la próxima)` : ''}.
        </p>
      )}
      {live.lastFinished?.job === 'scan' && live.lastFinished.result.scan != null && (
        <p className="note-line">
          Última búsqueda: {String((live.lastFinished.result.scan as { newCandidates: number }).newCandidates)} candidatos nuevos,
          {' '}{String((live.lastFinished.result.scan as { alreadyKnown: number }).alreadyKnown)} ya estaban en el catálogo.
        </p>
      )}

      <div className="filters small" role="group" aria-label="Fuente">
        {SOURCES.map((s) => (
          <button key={s.label} type="button" aria-pressed={source === s.id} onClick={() => setSource(s.id)}>
            {s.label}{s.id && data?.bySource?.[s.id]?.new ? ` (${fmtNum(data.bySource[s.id].new ?? 0)})` : ''}
          </button>
        ))}
      </div>
      {tab === 'new' && pendingRecomp > 0 && (
        <div className="cand-actions">
          {!confirmAll ? (
            <button type="button" className="btn-line" onClick={() => setConfirmAll(true)}>Aprobar las {fmtNum(pendingRecomp)} fichas de Recompendium…</button>
          ) : (
            <>
              <span>Se añadirán {fmtNum(pendingRecomp)} proyectos con los datos de Recompendium y después se comprobarán sus releases. ¿Seguir?</span>
              <button type="button" className="btn-primary" onClick={() => { setConfirmAll(false); task({ title: `Añadiendo ${fmtNum(pendingRecomp)} proyectos`, steps: ['Creando las fichas de los juegos', 'Creando las fichas de los proyectos', 'Poniendo en cola la comprobación de releases'], minMs: 2600, done: 'Añadidos al catálogo' }, () => api.approveAllSuggested('recompendium')).then(() => { setTick((t) => t + 1); live.reload() }, () => {}) }}>Sí, aprobarlas</button>
              <button type="button" className="link" onClick={() => setConfirmAll(false)}>No</button>
            </>
          )}
        </div>
      )}
      <div className="filters small" role="group" aria-label="Estado">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}{data ? ` (${fmtNum(data.counts[t.id])})` : ''}
          </button>
        ))}
      </div>

      {data && data.items.length === 0 && (
        <p className="empty">{tab === 'new' ? 'No hay candidatos pendientes. Lanza una búsqueda para encontrar proyectos que aún no están en el catálogo.' : 'Nada por aquí.'}</p>
      )}
      <ul className="list">
        {data?.items.map((c) => <CandidateRow key={c.id} c={c} onChanged={() => { setTick((t) => t + 1); live.reload() }} />)}
      </ul>
    </>
  )
}
