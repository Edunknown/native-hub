import { useLibrary } from '../app/library'
import { useNav } from '../app/nav'
import { ConsoleIndex } from '../components/ConsoleIndex'
import { GameFeature } from '../components/GameFeature'
import { ProjectRow } from '../components/ProjectRow'
import { api } from '../lib/api'
import { fmtDate, kindLabel } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { tr } from '../lib/i18n'

export function Home() {
  const { go } = useNav()
  const lib = useLibrary()
  const home = useAsync(() => api.home(), [])
  if (home.status !== 'ok') return <main className="content"><p className="empty">{home.status === 'error' ? home.error : tr('Cargando…', 'Loading…')}</p></main>
  const { featured, updated, newest } = home.data

  return (
    <main className="content">
      {featured && <GameFeature detail={featured} eyebrow={tr('Destacado', 'Featured')} linkTitle />}

      <div className="cols">
        <section>
          <div className="sec-head"><h2>{tr('Últimas releases con ejecutable Windows', 'Latest releases with a Windows executable')}</h2><button type="button" onClick={() => go({ name: 'discover' })}>{tr('Ver todos', 'See all')}</button></div>
          <ul className="list">
            {updated.map((p) => (
              <ProjectRow key={p.slug} project={p}
                end={<><span className="mono">{p.release!.tag}</span><span className="num">{fmtDate(p.release!.publishedAt)}</span></>} />
            ))}
          </ul>
        </section>

        <section>
          <div className="sec-head"><h2>{tr('Nuevas recompilaciones y ports', 'New recompilations and ports')}</h2><button type="button" onClick={() => go({ name: 'discover' })}>{tr('Descubrir', 'Discover')}</button></div>
          <ul className="list">
            {newest.map((p) => (
              <ProjectRow key={p.slug} project={p}
                sub={`${p.gameTitle} · ${kindLabel[p.kind].toLowerCase()}`}
                end={<><span>{tr('Repositorio creado', 'Repository created')}</span><span className="num">{fmtDate(p.createdAt)}</span></>} />
            ))}
          </ul>
        </section>
      </div>

      <div className="cols">
        <section>
          <div className="sec-head"><h2>{tr('Instalados', 'Installed')}</h2><button type="button" onClick={() => go({ name: 'library' })}>{tr('Abrir biblioteca', 'Open library')}</button></div>
          {lib.items.filter((i) => i.state === 'ready').length === 0 ? (
            <p className="empty">{tr('Todavía no hay nada instalado. Descarga un proyecto desde su ficha y pulsa «Instalar…».', 'Nothing installed yet. Download a project from its page and press "Install…".')}</p>
          ) : (
            <ul className="list">
              {lib.items.filter((i) => i.state === 'ready').slice(0, 5).map((i) => (
                <ProjectRow key={i.id} project={i.projectData}
                  sub={<>{i.projectData.name} · <span className="mono">{i.installDir}</span></>}
                  end={<>{i.updateAvailable && <span className="flag">{tr('Actualización', 'Update')}</span>}<span className="mono">{i.releaseTag}</span></>} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="sec-head"><h2>{tr('Pendientes de configuración', 'Waiting for setup')}</h2></div>
          {lib.items.filter((i) => i.state !== 'ready').length === 0 ? (
            <p className="empty">{tr('Nada pendiente. Cuando una instalación necesite un paso tuyo (elegir el ejecutable, abrir un instalador), aparecerá aquí.', 'Nothing pending. When an install needs a step from you (choosing the executable, running an installer), it will show up here.')}</p>
          ) : (
            <ul className="list">
              {lib.items.filter((i) => i.state !== 'ready').map((i) => (
                <ProjectRow key={i.id} project={i.projectData} end={<span className="warn">{tr('Falta un paso', 'One step left')}</span>} />
              ))}
            </ul>
          )}
          <p className="devnote">{tr('NATIVE HUB no incluye ni descarga ROMs, ISOs, BIOS ni claves. Te ayuda a localizar tus propios archivos y comprueba que son los que pide cada proyecto.', 'NATIVE HUB does not include or download ROMs, ISOs, BIOS or keys. It helps you locate your own files and checks they are what each project requires.')}</p>
        </section>
      </div>

      <section>
        <div className="sec-head"><h2>{tr('Explorar por consola', 'Browse by console')}</h2><button type="button" onClick={() => go({ name: 'consoles' })}>{tr('Todas las consolas', 'All consoles')}</button></div>
        <ConsoleIndex />
      </section>
    </main>
  )
}
