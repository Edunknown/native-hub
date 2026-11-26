import { useState } from 'react'
import { useNav } from '../app/nav'
import { IconDownload, IconOut } from '../app/icons'
import { openExternal, platformOf, projectsForGame } from '../lib/api'
import { fmtDate, fmtSize, kindLabel, plural } from '../lib/format'
import type { Game, Project } from '../lib/types'

function initials(title: string) {
  const words = title.replace(/^The Legend of Zelda:\s*/i, '').split(/[\s:]+/).filter((w) => /^[A-Z0-9]/.test(w))
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function Cover({ game }: { game: Game }) {
  const platform = platformOf(game.platform)
  return (
    <div className="cover" aria-hidden="true">
      <span className="plat">{platform?.name}</span>
      <span className="glyph">{initials(game.title)}</span>
      <span className="cap">Portada: pendiente de fuente oficial</span>
    </div>
  )
}

function Bool({ v, yes = 'Sí', no = 'No' }: { v: boolean; yes?: string; no?: string }) {
  return <dd className={v ? 'yes' : undefined}>{v ? yes : no}</dd>
}

export function CompatSheet({ project }: { project: Project }) {
  const r = project.release
  const req = project.requirements
  return (
    <dl className="compat" aria-label="Ficha de compatibilidad">
      <div><dt>Ejecutable Windows</dt><Bool v={project.hasWindowsExecutable} /></div>
      <div><dt>Release oficial</dt>{r ? <dd className="yes">GitHub Releases</dd> : <dd>No publicada</dd>}</div>
      <div><dt>Última versión</dt>{r ? <dd className="mono">{r.tag}</dd> : <dd className="tbd">sin release</dd>}</div>
      <div><dt>Publicada</dt>{r?.publishedAt ? <dd className="num">{fmtDate(r.publishedAt)}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>Archivos originales</dt><dd>{req.originalFiles ?? 'No'}</dd></div>
      <div><dt>Archivos extraídos</dt><dd>{req.extractedFiles ? 'Sí' : 'No'}</dd></div>
      <div><dt>Claves</dt><dd>{req.keys ? 'Sí' : 'No'}</dd></div>
      <div><dt>Compilación manual</dt><dd>{req.manualBuild ? 'Sí' : 'No'}</dd></div>
      <div><dt>Windows 10 / 11</dt><dd className="tbd">por verificar</dd></div>
      <div><dt>Tipo de release</dt>{r ? <dd>{r.prerelease ? 'Prerelease' : 'Estable según GitHub'}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>Archivo Windows</dt>{project.windowsAsset ? <dd className="mono" title={project.windowsAsset.name}>{project.windowsAsset.name}</dd> : <dd className="tbd">ninguno</dd>}</div>
      <div><dt>Tamaño</dt>{project.windowsAsset ? <dd className="num">{fmtSize(project.windowsAsset.size)}</dd> : <dd className="tbd">—</dd>}</div>
      <div><dt>SHA-256 publicado</dt>{project.windowsAsset ? <Bool v={Boolean(project.windowsAsset.sha256)} /> : <dd className="tbd">—</dd>}</div>
      <div><dt>Licencia</dt>{project.license ? <dd className="mono">{project.license}</dd> : <dd className="tbd">por verificar</dd>}</div>
    </dl>
  )
}

export function ProjectPicker({ projects, selected, onSelect }: { projects: Project[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="picker" role="radiogroup" aria-label="Implementación">
      {projects.map((p, i) => (
        <button key={p.slug} type="button" className="pick" role="radio" aria-checked={i === selected} onClick={() => onSelect(i)}>
          <span className="dot" />
          <span><span className="name">{p.name}</span><span className="by">{p.developers}</span></span>
          <span className="kind">{kindLabel[p.kind]}</span>
        </button>
      ))}
    </div>
  )
}

/** Bloque de juego con selector de recompilador. Se usa en el destacado de Inicio y en la ficha. */
export function GameFeature({ game, eyebrow, initialProject, linkTitle }: { game: Game; eyebrow: string; initialProject?: string; linkTitle?: boolean }) {
  const { go } = useNav()
  const projects = projectsForGame(game.slug)
  const start = Math.max(0, projects.findIndex((p) => p.slug === initialProject))
  const [sel, setSel] = useState(start)
  const project = projects[sel]
  const platform = platformOf(game.platform)
  const installable = projects.filter((p) => p.listing === 'library').length
  const needsFiles = project?.requirements.originalFiles

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
            <span>{platform?.name}</span>
            <span>{plural(projects.length, 'implementación', 'implementaciones')}{installable < projects.length ? ` · ${installable} instalable${installable === 1 ? '' : 's'}` : ' para PC'}</span>
            {needsFiles && <span>Requiere tu propio archivo: {needsFiles.toLowerCase()}</span>}
          </div>
          {projects.length > 1 ? (
            <p className="f-desc">{projects.length} proyectos distintos llevan este juego a PC de forma nativa. <strong>Elige cuál instalar</strong>: cada uno tiene su propio adaptador, requisitos y forma de actualizarse.</p>
          ) : (
            <p className="f-desc">Un proyecto lleva este juego a PC de forma nativa. Su ficha recoge lo que pide y de dónde sale la descarga.</p>
          )}

          {projects.length > 0 && <ProjectPicker projects={projects} selected={sel} onSelect={setSel} />}
          {project && <CompatSheet project={project} />}

          {project && (
            <div className="actions">
              <button type="button" className="btn-primary" disabled title="La instalación llega en la fase 5">
                <IconDownload width={15} height={15} strokeWidth={2.2} />
                {project.listing === 'library' ? `Instalar ${project.name}` : 'Sin ejecutable Windows'}
              </button>
              {project.repoUrl && (
                <a className="link" onClick={() => openExternal(project.repoUrl!)}>
                  <span className="mono">github.com/{project.repo.owner}/{project.repo.name}</span>
                  <IconOut />
                </a>
              )}
              {project.release && (
                <a className="link" onClick={() => openExternal(project.release!.url)}>Ver release {project.release.tag}<IconOut /></a>
              )}
            </div>
          )}
          <div className="note-line">
            {project?.listing === 'library'
              ? 'Instalación pendiente de implementar (fase 5). La descarga saldrá del repositorio oficial y nada se ejecutará sin tu confirmación.'
              : 'Este proyecto no publica un ejecutable Windows. Se puede consultar, pero no instalar.'}
          </div>
        </div>
      </div>
    </section>
  )
}
