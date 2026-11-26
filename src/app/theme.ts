import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'nh-theme'

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* sin almacenamiento */ }
  return 'dark'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initial)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(KEY, theme) } catch { /* sin almacenamiento */ }
  }, [theme])
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, setTheme: setThemeState, toggle }
}
