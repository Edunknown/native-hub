import { useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useNav } from '../app/nav'
import { ConsoleIcon } from '../components/ConsoleIcon'
import { ProjectTable } from '../components/ProjectTable'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
import { useAsync } from '../lib/useAsync'

/** Mini cards de todas las plataformas, agrupadas por familia. */
function ConsoleCards({ current }: { current?: string }) {
  const { go } = useNav()
  const { platforms, summary } = useCatalog()
  return (
    <>
      {summary.families.map((fam) => {
        const list = platforms.filter((p) => p.family === fam)
        if (!list.length) return null
        const total = list.reduce((a, p) => a + p.projectCount, 0)
        const win = list.reduce((a, p) => a + p.installableCount, 0)
        return (
          <section key={fam} className="fam">
            <div className="sec-head">
              <h2>{fam}</h2>
              <span className="aside num">{list.length} plataformas · {fmtNum(total)} proyectos · {fmtNum(win)} con Windows</span>
            </div>
            <div className="cards">
              {list.map((p) => {
                const on = p.slug === current
                return (
                  <button key={p.slug} type="button" aria-pressed={on}
                    className={`ccard${on ? ' on' : ''}${p.projectCount === 0 ? ' zero' : ''}`}
                    onClick={() => go({ name: 'consoles', platform: p.slug })}>
                    <ConsoleIcon slug={p.slug} className="ico" />
                    <span className="ccard-t">
                      <span className="nm">{p.name}</span>
                      <span className="mt num">
                        <span>{fmtNum(p.projectCount)} proy.</span>
                        <span className={p.installableCount > 0 ? 'yes-plain' : 'faint'}>{fmtNum(p.installableCount)} Win</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </>
  )
}

export function Consoles({ platform }: { platform?: string }) {
  const { platformOf } = useCatalog()
  const p = platform ? platformOf(platform) : undefined
  const projects = useAsync(() => (platform ? api.platformProjects(platform) : Promise.resolve([])), [platform])
  const [expanded, setExpanded] = useState<string | null>(null)
  const all = expanded === platform
  const PREVIEW = 8

  return (
    <main className="content tight">
      {p ? (
        <section className="csel" aria-labelledby="csel-title">
          <div className="csel-side">
            <div className="eyebrow">Consolas · {p.family}</div>
            <div className="csel-art"><ConsoleIcon slug={p.slug} size={144} strokeWidth={1.1} /></div>
          </div>
          <div className="csel-body">
            <h1 id="csel-title" className="f-title">{p.name}</h1>
            <div className="f-meta">
              <span><span className="fg num">{fmtNum(p.projectCount)}</span> proyectos</span>
              <span><span className="yes-plain num">{fmtNum(p.installableCount)}</span> con ejecutable Windows</span>
              <span>{fmtNum(p.projectCount - p.installableCount)} en desarrollo o sin ejecutable</span>
            </div>
            {projects.status === 'ok' && (
              projects.data.length > 0
                ? <>
                    <ProjectTable items={all ? projects.data : projects.data.slice(0, PREVIEW)} showPlatform={false} />
                    {projects.data.length > PREVIEW && (
                      <div><button type="button" className="link" onClick={() => setExpanded(all ? null : platform!)}>
                        {all ? 'Mostrar menos' : `Ver los ${fmtNum(projects.data.length)} proyectos de ${p.name}`}
                      </button></div>
                    )}
                  </>
                : <p className="empty">Aún no hay proyectos para {p.name}. Cuando se incorporen aparecerán aquí.</p>
            )}
          </div>
        </section>
      ) : (
        <div>
          <div className="eyebrow">Consolas</div>
          <h1 className="page-title">Todas las consolas</h1>
          <p className="page-lede">Elige una consola para ver sus recompilaciones y ports. La lista crece a medida que se incorporan proyectos nuevos.</p>
        </div>
      )}

      <ConsoleCards current={platform} />
    </main>
  )
}
