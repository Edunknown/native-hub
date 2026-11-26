// Vistas cuya funcionalidad todavía no existe. Dicen claramente en qué fase llegan.
import type { ReactNode } from 'react'
import { useNav } from '../app/nav'

function Pending({ eyebrow, title, lede, phase, children }: { eyebrow: string; title: string; lede: string; phase: string; children?: ReactNode }) {
  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-lede">{lede}</p>
      </div>
      <section>
        <div className="sec-head"><h2>Estado</h2><span className="aside">{phase}</span></div>
        {children}
      </section>
    </main>
  )
}

export function Library() {
  const { go } = useNav()
  return (
    <Pending eyebrow="Biblioteca" title="Tus proyectos instalados" phase="Fase 6"
      lede="Aquí podrás ejecutar, actualizar, desinstalar, cambiar el ejecutable y ver la carpeta de cada proyecto instalado. Separado del catálogo: solo lo que está en tu PC.">
      <p className="empty">Todavía no hay nada instalado. <strong>Instalar y ejecutar no está implementado aún.</strong> Mientras tanto puedes revisar qué pide cada proyecto en el <button type="button" className="link" onClick={() => go({ name: 'discover' })}>catálogo</button>.</p>
    </Pending>
  )
}

export function Updates() {
  return (
    <Pending eyebrow="Actualizaciones" title="Actualizaciones" phase="Fase 3 y 6"
      lede="Nuevas versiones, releases retiradas, cambios importantes y proyectos abandonados. Cada actualización se revisa antes de aplicarse; nada se sustituye sin tu permiso.">
      <p className="empty">La detección de versiones nuevas frente a lo instalado no está implementada. Hoy el catálogo se comprueba con un script que revisa la última release de cada proyecto en GitHub.</p>
    </Pending>
  )
}

export function Downloads() {
  return (
    <Pending eyebrow="Descargas" title="Descargas" phase="Fase 4"
      lede="Descargas directas desde la release oficial, interrumpibles y reanudables, con comprobación SHA-256 cuando el proyecto publica el hash.">
      <p className="empty">No hay descargas. El gestor de descargas todavía no está implementado.</p>
    </Pending>
  )
}
