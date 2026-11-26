import { Fragment } from 'react'
import { useNav } from '../app/nav'
import { getCatalog, inDevelopment, gameOf } from '../lib/api'
import type { PlatformFamily } from '../lib/types'

const FAMILIES: PlatformFamily[] = ['Nintendo', 'PlayStation', 'Xbox', 'Sega', 'Otras']

export function ConsoleIndex({ current, showInDev = true }: { current?: string; showInDev?: boolean }) {
  const { go } = useNav()
  const { platforms, games, projects } = getCatalog()
  const count = (slug: string) =>
    projects.filter((p) => p.listing === 'library' && games.find((g) => g.slug === p.game)?.platform === slug).length
  const dev = inDevelopment()

  return (
    <div className="consoles">
      {FAMILIES.map((fam) => {
        const list = platforms.filter((p) => p.family === fam)
        return (
          <Fragment key={fam}>
            <h3>{fam === 'Otras' ? 'Otras' : fam}</h3>
            <p>
              {list.map((p, i) => {
                const n = count(p.slug)
                return (
                  <Fragment key={p.slug}>
                    {i > 0 && <span className="sep">/</span>}
                    <button type="button" className={n ? undefined : 'zero'} aria-current={current === p.slug}
                      onClick={() => go({ name: 'consoles', platform: p.slug })}>
                      {p.name}{n > 0 && <sup>{n}</sup>}
                    </button>
                  </Fragment>
                )
              })}
            </p>
          </Fragment>
        )
      })}
      {showInDev && dev.length > 0 && (
        <>
          <h3>Proyectos en desarrollo</h3>
          <p className="muted">
            {dev.map((p, i) => (
              <Fragment key={p.slug}>
                {i > 0 && <span className="sep">/</span>}
                <button type="button" onClick={() => go({ name: 'game', slug: p.game, project: p.slug })}>
                  {p.name} · {gameOf(p.game)?.title}
                </button>
              </Fragment>
            ))}
            <br />
            <span className="note-line">Sin ejecutable Windows en su última release oficial. Se pueden consultar pero no instalar.</span>
          </p>
        </>
      )}
    </div>
  )
}
