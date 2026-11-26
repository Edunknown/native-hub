import type { ProjectKind } from './types'

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  return dateFmt.format(new Date(iso))
}

export function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  return dateTimeFmt.format(new Date(iso))
}

export function fmtSize(bytes: number | null | undefined): string | null {
  if (bytes == null) return null
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

export const kindLabel: Record<ProjectKind, string> = {
  decomp_port: 'Port basado en decompilación',
  static_recomp: 'Recompilación estática',
  engine_reimpl: 'Reimplementación del motor',
  source_port: 'Port del código fuente',
  other: 'Otro',
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}
