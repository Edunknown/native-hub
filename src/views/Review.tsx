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
import { lang, tr } from '../lib/i18n'
import { ErrorNote } from '../components/ErrorNote'

type Status = 'new' | 'approved' | 'rejected'
const SOURCES: { id: string | undefined; label: string }[] = [
  { id: undefined, label: tr('Todas las fuentes', 'All sources') },
  { id: 'recompendium', label: 'Recompendium' },
  { id: 'github-search', label: 'GitHub' },
  { id: 'gitlab-search', label: 'GitLab' },
]
const TABS: { id: Status; label: string }[] = [
  { id: 'new', label: tr('Pendientes', 'Pending') },
  { id: 'approved', label: tr('Aprobados', 'Approved') },
  { id: 'rejected', label: tr('Rechazados', 'Rejected') },
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
    if (!platform) return setErr(tr('Elige la plataforma original.', 'Choose the original platform.'))
    if (!game && !q.trim()) return setErr(tr('Elige un juego del catálogo o escribe el título de uno nuevo.', 'Choose a game from the catalog or type the title of a new one.'))
    setSaving(true)
    try {
      await task({ title: `${tr('Añadiendo', 'Adding')} ${name} ${tr('al catálogo', 'to the catalog')}`, steps: [tr('Creando la ficha del proyecto', 'Creating the project page'), tr('Comprobando su release en GitHub', 'Checking its release on GitHub'), tr('Buscando el ejecutable Windows', 'Looking for the Windows executable'), tr('Añadiéndolo al catálogo', 'Adding it to the catalog')], minMs: 2600, done: tr('Añadido al catálogo', 'Added to the catalog') },
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
        <span>{tr('Juego', 'Game')}</span>
        {game ? (
          <span className="chosen">{game.title} <button type="button" className="link" onClick={() => { setGame(null); setQ('') }}>{tr('cambiar', 'change')}</button></span>
        ) : (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Busca en el catálogo o escribe un título nuevo', 'Search the catalog or type a new title')} />
        )}
      </label>
      {!game && matches.length > 0 && (
        <ul className="suggest">
          {matches.map((m) => (
            <li key={m.slug}><button type="button" onClick={() => { setGame(m); setPlatform(m.platform) }}>{m.title}</button></li>
          ))}
        </ul>
      )}
      {!game && q.trim() && <p className="note-line">{tr('Si no eliges uno de la lista, se creará el juego', 'If you do not pick one from the list, a new game will be created:')} «{q.trim()}».</p>}
      <label>
        <span>{tr('Plataforma original', 'Original platform')}</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">{tr('Elige…', 'Choose…')}</option>
          {platforms.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      </label>
      <label>
        <span>{tr('Tipo', 'Type')}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)}>
          {Object.entries(kindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label>
        <span>{tr('Nombre del proyecto', 'Project name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {err && <ErrorNote error={err} />}
      <div className="actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={submit}>{saving ? tr('Aprobando…', 'Approving…') : tr('Aprobar y añadir al catálogo', 'Approve and add to the catalog')}</button>
        <button type="button" className="link" onClick={onCancel}>{tr('Cancelar', 'Cancel')}</button>
      </div>
      <p className="note-line">{tr('Al aprobarlo se comprueba su release. Solo será instalable si publica un ejecutable Windows.', 'Approving it checks its release. It will only be installable if it publishes a Windows executable.')}</p>
    </div>
  )
}

function Suggested({ c, onChanged }: { c: Candidate; onChanged: () => void }) {
  const { platformOf } = useCatalog()
  const task = useTask()
  const s = c.suggestion!
  return (
    <div className="suggest-box">
      <span className="note-line">{tr('Sugerido por Recompendium', 'Suggested by Recompendium')}: <span className="fg">{s.gameTitle}</span> · {platformOf(s.platform)?.name ?? s.platform} · {kindLabel[s.kind] ?? s.kind}{s.takedown ? tr(' · retirado por DMCA', ' · DMCA takedown') : ''}</span>
      <button type="button" className="btn-line" onClick={() => task({ title: `${tr('Añadiendo', 'Adding')} ${s.name} ${tr('al catálogo', 'to the catalog')}`, steps: [tr('Creando la ficha del juego y del proyecto', 'Creating the game and project pages'), tr('Comprobando su release', 'Checking its release'), tr('Buscando el ejecutable Windows', 'Looking for the Windows executable')], minMs: 1800, done: tr('Añadido', 'Added') }, () => api.approveSuggested(c.id)).then(onChanged, () => {})}>{tr('Aprobar', 'Approve')}</button>
    </div>
  )
}

function CandidateRow({ c, onChanged }: { c: Candidate; onChanged: () => void }) {
  const { go } = useNav()
  const [open, setOpen] = useState(false)
  const task = useTask()
  const flags = [c.isFork && 'fork', c.archived && tr('archivado', 'archived'), c.abandoned && tr('sin cambios en más de un año', 'no changes in over a year')].filter(Boolean)
  return (
    <li className="cand">
      <div className="cand-main">
        <div>
          <a className="game" onClick={() => openExternal(c.repoUrl)}>{c.fullName}</a>
          {c.stars != null && <span className="muted num"> · ★ {fmtNum(c.stars)}</span>}
          {c.language && <span className="muted"> · {c.language}</span>}
        </div>
        {c.description && <p className="sub">{(lang === 'en' && c.suggestion?.summaryEn) || c.description}</p>}
        <p className="note-line">
          {tr('Encontrado por', 'Found by')} {c.reason} · {fmtDate(c.detectedAt)}
          {c.pushedAt && <> · {tr('último cambio', 'last change')} {fmtDate(c.pushedAt)}</>}
          {flags.length > 0 && <> · {flags.join(' · ')}</>}
        </p>
      </div>
      <div className="cand-end">
        {c.windowsAsset ? <span className="yes" title={c.windowsAsset}>{tr('Ejecutable Windows', 'Windows executable')}</span>
          : c.releaseChecked ? <span className="muted">{c.releaseTag ? `Release ${c.releaseTag}, ${tr('sin Windows', 'no Windows')}` : tr('Sin release', 'No release')}</span>
            : <span className="tbd">{tr('release sin comprobar', 'release not checked')}</span>}
        {c.status === 'new' && !open && (
          <span className="cand-actions">
            <button type="button" className={c.suggestion ? 'link' : 'btn-line'} onClick={() => setOpen(true)}>{c.suggestion ? tr('Cambiar datos…', 'Edit details…') : tr('Aprobar…', 'Approve…')}</button>
            <button type="button" className="link" onClick={() => task({ title: `${tr('Descartando', 'Discarding')} ${c.fullName}`, steps: [tr('Descartando el candidato', 'Discarding the candidate')], minMs: 800 }, () => api.reject(c.id)).then(onChanged, () => {})}>{tr('Rechazar', 'Reject')}</button>
          </span>
        )}
        {c.status === 'approved' && c.projectSlug && c.projectGame && (
          <button type="button" className="link" onClick={() => go({ name: 'game', slug: c.projectGame!, project: c.projectSlug! })}>{tr('Ver ficha', 'View page')}</button>
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
    return <p className="empty">{tr('El escáner y la cola de revisión solo funcionan en la app de escritorio.', 'The scanner and review queue only work in the desktop app.')}</p>
  }

  return (
    <>
      <div className="actions">
        <button type="button" className="btn-primary" disabled={live.status?.busy} onClick={live.startScan}>
          {live.status?.busy ? tr('Trabajando…', 'Working…') : tr('Buscar proyectos nuevos en GitHub', 'Search GitHub for new projects')}
        </button>
        <button type="button" className="btn-line" disabled={live.status?.busy} onClick={live.startSync}>{tr('Sincronizar con Recompendium', 'Sync with Recompendium')}</button>
        <span className="note-line"><QuotaLine /></span>
      </div>
      <p className="note-line">{tr('La búsqueda mira GitHub y GitLab. La sincronización trae las fichas nuevas de Recompendium con juego, consola y tipo ya rellenos. Todo llega aquí y nada entra en el catálogo sin que lo apruebes.', 'Search looks at GitHub and GitLab. Sync brings new Recompendium entries with game, console and type already filled in. Everything lands here and nothing enters the catalog until you approve it.')}</p>
      {live.error && <ErrorNote error={live.error} />}
      <JobBar />
      {live.lastFinished?.job === 'sync' && live.lastFinished.result.sync != null && (
        <p className="note-line">
          Recompendium: {String((live.lastFinished.result.sync as { entries: number }).entries)} {tr('fichas', 'entries')}, {String((live.lastFinished.result.sync as { newCandidates: number }).newCandidates)} {tr('nuevas en la cola', 'new in the queue')}
          {(live.lastFinished.result.sync as { remaining: number }).remaining > 0 ? ` (${(live.lastFinished.result.sync as { remaining: number }).remaining} ${tr('quedan para la próxima', 'left for next time')})` : ''}.
        </p>
      )}
      {live.lastFinished?.job === 'scan' && live.lastFinished.result.scan != null && (
        <p className="note-line">
          {tr('Última búsqueda', 'Last search')}: {String((live.lastFinished.result.scan as { newCandidates: number }).newCandidates)} {tr('candidatos nuevos', 'new candidates')},
          {' '}{String((live.lastFinished.result.scan as { alreadyKnown: number }).alreadyKnown)} {tr('ya estaban en el catálogo.', 'were already in the catalog.')}
        </p>
      )}

      <div className="filters small" role="group" aria-label={tr('Fuente', 'Source')}>
        {SOURCES.map((s) => (
          <button key={s.label} type="button" aria-pressed={source === s.id} onClick={() => setSource(s.id)}>
            {s.label}{s.id && data?.bySource?.[s.id]?.new ? ` (${fmtNum(data.bySource[s.id].new ?? 0)})` : ''}
          </button>
        ))}
      </div>
      {tab === 'new' && pendingRecomp > 0 && (
        <div className="cand-actions">
          {!confirmAll ? (
            <button type="button" className="btn-line" onClick={() => setConfirmAll(true)}>{tr('Aprobar las', 'Approve all')} {fmtNum(pendingRecomp)} {tr('fichas de Recompendium…', 'Recompendium entries…')}</button>
          ) : (
            <>
              <span>{tr(`Se añadirán ${fmtNum(pendingRecomp)} proyectos con los datos de Recompendium y después se comprobarán sus releases. ¿Seguir?`, `${fmtNum(pendingRecomp)} projects will be added with Recompendium's data and their releases checked afterwards. Continue?`)}</span>
              <button type="button" className="btn-primary" onClick={() => { setConfirmAll(false); task({ title: `${tr('Añadiendo', 'Adding')} ${fmtNum(pendingRecomp)} ${tr('proyectos', 'projects')}`, steps: [tr('Creando las fichas de los juegos', 'Creating the game pages'), tr('Creando las fichas de los proyectos', 'Creating the project pages'), tr('Poniendo en cola la comprobación de releases', 'Queueing the release checks')], minMs: 2600, done: tr('Añadidos al catálogo', 'Added to the catalog') }, () => api.approveAllSuggested('recompendium')).then(() => { setTick((t) => t + 1); live.reload() }, () => {}) }}>{tr('Sí, aprobarlas', 'Yes, approve them')}</button>
              <button type="button" className="link" onClick={() => setConfirmAll(false)}>No</button>
            </>
          )}
        </div>
      )}
      <div className="filters small" role="group" aria-label={tr('Estado', 'Status')}>
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}{data ? ` (${fmtNum(data.counts[t.id])})` : ''}
          </button>
        ))}
      </div>

      {data && data.items.length === 0 && (
        <p className="empty">{tab === 'new' ? tr('No hay candidatos pendientes. Lanza una búsqueda para encontrar proyectos que aún no están en el catálogo.', 'No pending candidates. Run a search to find projects that are not in the catalog yet.') : tr('Nada por aquí.', 'Nothing here.')}</p>
      )}
      <ul className="list">
        {data?.items.map((c) => <CandidateRow key={c.id} c={c} onChanged={() => { setTick((t) => t + 1); live.reload() }} />)}
      </ul>
    </>
  )
}
