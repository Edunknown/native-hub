import type { ReactNode } from 'react'
import { useCatalog } from '../app/catalog'
import { useNav } from '../app/nav'
import type { Project } from '../lib/types'
import { ConsoleIcon } from './ConsoleIcon'
import { tr } from '../lib/i18n'

/** Fila editorial: silueta de la consola, juego/proyecto y un dato a la derecha. */
export function ProjectRow({ project, title, sub, end }: { project: Project; title?: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  const { go } = useNav()
  const { platformOf } = useCatalog()
  const platform = platformOf(project.platform)
  return (
    <li>
      <button type="button" className="row" onClick={() => go({ name: 'game', slug: project.game, project: project.slug })}>
        <span className="thumb" title={platform?.name}>
          <ConsoleIcon slug={project.platform} size={30} strokeWidth={1.6} />
          <span>{platform?.short ?? platform?.name}</span>
        </span>
        <span className="t">
          <div className="game">{title ?? project.name}</div>
          <div className="sub">
            {sub ?? <>{project.gameTitle} · <span className="plat-name">{platform?.name}</span>{project.developers ? ` · ${project.developers}` : ''}</>}
          </div>
        </span>
        <span className="end">{end}</span>
      </button>
    </li>
  )
}

/** Dato de la derecha más habitual: si hay ejecutable Windows o no. */
export function ExeFlag({ project }: { project: Project }) {
  if (project.takedown) return <span>{tr('Retirado (DMCA)', 'Taken down (DMCA)')}</span>
  if (project.repoExists === false) return <span>{tr('Repositorio no disponible', 'Repository unavailable')}</span>
  if (project.hasWindowsExecutable) return <span className="yes">{tr('Ejecutable Windows', 'Windows executable')}</span>
  if (project.hasWindowsExecutable === false) return <span>{project.release ? tr('Sin ejecutable Windows', 'No Windows executable') : tr('Sin release', 'No release')}</span>
  return <span className="tbd">{tr('por verificar', 'to be verified')}</span>
}
