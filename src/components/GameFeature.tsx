import { useState } from 'react'
import { useDownloads } from '../app/downloads'
import { useLibrary } from '../app/library'
import { InstallPanel } from './Install'
import { api as liveApi } from '../lib/api'
import { useCatalog } from '../app/catalog'
import { useNav } from '../app/nav'
import { IconDownload, IconOut } from '../app/icons'
import { openExternal } from '../lib/api'
import { fmtDate, fmtDateTime, fmtNum, fmtSize, kindLabel, plural, statusLabel } from '../lib/format'
import type { Game, GameDetail, Project } from '../lib/types'

function initials(title: string) {
  const words = title.replace(/^The Legend of Zelda:\s*/i, '').split(/[\s:]+/).filter((w) => /^[\p{Lu}0-9]/u.test(w))
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || title.slice(0, 2).toUpperCase()
}

export function Cover({ game }: { game: Game }) {
  const { platformOf } = useCatalog()
  return (
    <div className="cover" aria-hidden="true">
      <span className="plat">{platformOf(game.platform)?.name}{game.year ? ` · ${game.year}` : ''}</span>
      <span className="glyph">{initials(game.title)}</span>
      <span className="cap">Portada: pendiente de fuente oficial</span>
    </div>
  )
}

const tbd = <dd className="tbd">por verificar</dd>
function Bool({ v }: { v: boolean | null | undefined }) {
  if (v == null) return tbd
  return <dd className={v ? 'yes' : undefined}>{v ? 'Sí' : 'No'}</dd>
}

export function CompatSheet({ project }: { project: Project }) {
  const r = project.release
  const req = project.requirements
  const a = project.windowsAsset
  return (
    <dl className="compat" aria-label="Ficha de compatibilidad">
      <div><dt>Ejecutable Windows</dt><Bool v={project.hasWindowsExecutable} /></div>
      <div><dt>Release oficial</dt>{project.checkedAt == null ? tbd : r ? <dd className="yes">GitHub Releases</dd> : <dd>No publicada</dd>}</div>
      <div><dt>Última versión</dt>{r ? <dd className="mono">{r.tag}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>Publicada</dt>{r?.publishedAt ? <dd className="num">{fmtDate(r.publishedAt)}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>Archivos originales</dt>{req?.originalFiles ? <dd>{req.originalFiles}</dd> : project.requirementsText ? <dd>Sí, ver requisitos</dd> : tbd}</div>
      <div><dt>Archivos extraídos</dt><Bool v={req?.extractedFiles} /></div>
      <div><dt>Claves</dt><Bool v={req?.keys} /></div>
      <div><dt>Compilación manual</dt><Bool v={req?.manualBuild} /></div>
      <div><dt>Windows 10 / 11</dt>{tbd}</div>
      <div><dt>Estado</dt><dd>{statusLabel[project.devStatus] ?? '—'}{project.abandoned ? ' · abandonado' : ''}</dd></div>
      <div><dt>Archivo Windows</dt>{a ? <dd className="mono" title={a.name}>{a.name}</dd> : <dd className="tbd">ninguno</dd>}</div>
      <div><dt>Tamaño</dt>{a?.size ? <dd className="num">{fmtSize(a.size, a.sizeApprox)}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>SHA-256 publicado</dt>{a ? <Bool v={Boolean(a.sha256)} /> : <dd className="tbd">—</dd>}</div>
      <div><dt>Licencia</dt>{project.license ? <dd className="mono">{project.license}</dd> : tbd}</div>
    </dl>
  )
}

/** Descargar el ejecutable Windows de la release oficial (fase 4). */
function DownloadButton({ project, onInstall }: { project: Project; onInstall: () => void }) {
  const { items, progress, start, error, available } = useDownloads()
  const { go } = useNav()
  const lib = useLibrary()
  const inst = lib.byProject(project.slug)
  if (inst) {
    return (
      <>
        {inst.state === 'ready'
          ? <button type="button" className="btn-primary" onClick={() => liveApi.launch(inst.id)}>Ejecutar</button>
          : <button type="button" className="btn-line" onClick={() => go({ name: 'library' })}>Terminar la instalación</button>}
        <button type="button" className="link" onClick={() => go({ name: 'library' })}>En la biblioteca{inst.updateAvailable ? ' · actualización disponible' : ''}</button>
      </>
    )
  }
  const dl = items.find((d) => d.project === project.slug && d.url === project.windowsAsset?.url && d.state !== 'cancelled')
  if (project.listing !== 'library') {
    return <button type="button" className="btn-primary" disabled><IconDownload width={15} height={15} strokeWidth={2.2} />No instalable</button>
  }
  if (!available) {
    return <button type="button" className="btn-primary" disabled title="Solo en la app de escritorio"><IconDownload width={15} height={15} strokeWidth={2.2} />Descargar {project.name}</button>
  }
  if (dl && (dl.state === 'running' || dl.state === 'queued')) {
    const p = progress[dl.id]
    const total = p?.total ?? dl.total
    const pct = total ? Math.round(((p?.done ?? dl.done) / total) * 100) : null
    return (
      <button type="button" className="btn-line" onClick={() => go({ name: 'downloads' })}>
        {dl.state === 'queued' ? 'En cola…' : `Descargando${pct != null ? ` ${pct} %` : '…'}`}
      </button>
    )
  }
  if (dl && dl.state === 'done') {
    return (
      <>
        <button type="button" className="btn-primary" onClick={onInstall}>Instalar…</button>
        <span className="note-line"><span className="yes">Descargado {dl.releaseTag ?? ''}</span>{dl.verified ? ' · SHA-256 comprobado' : ''}</span>
      </>
    )
  }
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => start(project.slug)}>
        <IconDownload width={15} height={15} strokeWidth={2.2} />
        {dl?.state === 'paused' ? 'Reanudar descarga' : `Descargar ${project.name}`}
        {project.windowsAsset?.size ? <span className="btn-sub">{fmtSize(project.windowsAsset.size, project.windowsAsset.sizeApprox)}</span> : null}
      </button>
      {error && <span className="note-line err">{error}</span>}
    </>
  )
}

export function ProjectPicker({ projects, selected, onSelect }: { projects: Project[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="picker" role="radiogroup" aria-label="Implementación">
      {projects.map((p, i) => (
        <button key={p.slug} type="button" className="pick" role="radio" aria-checked={i === selected} onClick={() => onSelect(i)}>
          <span className="dot" />
          <span className="pick-main">
            <span className="name">{p.name}</span>
            {p.developers && <span className="by">{p.developers}</span>}
            {p.forkOf && <span className="by">· fork</span>}
          </span>
          <span className="kind">
            {p.hasWindowsExecutable ? <span className="yes">Windows</span> : p.takedown ? 'Retirado' : kindLabel[p.kind]}
          </span>
        </button>
      ))}
    </div>
  )
}

function Notes({ project, platform }: { project: Project; platform: string }) {
  const notes: string[] = []
  if (project.takedown) notes.push('Retirado por una reclamación de derechos (DMCA). Se muestra como referencia, no se puede instalar.')
  if (project.repoExists === false) notes.push('El repositorio ya no está disponible en GitHub.')
  if (project.repoMovedFrom) notes.push(`El repositorio se ha movido desde ${project.repoMovedFrom}.`)
  if (project.forkOf) notes.push(`Fork de ${project.forkOf}.`)
  if (platform === 'switch2')
    notes.push('Proyecto de Switch 2: juego comercial reciente, ecosistema con muchos forks y riesgo legal y de seguridad alto. Revisa el repositorio antes de descargar nada.')
  if (project.tags.includes('ai-assisted')) notes.push('Según su documentación, se desarrolla con ayuda de IA.')
  if (!notes.length) return null
  return <ul className="notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
}

/** Bloque de juego con selector de recompilador. Se usa en el destacado de Inicio y en la ficha. */
export function GameFeature({ detail, eyebrow, initialProject, linkTitle, onRefresh }: {
  detail: GameDetail; eyebrow: string; initialProject?: string; linkTitle?: boolean
  /** Comprueba en vivo la release del proyecto elegido (solo en la ficha). */
  onRefresh?: (slug: string) => Promise<string>
}) {
  const { go } = useNav()
  const { platformOf } = useCatalog()
  const { game, projects } = detail
  // Se guarda el slug y no la posición: el orden puede cambiar tras comprobar una release.
  const [selSlug, setSelSlug] = useState(initialProject)
  const sel = Math.max(0, projects.findIndex((p) => p.slug === selSlug))
  const project = projects[sel]
  const installable = projects.filter((p) => p.listing === 'library').length
  const [installing, setInstalling] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState<string | null>(null)
  const check = async () => {
    if (!onRefresh || !project) return
    setChecking(true)
    setCheckMsg(null)
    try { setCheckMsg(await onRefresh(project.slug)) } catch (e) { setCheckMsg(String(e)) } finally { setChecking(false) }
  }

  return (
    <section aria-labelledby={`t-${game.slug}`}>
      <div className="feature">
        <Cover game={game} />
        <div className="f-body">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h1 id={`t-${game.slug}`} className={`f-title${linkTitle ? ' clickable' : ''}`}
              onClick={linkTitle ? () => go({ name: 'game', slug: game.slug, project: project?.slug }) : undefined}>
              {game.title}
            </h1>
          </div>
          <div className="f-meta">
            <span>{platformOf(game.platform)?.name}</span>
            <span>{plural(projects.length, 'implementación', 'implementaciones')} · {installable} con ejecutable Windows</span>
          </div>
          {projects.length > 1 && (
            <p className="f-desc">Hay {projects.length} proyectos para este juego. <strong>Elige cuál quieres usar</strong>: cada uno tiene sus propios requisitos, su forma de instalarse y de actualizarse.</p>
          )}

          {projects.length > 0 && <ProjectPicker projects={projects} selected={sel} onSelect={(i) => setSelSlug(projects[i].slug)} />}

          {project && (
            <>
              {project.summary && <p className="f-desc">{project.summary}</p>}
              <Notes project={project} platform={project.platform} />
              <CompatSheet project={project} />
              {project.requirementsText && (
                <div className="req"><div className="eyebrow">Requisitos según el proyecto</div><p>{project.requirementsText}</p></div>
              )}
              <div className="actions">
                <DownloadButton project={project} onInstall={() => setInstalling(project.slug)} />
                <a className="link" onClick={() => openExternal(project.repoUrl)}>
                  <span className="mono">{project.repoUrl.replace(/^https?:\/\//, '')}</span>
                  <IconOut />
                </a>
                {project.release && (
                  <a className="link" onClick={() => openExternal(project.release!.url)}>Ver release {project.release.tag}<IconOut /></a>
                )}
                {onRefresh && project.repoUrl && (
                  <button type="button" className="link" disabled={checking} onClick={check}>{checking ? 'Comprobando…' : 'Comprobar release ahora'}</button>
                )}
                {project.stars != null && <span className="note-line num">★ {fmtNum(project.stars)}</span>}
              </div>
              {installing === project.slug && <InstallPanel slug={project.slug} onClose={() => setInstalling(null)} />}
              {checkMsg && <div className="note-line">{checkMsg}</div>}
              <div className="note-line">
                {project.checkedAt && <>Comprobado el {fmtDateTime(project.checkedAt)}. </>}
                {project.listing === 'library'
                  ? 'La descarga sale de la release oficial y se comprueba su SHA-256 cuando el proyecto lo publica. Antes de instalar verás el plan, y nada se ejecuta hasta que pulses «Ejecutar».'
                  : project.checkedAt == null
                    ? 'Release todavía sin comprobar. Hasta entonces no se puede instalar.'
                    : 'Su última release oficial no publica un ejecutable para Windows. Se puede consultar, pero no instalar.'}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
