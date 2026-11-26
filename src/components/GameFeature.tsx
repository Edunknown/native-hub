import { useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useNav } from '../app/nav'
import { IconDownload, IconOut } from '../app/icons'
import { openExternal } from '../lib/api'
import { fmtDate, fmtNum, fmtSize, kindLabel, plural, statusLabel } from '../lib/format'
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
export function GameFeature({ detail, eyebrow, initialProject, linkTitle }: { detail: GameDetail; eyebrow: string; initialProject?: string; linkTitle?: boolean }) {
  const { go } = useNav()
  const { platformOf } = useCatalog()
  const { game, projects } = detail
  const start = Math.max(0, projects.findIndex((p) => p.slug === initialProject))
  const [sel, setSel] = useState(start)
  const project = projects[sel]
  const installable = projects.filter((p) => p.listing === 'library').length

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

          {projects.length > 0 && <ProjectPicker projects={projects} selected={sel} onSelect={setSel} />}

          {project && (
            <>
              {project.summary && <p className="f-desc">{project.summary}</p>}
              <Notes project={project} platform={project.platform} />
              <CompatSheet project={project} />
              {project.requirementsText && (
                <div className="req"><div className="eyebrow">Requisitos según el proyecto</div><p>{project.requirementsText}</p></div>
              )}
              <div className="actions">
                <button type="button" className="btn-primary" disabled title="La instalación llega en la fase 5">
                  <IconDownload width={15} height={15} strokeWidth={2.2} />
                  {project.listing === 'library' ? `Instalar ${project.name}` : 'No instalable'}
                </button>
                <a className="link" onClick={() => openExternal(project.repoUrl)}>
                  <span className="mono">{project.repoUrl.replace(/^https?:\/\//, '')}</span>
                  <IconOut />
                </a>
                {project.release && (
                  <a className="link" onClick={() => openExternal(project.release!.url)}>Ver release {project.release.tag}<IconOut /></a>
                )}
                {project.stars != null && <span className="note-line num">★ {fmtNum(project.stars)}</span>}
              </div>
              <div className="note-line">
                {project.listing === 'library'
                  ? 'Instalación pendiente de implementar (fase 5). La descarga saldrá del repositorio oficial y nada se ejecutará sin tu confirmación.'
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
