// Iconos de trazo fino, sin contenedor. 24×24, heredan currentColor.
import type { SVGProps } from 'react'

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const
type P = SVGProps<SVGSVGElement>

export const IconHome = (p: P) => (<svg {...base} {...p}><path d="M4 11l8-6 8 6v8H4z" /><path d="M10 19v-5h4v5" /></svg>)
export const IconLibrary = (p: P) => (<svg {...base} {...p}><path d="M5 4v16M9.5 4v16M14 5l4.5 15" /></svg>)
export const IconDiscover = (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="8" /><path d="M15 9l-2 4-4 2 2-4z" /></svg>)
export const IconConsoles = (p: P) => (<svg {...base} {...p}><path d="M7 9h10a4 4 0 0 1 0 8c-1.5 0-2.3-1-3-2h-4c-.7 1-1.5 2-3 2a4 4 0 0 1 0-8z" /><path d="M8 11.5v3M6.5 13h3" /></svg>)
export const IconUpdates = (p: P) => (<svg {...base} {...p}><path d="M19 12a7 7 0 1 1-2.1-5" /><path d="M17.5 3.5V7.5H13.5" /></svg>)
export const IconDownload = (p: P) => (<svg {...base} {...p}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14" /></svg>)
export const IconSettings = (p: P) => (<svg {...base} {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>)
export const IconSearch = (p: P) => (<svg {...base} strokeWidth={1.8} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>)
export const IconTheme = (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="7.5" /><path d="M12 4.5v15a7.5 7.5 0 0 0 0-15z" fill="currentColor" /></svg>)
export const IconOut = (p: P) => (<svg {...base} strokeWidth={2} {...p}><path d="M8 16L16 8M9 8h7v7" /></svg>)
export const IconBack = (p: P) => (<svg {...base} strokeWidth={1.8} {...p}><path d="M14 6l-6 6 6 6" /></svg>)

export const Mark = (p: P) => (
  <svg viewBox="0 0 28 28" fill="none" {...p}>
    <path d="M6 22V6l16 16V6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
    <circle cx="22" cy="6" r="2.2" fill="var(--accent)" />
  </svg>
)
