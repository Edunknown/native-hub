import type { ReactNode } from 'react'
import { useNav } from '../app/nav'
import { gameOf, platformOf } from '../lib/api'
import type { Project } from '../lib/types'

/** Fila editorial: miniatura de plataforma, juego/proyecto y un dato a la derecha. */
export function ProjectRow({ project, title, sub, end }: { project: Project; title?: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  const { go } = useNav()
  const game = gameOf(project.game)
  const platform = game ? platformOf(game.platform) : undefined
  return (
    <li>
      <button type="button" className="row" onClick={() => go({ name: 'game', slug: project.game, project: project.slug })}>
        <span className="thumb">{platform?.short ?? platform?.name}</span>
        <span className="t">
          <div className="game">{title ?? project.name}</div>
          <div className="sub">{sub ?? `${game?.title} · ${project.developers}`}</div>
        </span>
        <span className="end">{end}</span>
      </button>
    </li>
  )
}
