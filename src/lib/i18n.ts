// Interface language. English by default; Spanish can be chosen in Settings.
// Strings are written inline as tr('español', 'English') so each text keeps both versions
// side by side. Changing the language reloads the window.

export type Lang = 'en' | 'es'
const KEY = 'nh-lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'es') return saved
  } catch { /* no storage */ }
  return 'en'
}

export const lang: Lang = initial()
export const locale = lang === 'en' ? 'en-US' : 'es-ES'

if (typeof document !== 'undefined') document.documentElement.lang = lang

/** Picks the text for the current language. */
export function tr(es: string, en: string): string {
  return lang === 'en' ? en : es
}

export function setLang(next: Lang) {
  try { localStorage.setItem(KEY, next) } catch { /* no storage */ }
  location.reload()
}
