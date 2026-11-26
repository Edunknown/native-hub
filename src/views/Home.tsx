import { useNav } from '../app/nav'
import { ConsoleIndex } from '../components/ConsoleIndex'
import { GameFeature } from '../components/GameFeature'
import { ProjectRow } from '../components/ProjectRow'
import { api } from '../lib/api'
import { fmtDate, kindLabel } from '../lib/format'
import { useAsync } from '../lib/useAsync'

export function Home() {
  const { go } = useNav()
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
          <p className="empty">Todavía no hay nada instalado. <strong>La instalación llega en la fase 5</strong>; aquí aparecerán tus proyectos con su versión y su carpeta.</p>
        </section>
        <section>
          <div className="sec-head"><h2>Pendientes de configuración</h2></div>
          <p className="empty">Nada pendiente. Cuando un proyecto descargado necesite tu ROM, ISO o archivos del juego, aparecerá aquí para que los localices.</p>
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
