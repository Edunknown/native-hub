import { useLibrary } from '../app/library'
import { useNav } from '../app/nav'
import { ConsoleIndex } from '../components/ConsoleIndex'
import { GameFeature } from '../components/GameFeature'
import { ProjectRow } from '../components/ProjectRow'
import { api } from '../lib/api'
import { fmtDate, kindLabel } from '../lib/format'
import { useAsync } from '../lib/useAsync'

export function Home() {
  const { go } = useNav()
  const lib = useLibrary()
  const home = useAsync(() => api.home(), [])
  if (home.status !== 'ok') return <main className="content"><p className="empty">{home.status === 'error' ? home.error : 'Cargando…'}</p></main>
  const { featured, updated, newest } = home.data

  return (
    <main className="content">
      {featured && <GameFeature detail={featured} eyebrow="Destacado" linkTitle />}

      <div className="cols">
        <section>
          <div className="sec-head"><h2>Últimas releases con ejecutable Windows</h2><button type="button" onClick={() => go({ name: 'discover' })}>Ver todos</button></div>
          <ul className="list">
            {updated.map((p) => (
              <ProjectRow key={p.slug} project={p}
                end={<><span className="mono">{p.release!.tag}</span><span className="num">{fmtDate(p.release!.publishedAt)}</span></>} />
            ))}
          </ul>
        </section>

        <section>
          <div className="sec-head"><h2>Nuevas recompilaciones y ports</h2><button type="button" onClick={() => go({ name: 'discover' })}>Descubrir</button></div>
          <ul className="list">
            {newest.map((p) => (
              <ProjectRow key={p.slug} project={p}
                sub={`${p.gameTitle} · ${kindLabel[p.kind].toLowerCase()}`}
                end={<><span>Repositorio creado</span><span className="num">{fmtDate(p.createdAt)}</span></>} />
            ))}
          </ul>
        </section>
      </div>

      <div className="cols">
        <section>
          <div className="sec-head"><h2>Instalados</h2><button type="button" onClick={() => go({ name: 'library' })}>Abrir biblioteca</button></div>
          {lib.items.filter((i) => i.state === 'ready').length === 0 ? (
            <p className="empty">Todavía no hay nada instalado. Descarga un proyecto desde su ficha y pulsa «Instalar…».</p>
          ) : (
            <ul className="list">
              {lib.items.filter((i) => i.state === 'ready').slice(0, 5).map((i) => (
                <ProjectRow key={i.id} project={i.projectData}
                  sub={<>{i.projectData.name} · <span className="mono">{i.installDir}</span></>}
                  end={<>{i.updateAvailable && <span className="flag">Actualización</span>}<span className="mono">{i.releaseTag}</span></>} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="sec-head"><h2>Pendientes de configuración</h2></div>
          {lib.items.filter((i) => i.state !== 'ready').length === 0 ? (
            <p className="empty">Nada pendiente. Cuando una instalación necesite un paso tuyo (elegir el ejecutable, abrir un instalador), aparecerá aquí.</p>
          ) : (
            <ul className="list">
              {lib.items.filter((i) => i.state !== 'ready').map((i) => (
                <ProjectRow key={i.id} project={i.projectData} end={<span className="warn">Falta un paso</span>} />
              ))}
            </ul>
          )}
          <p className="devnote">NATIVE HUB no incluye ni descarga ROMs, ISOs, BIOS ni claves. Te ayuda a localizar tus propios archivos y comprueba que son los que pide cada proyecto.</p>
        </section>
      </div>

      <section>
        <div className="sec-head"><h2>Explorar por consola</h2><button type="button" onClick={() => go({ name: 'consoles' })}>Todas las consolas</button></div>
        <ConsoleIndex />
      </section>
    </main>
  )
}
