import type { DevStatus, ProjectKind } from './types'
import { lang, locale, tr } from './i18n'

const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const numFmt = new Intl.NumberFormat(locale)

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
  const mb = (bytes / 1024 / 1024).toFixed(1)
  const t = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${tr(mb.replace('.', ','), mb)} MB`
  return approx ? `≈ ${t}` : t
}

export const kindLabel: Record<ProjectKind, string> = {
  static_recomp: tr('Recompilación estática', 'Static recompilation'),
  decomp_port: tr('Port basado en decompilación', 'Decompilation-based port'),
  engine_reimpl: tr('Reimplementación del motor', 'Engine reimplementation'),
  source_port: tr('Port del código fuente', 'Source port'),
  native_layer: tr('Capa nativa', 'Native layer'),
  fan_remake: tr('Remake de fans', 'Fan remake'),
  decompilation: tr('Decompilación', 'Decompilation'),
  other: tr('Otro', 'Other'),
}

export const statusLabel: Record<DevStatus, string> = {
  complete: tr('Completo', 'Complete'),
  stable: tr('Estable', 'Stable'),
  playable: tr('Jugable', 'Playable'),
  beta: 'Beta',
  experimental: 'Experimental',
  unknown: tr('Sin indicar', 'Not stated'),
}

/** Project text in the interface language (Recompendium publishes Spanish and English). */
export function summaryOf(p: { summary: string | null; summaryEn?: string | null }) {
  return lang === 'en' ? (p.summaryEn ?? p.summary) : p.summary
}

export function requirementsOf(p: { requirementsText: string | null; requirementsTextEn?: string | null }) {
  return lang === 'en' ? (p.requirementsTextEn ?? p.requirementsText) : p.requirementsText
}

const ORIGINAL_FILES_EN: Record<string, string> = {
  'ROM del juego': 'Game ROM',
  'ISO del juego': 'Game ISO',
  'Archivos del juego de Xbox 360': 'Xbox 360 game files',
}

/** Original files a project needs (short catalog text, in Spanish in the data). */
export function originalFilesLabel(s: string) {
  return lang === 'en' ? (ORIGINAL_FILES_EN[s] ?? s) : s
}

/** Console family name ("Otras" in the catalog data). */
export function familyLabel(f: string) {
  return f === 'Otras' ? tr('Otras', 'Other') : f
}

export function plural(n: number, one: string, many: string) {
  return `${fmtNum(n)} ${n === 1 ? one : many}`
}
