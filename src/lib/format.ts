import type { DevStatus, ProjectKind } from './types'

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const numFmt = new Intl.NumberFormat('es-ES')

export function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  return dateFmt.format(new Date(iso))
}

export function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  return dateTimeFmt.format(new Date(iso))
}

export function fmtNum(n: number) {
  return numFmt.format(n)
}

export function fmtSize(bytes: number | null | undefined, approx = false): string | null {
  if (bytes == null) return null
  const t = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
  return approx ? `≈ ${t}` : t
}

export const kindLabel: Record<ProjectKind, string> = {
  static_recomp: 'Recompilación estática',
  decomp_port: 'Port basado en decompilación',
  engine_reimpl: 'Reimplementación del motor',
  source_port: 'Port del código fuente',
  native_layer: 'Capa nativa',
  fan_remake: 'Remake de fans',
  decompilation: 'Decompilación',
  other: 'Otro',
}

export const statusLabel: Record<DevStatus, string> = {
  complete: 'Completo',
  stable: 'Estable',
  playable: 'Jugable',
  beta: 'Beta',
  experimental: 'Experimental',
  unknown: 'Sin indicar',
}

export function plural(n: number, one: string, many: string) {
  return `${fmtNum(n)} ${n === 1 ? one : many}`
}
