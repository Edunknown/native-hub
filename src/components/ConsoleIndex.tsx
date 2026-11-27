import { Fragment } from 'react'
import { useCatalog } from '../app/catalog'
import { useNav } from '../app/nav'
import { familyLabel } from '../lib/format'
import { tr } from '../lib/i18n'

/** Índice de plataformas por familia. El número indica cuántos proyectos hay. */
export function ConsoleIndex({ current }: { current?: string }) {
  const { go } = useNav()
  const { platforms, summary } = useCatalog()

  return (
    <div className="consoles">
      {summary.families.map((fam) => {
        const list = platforms.filter((p) => p.family === fam)
        if (!list.length) return null
        return (
          <Fragment key={fam}>
            <h3>{familyLabel(fam)}</h3>
            <p>
              {list.map((p, i) => (
                <Fragment key={p.slug}>
                  {i > 0 && <span className="sep">/</span>}
                  <button type="button" className={p.projectCount ? undefined : 'zero'} aria-current={current === p.slug}
                    title={`${p.projectCount} ${tr('proyectos', 'projects')} · ${p.installableCount} ${tr('con ejecutable Windows', 'with a Windows executable')}`}
                    onClick={() => go({ name: 'consoles', platform: p.slug })}>
                    {p.name}{p.projectCount > 0 && <sup>{p.projectCount}</sup>}
                  </button>
                </Fragment>
              ))}
            </p>
          </Fragment>
        )
      })}
    </div>
  )
}
