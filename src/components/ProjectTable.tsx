import { useCatalog } from '../app/catalog'
import { useNav } from '../app/nav'
import { fmtDate, kindLabel } from '../lib/format'
import type { Project } from '../lib/types'
import { ExeFlag } from './ProjectRow'
import { tr } from '../lib/i18n'

/** Tabla técnica de proyectos (Descubrir y Consolas). */
export function ProjectTable({ items, showPlatform = true }: { items: Project[]; showPlatform?: boolean }) {
  const { go } = useNav()
  const { platformOf } = useCatalog()
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{tr('Juego', 'Game')}</th><th>{tr('Proyecto', 'Project')}</th>{showPlatform && <th>{tr('Consola', 'Console')}</th>}<th>{tr('Tipo', 'Type')}</th><th>{tr('Última release', 'Latest release')}</th><th className="r">Windows</th>
        </tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.slug} className="click" onClick={() => go({ name: 'game', slug: p.game, project: p.slug })}>
            <td>{p.gameTitle}</td>
            <td>{p.name}{p.developers && <span className="muted"> · {p.developers}</span>}</td>
            {showPlatform && <td className="muted">{platformOf(p.platform)?.name}</td>}
            <td className="muted">{kindLabel[p.kind]}</td>
            <td>{p.release ? <><span className="mono">{p.release.tag}</span> <span className="muted num">· {fmtDate(p.release.publishedAt)}</span></> : <span className="tbd">{tr('sin release', 'no release')}</span>}</td>
            <td className="r"><ExeFlag project={p} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
