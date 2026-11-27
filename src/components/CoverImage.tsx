import { useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '../lib/api'

// Portadas de IGDB. El catálogo guarda solo el image_id; en la app la imagen se pide al
// protocolo cover://, que la sirve desde la caché local o la descarga una vez de
// images.igdb.com. En el navegador (npm run dev) se carga directamente de IGDB.

export type CoverSize = 'small' | 'big'

const igdbSize = (size: CoverSize, retina: boolean) => `t_cover_${size}${retina ? '_2x' : ''}`

function coverSrc(imageId: string, size: CoverSize, retina = false) {
  const s = igdbSize(size, retina)
  return isTauri ? convertFileSrc(`${s}/${imageId}`, 'cover') : `https://images.igdb.com/igdb/image/upload/${s}/${imageId}.jpg`
}

/**
 * Imagen de portada. Si no hay portada o no se puede cargar (sin conexión y sin caché),
 * no pinta nada y deja ver lo que haya debajo (la portada tipográfica o el icono).
 */
export function CoverImage({ id, size, className }: { id: string | null | undefined; size: CoverSize; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!id || failed === id) return null
  return (
    <img
      className={className}
      src={coverSrc(id, size)}
      srcSet={`${coverSrc(id, size)} 1x, ${coverSrc(id, size, true)} 2x`}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(id)}
    />
  )
}
