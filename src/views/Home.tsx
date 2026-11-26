import { useNav } from '../app/nav'
import { ConsoleIndex } from '../components/ConsoleIndex'
import { GameFeature } from '../components/GameFeature'
import { ProjectRow } from '../components/ProjectRow'
import { gameOf, libraryProjects } from '../lib/api'
import { fmtDate, kindLabel } from '../lib/format'

const FEATURED = 'mm'

export function Home() {
  const { go } = useNav()
  const featured = gameOf(FEATURED)
  const lib = libraryProjects()

  const updated = [...lib]
    .filter((p) => p.release?.publishedAt)
    .sort((a, b) => b.release!.publishedAt!.localeCompare(a.release!.publishedAt!))
    .slice(0, 5)

  const newest = [...lib]
    .filter((p) => p.createdAt)
    .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!))
    .slice(0, 5)

  return (
    <main className="content">
      {featured && <GameFeature game={featured} eyebrow="Destacado" linkTitle />}

      <div className="cols">
        <section>
          <div className="sec-head"><h2>Últimos proyectos actualizados</h2><button type="button" onClick={() => go({ name: 'discover' })}>Ver todos</button></div>
          <ul className="list">
            {updated.map((p) => (
              <ProjectRow key={p.slug} project={p}
                end={<><span className="mono">{p.release!.tag}</span><span className="num">{fmtDate(p.release!.publishedAt)}</span></>} />
            ))}
          </ul>
        </section>

        <section>
          <div className="sec-head"><h2>Nuevas recompilaciones y ports</h2><button type="button" onClick={() => go({ name: 'discover' })}>Descubrir</button></div>
          {newest.length > 0 ? (
            <ul className="list">
              {newest.map((p) => (
                <ProjectRow key={p.slug} project={p}
                  sub={`${gameOf(p.game)?.title} · ${kindLabel[p.kind].toLowerCase()}`}
                  end={<><span>Repositorio creado</span><span className="num">{fmtDate(p.createdAt)}</span></>} />
              ))}
            </ul>
          ) : (
            <p className="empty">Falta la fecha de creación de los repositorios. Se rellenará en la próxima comprobación del catálogo.</p>
          )}
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
        <div className="sec-head"><h2>Explorar</h2><button type="button" onClick={() => go({ name: 'consoles' })}>Todas las consolas</button></div>
        <ConsoleIndex />
      </section>
    </main>
  )
}
