import { useState } from 'react'
import { useDownloads } from '../app/downloads'
import { useLibrary } from '../app/library'
import { InstallPanel } from './Install'
import { ReleasePicker } from './ReleasePicker'
import { CoverImage } from './CoverImage'
import { api as liveApi } from '../lib/api'
import { useCatalog } from '../app/catalog'
import { useNav } from '../app/nav'
import { IconDownload, IconOut } from '../app/icons'
import { openExternal } from '../lib/api'
import { fmtDate, fmtDateTime, fmtNum, fmtSize, kindLabel, originalFilesLabel, plural, requirementsOf, statusLabel, summaryOf } from '../lib/format'
import type { AdapterTest, Game, GameDetail, Project } from '../lib/types'
import { lang, tr } from '../lib/i18n'
import { ErrorNote } from './ErrorNote'

function initials(title: string) {
  const words = title.replace(/^The Legend of Zelda:\s*/i, '').split(/[\s:]+/).filter((w) => /^[\p{Lu}0-9]/u.test(w))
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || title.slice(0, 2).toUpperCase()
}

/** Portada de IGDB sobre la portada tipográfica, que queda debajo si la imagen no carga. */
export function Cover({ game }: { game: Game }) {
  const { platformOf } = useCatalog()
  return (
    <div className="cover" aria-hidden="true">
      <span className="plat">{platformOf(game.platform)?.name}{game.year ? ` · ${game.year}` : ''}</span>
      <span className="glyph">{initials(game.title)}</span>
      <span className="cap">{game.cover ? tr('Cargando portada…', 'Loading cover…') : tr('Sin portada', 'No cover')}</span>
      <CoverImage id={game.cover} size="big" className="cover-img" />
    </div>
  )
}

const tbd = <dd className="tbd">{tr('por verificar', 'to be verified')}</dd>
function Bool({ v }: { v: boolean | null | undefined }) {
  if (v == null) return tbd
  return <dd className={v ? 'yes' : undefined}>{v ? tr('Sí', 'Yes') : 'No'}</dd>
}

/** Most relevant test: the newest if it found problems, otherwise the newest played, otherwise the newest install. */
function bestTest(project: Project): AdapterTest | null {
  const tests = [...(project.adapter?.tested ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  if (tests[0]?.status === 'issues') return tests[0]
  return tests.find((t) => t.status === 'played')
    ?? tests.find((t) => t.status === 'install')
    ?? null
}

function TestStatus({ project }: { project: Project }) {
  const t = bestTest(project)
  if (!project.adapter) return <dd className="tbd">{tr('Sin adaptador revisado', 'No reviewed adapter')}</dd>
  if (!t) return <dd className="tbd">{tr('Sin probar todavía', 'Not tested yet')}</dd>
  const notes = lang === 'en' ? (t.notesEn ?? t.notes) : t.notes
  const label = t.status === 'played'
    ? tr('Jugado', 'Played')
    : t.status === 'install' ? tr('Se instala y arranca su ejecutable', 'Installs, executable found') : tr('Con problemas', 'Has problems')
  return (
    <dd className={t.status === 'issues' ? 'err' : t.status === 'played' ? 'yes' : undefined} title={notes ?? undefined}>
      {label} <span className="mono">{t.version}</span> <span className="muted num">· {fmtDate(t.date)}</span>
    </dd>
  )
}

function WindowsTested({ project }: { project: Project }) {
  const played = (project.adapter?.tested ?? []).filter((t) => t.status === 'played' && (t.os === 'win10' || t.os === 'win11'))
  if (!played.length) return tbd
  const oses = [...new Set(played.map((t) => (t.os === 'win10' ? 'Windows 10' : 'Windows 11')))].sort().join(', ')
  return <dd className="yes">{tr('Probado en', 'Tested on')} {oses}</dd>
}

export function CompatSheet({ project }: { project: Project }) {
  const r = project.release
  const req = project.requirements
  const a = project.windowsAsset
  return (
    <dl className="compat" aria-label={tr('Ficha de compatibilidad', 'Compatibility sheet')}>
      <div><dt>{tr('Ejecutable Windows', 'Windows executable')}</dt><Bool v={project.hasWindowsExecutable} /></div>
      <div><dt>{tr('Release oficial', 'Official release')}</dt>{project.checkedAt == null ? tbd : r ? <dd className="yes">GitHub Releases</dd> : <dd>{tr('No publicada', 'Not published')}</dd>}</div>
      <div><dt>{tr('Última versión', 'Latest version')}</dt>{r ? <dd className="mono">{r.tag}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>{tr('Publicada', 'Published')}</dt>{r?.publishedAt ? <dd className="num">{fmtDate(r.publishedAt)}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>{tr('Archivos originales', 'Original files')}</dt>{req?.originalFiles ? <dd>{originalFilesLabel(req.originalFiles)}</dd> : project.requirementsText ? <dd>{tr('Sí, ver requisitos', 'Yes, see requirements')}</dd> : tbd}</div>
      <div><dt>{tr('Archivos extraídos', 'Extracted files')}</dt><Bool v={req?.extractedFiles} /></div>
      <div><dt>{tr('Claves', 'Keys')}</dt><Bool v={req?.keys} /></div>
      <div><dt>{tr('Compilación manual', 'Manual build')}</dt><Bool v={req?.manualBuild} /></div>
      <div><dt>Windows 10 / 11</dt><WindowsTested project={project} /></div>
      <div className="wide"><dt>{tr('Prueba de NATIVE HUB', 'NATIVE HUB test')}</dt><TestStatus project={project} /></div>
      <div><dt>{tr('Estado', 'Status')}</dt><dd>{statusLabel[project.devStatus] ?? '—'}{project.abandoned ? tr(' · abandonado', ' · abandoned') : ''}</dd></div>
      <div><dt>{tr('Archivo Windows', 'Windows file')}</dt>{a ? <dd className="mono" title={a.name}>{a.name}</dd> : <dd className="tbd">{tr('ninguno', 'none')}</dd>}</div>
      <div><dt>{tr('Tamaño', 'Size')}</dt>{a?.size ? <dd className="num">{fmtSize(a.size, a.sizeApprox)}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>{tr('SHA-256 publicado', 'SHA-256 published')}</dt>{a ? <Bool v={Boolean(a.sha256)} /> : <dd className="tbd">—</dd>}</div>
      <div><dt>{tr('Licencia', 'License')}</dt>{project.license ? <dd className="mono">{project.license}</dd> : tbd}</div>
    </dl>
  )
}

/** Descargar el ejecutable Windows de la release oficial (fase 4). */
function DownloadButton({ project, onInstall, onChoose }: { project: Project; onInstall: () => void; onChoose: () => void }) {
  const { items, progress, start, error, available } = useDownloads()
  const { go } = useNav()
  const lib = useLibrary()
  const inst = lib.byProject(project.slug)
  if (inst) {
    return (
      <>
        {inst.state === 'ready'
          ? <button type="button" className="btn-primary" onClick={() => liveApi.launch(inst.id)}>{tr('Ejecutar', 'Launch')}</button>
          : <button type="button" className="btn-line" onClick={() => go({ name: 'library' })}>{tr('Terminar la instalación', 'Finish installing')}</button>}
        <button type="button" className="link" onClick={() => go({ name: 'library' })}>{tr('En la biblioteca', 'In your library')}{inst.updateAvailable ? tr(' · actualización disponible', ' · update available') : ''}</button>
      </>
    )
  }
  const mine = items.filter((d) => d.project === project.slug && d.state !== 'cancelled')
  const dl = mine.find((d) => d.state === 'running' || d.state === 'queued') ?? mine.find((d) => d.state === 'done') ?? mine.find((d) => d.url === project.windowsAsset?.url)
  const choose = available && project.repoUrl && !project.takedown
    ? <button type="button" className="link" onClick={onChoose}>{tr('Elegir versión y archivo…', 'Choose version and file…')}</button>
    : null
  if (project.listing !== 'library' && !(dl && dl.state === 'done')) {
    return (
      <>
        <button type="button" className="btn-primary" disabled><IconDownload width={15} height={15} strokeWidth={2.2} />{tr('Sin ejecutable recomendado', 'No recommended executable')}</button>
        {choose}
      </>
    )
  }
  if (!available) {
    return <button type="button" className="btn-primary" disabled title={tr('Solo en la app de escritorio', 'Desktop app only')}><IconDownload width={15} height={15} strokeWidth={2.2} />{tr('Descargar', 'Download')} {project.name}</button>
  }
  if (dl && (dl.state === 'running' || dl.state === 'queued')) {
    const p = progress[dl.id]
    const total = p?.total ?? dl.total
    const pct = total ? Math.round(((p?.done ?? dl.done) / total) * 100) : null
    return (
      <button type="button" className="btn-line" onClick={() => go({ name: 'downloads' })}>
        {dl.state === 'queued' ? tr('En cola…', 'Queued…') : `${tr('Descargando', 'Downloading')}${pct != null ? ` ${pct} %` : '…'}`}
      </button>
    )
  }
  if (dl && dl.state === 'done') {
    return (
      <>
        <button type="button" className="btn-primary" onClick={onInstall}>{tr('Instalar…', 'Install…')}</button>
        <span className="note-line"><span className="yes">{tr('Descargado', 'Downloaded')} {dl.assetName ?? ''} {dl.releaseTag ?? ''}</span>{dl.verified ? tr(' · SHA-256 comprobado', ' · SHA-256 verified') : ''}</span>
        {choose}
      </>
    )
  }
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => start(project.slug)}>
        <IconDownload width={15} height={15} strokeWidth={2.2} />
        {dl?.state === 'paused' ? tr('Reanudar descarga', 'Resume download') : `${tr('Descargar', 'Download')} ${project.name}`}
        {project.windowsAsset?.size ? <span className="btn-sub">{fmtSize(project.windowsAsset.size, project.windowsAsset.sizeApprox)}</span> : null}
      </button>
      {choose}
      {dl?.state === 'failed' && <span className="note-line err">{dl.error?.startsWith('ANTIVIRUS: ') ? tr('La última descarga la bloqueó el antivirus. Mira Descargas para más detalles.', 'Your antivirus blocked the last download. See Downloads for details.') : `${tr('La última descarga falló', 'The last download failed')}: ${dl.error ?? ''}`}</span>}
      {error && <ErrorNote error={error} />}
    </>
  )
}

export function ProjectPicker({ projects, selected, onSelect }: { projects: Project[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="picker" role="radiogroup" aria-label={tr('Implementación', 'Implementation')}>
      {projects.map((p, i) => (
        <button key={p.slug} type="button" className="pick" role="radio" aria-checked={i === selected} onClick={() => onSelect(i)}>
          <span className="dot" />
          <span className="pick-main">
            <span className="name">{p.name}</span>
            {p.developers && <span className="by">{p.developers}</span>}
            {p.forkOf && <span className="by">· fork</span>}
          </span>
          <span className="kind">
            {p.hasWindowsExecutable ? <span className="yes">Windows</span> : p.takedown ? tr('Retirado', 'Taken down') : kindLabel[p.kind]}
          </span>
        </button>
      ))}
    </div>
  )
}

function Notes({ project, platform }: { project: Project; platform: string }) {
  const notes: string[] = []
  if (project.takedown) notes.push(tr('Retirado por una reclamación de derechos (DMCA). Se muestra como referencia, no se puede instalar.', 'Taken down after a copyright claim (DMCA). Shown for reference; it cannot be installed.'))
  if (project.repoExists === false) notes.push(tr('El repositorio ya no está disponible en GitHub.', 'The repository is no longer available on GitHub.'))
  if (project.repoMovedFrom) notes.push(`${tr('El repositorio se ha movido desde', 'The repository moved from')} ${project.repoMovedFrom}.`)
  if (project.forkOf) notes.push(`${tr('Fork de', 'Fork of')} ${project.forkOf}.`)
  if (platform === 'switch2')
    notes.push(tr('Proyecto de Switch 2: juego comercial reciente, ecosistema con muchos forks y riesgo legal y de seguridad alto. Revisa el repositorio antes de descargar nada.', 'Switch 2 project: a recent commercial game, an ecosystem with many forks and high legal and security risk. Review the repository before downloading anything.'))
  if (project.tags.includes('ai-assisted')) notes.push(tr('Según su documentación, se desarrolla con ayuda de IA.', 'According to its documentation, it is developed with AI assistance.'))
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
  const [picking, setPicking] = useState<string | null>(null)
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
            <span>{plural(projects.length, tr('implementación', 'implementation'), tr('implementaciones', 'implementations'))} · {installable} {tr('con ejecutable Windows', 'with a Windows executable')}</span>
          </div>
          {projects.length > 1 && (
            <p className="f-desc">{tr('Hay', 'There are')} {projects.length} {tr('proyectos para este juego.', 'projects for this game.')} <strong>{tr('Elige cuál quieres usar', 'Choose which one to use')}</strong>{tr(': cada uno tiene sus propios requisitos, su forma de instalarse y de actualizarse.', ': each has its own requirements and its own way to install and update.')}</p>
          )}

          {projects.length > 0 && <ProjectPicker projects={projects} selected={sel} onSelect={(i) => setSelSlug(projects[i].slug)} />}

          {project && (
            <>
              {summaryOf(project) && <p className="f-desc">{summaryOf(project)}</p>}
              <Notes project={project} platform={project.platform} />
              <CompatSheet project={project} />
              {project.requirementsText && (
                <div className="req"><div className="eyebrow">{tr('Requisitos según el proyecto', 'Requirements according to the project')}</div><p>{requirementsOf(project)}</p></div>
              )}
              <div className="actions">
                <DownloadButton project={project} onInstall={() => { setPicking(null); setInstalling(project.slug) }} onChoose={() => { setInstalling(null); setPicking(project.slug) }} />
                <a className="link" onClick={() => openExternal(project.repoUrl)}>
                  <span className="mono">{project.repoUrl.replace(/^https?:\/\//, '')}</span>
                  <IconOut />
                </a>
                {project.release && (
                  <a className="link" onClick={() => openExternal(project.release!.url)}>{tr('Ver release', 'View release')} {project.release.tag}<IconOut /></a>
                )}
                {onRefresh && project.repoUrl && (
                  <button type="button" className="link" disabled={checking} onClick={check}>{checking ? tr('Comprobando…', 'Checking…') : tr('Comprobar release ahora', 'Check release now')}</button>
                )}
                {project.stars != null && <span className="note-line num">★ {fmtNum(project.stars)}</span>}
              </div>
              {installing === project.slug && <InstallPanel slug={project.slug} onClose={() => setInstalling(null)} />}
              {picking === project.slug && <ReleasePicker slug={project.slug} onClose={() => setPicking(null)} />}
              {checkMsg && <div className="note-line">{checkMsg}</div>}
              <div className="note-line">
                {project.checkedAt && <>{tr('Comprobado el', 'Checked on')} {fmtDateTime(project.checkedAt)}. </>}
                {project.listing === 'library'
                  ? tr('La descarga sale de la release oficial y se comprueba su SHA-256 cuando el proyecto lo publica. Antes de instalar verás el plan, y nada se ejecuta hasta que pulses «Ejecutar».', 'The download comes from the official release and its SHA-256 is checked when the project publishes one. You will see the plan before installing, and nothing runs until you press "Launch".')
                  : project.checkedAt == null
                    ? tr('Release todavía sin comprobar. Hasta entonces no se puede instalar.', 'Release not checked yet. It cannot be installed until then.')
                    : tr('Su última release oficial no publica un ejecutable para Windows. Se puede consultar, pero no instalar.', 'Its latest official release does not publish a Windows executable. You can browse it, but not install it.')}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
