// Siluetas propias de cada plataforma (48×32, solo trazos). Formas genéricas de las
// consolas, dibujadas para NATIVE HUB: ninguna reproduce logotipos ni marcas.

const ICONS: Record<string, string[]> = {
  nes: ['M6 10h36v14H6z', 'M6 18h36', 'M10 13h16', 'M10 21h3', 'M15 21h3', 'M34 13h4'],
  snes: ['M5 13c0-2 1-3 3-3h32c2 0 3 1 3 3v8c0 2-1 3-3 3H8c-2 0-3-1-3-3z', 'M15 10V8h18v2', 'M10 18h4', 'M33 18a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'],
  n64: ['M4 16c0-3 2-5 5-5h30c3 0 5 2 5 5v4c0 2-1 4-3 4H7c-2 0-3-2-3-4z', 'M15 11V7h18v4', 'M18 7h12', 'M10 18h4', 'M34 18h4'],
  gb: ['M15 3h18v26H15z', 'M18 6h12v9H18z', 'M19 21h4M21 19v4', 'M28 22a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  gbc: ['M16 4h16v24H16z', 'M18 7h12v8H18z', 'M19.5 20h3M21 18.5v3', 'M27 20a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  gba: ['M5 10c0-1 1-2 2-2h34c1 0 2 1 2 2v10c0 2-2 4-4 4H9c-2 0-4-2-4-4z', 'M17 11h14v10H17z', 'M9 16h4M11 14v4', 'M35 15a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M38 17.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  virtualboy: ['M8 7h32v11H8z', 'M13 10h7v5h-7z', 'M28 10h7v5h-7z', 'M20 18l-5 10M28 18l5 10', 'M12 28h24'],
  nds: ['M12 3h24v12H12z', 'M16 5h16v8H16z', 'M12 17h24v12H12z', 'M19 19h10v8H19z', 'M14 22h3'],
  '3ds': ['M11 4h26v11H11z', 'M14 6h20v7H14z', 'M13 17h22v11H13z', 'M20 19h8v7h-8z', 'M15 22h3'],
  gamecube: ['M12 9h24v20H12z', 'M17 9V5h14v4', 'M19 19a5 5 0 1 0 10 0a5 5 0 1 0-10 0'],
  wii: ['M20 3h8v25h-8z', 'M22 7h4', 'M24 24v1', 'M17 29h14'],
  wiiu: ['M4 9c0-1 1-2 2-2h36c1 0 2 1 2 2v14c0 1-1 2-2 2H6c-1 0-2-1-2-2z', 'M14 10h20v12H14z', 'M7 16h4M9 14v4', 'M38 15a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  switch: ['M14 9h20v14H14z', 'M16 11h16v10H16z', 'M8 9h6v14H8c-1.5 0-2-1-2-2V11c0-1 .5-2 2-2z', 'M34 9h6c1.5 0 2 1 2 2v10c0 1-.5 2-2 2h-6z', 'M10 13v2', 'M38 17v2'],
  switch2: ['M12 7h24v18H12z', 'M14 9h20v14H14z', 'M5 7h7v18H5c-1.5 0-2-1-2-2V9c0-1 .5-2 2-2z', 'M36 7h7c1.5 0 2 1 2 2v14c0 1-.5 2-2 2h-7z', 'M7 11v2', 'M41 18v2', 'M7 18h2', 'M39 11h2'],
  ps1: ['M6 11h36v13H6z', 'M13 17.5a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M28 15h10', 'M28 19h4'],
  ps2: ['M17 3h14v26H17z', 'M17 8h14', 'M20 12v13', 'M27 25h1'],
  ps3: ['M8 24V14c0-4 4-7 16-7s16 3 16 7v10z', 'M8 20h32', 'M12 22h4'],
  ps4: ['M6 14l4-4h32l-4 4H6z', 'M6 14v8h32v-8', 'M38 22l4-4v-8', 'M6 18h32'],
  ps5: ['M21 4h6v25h-6z', 'M21 4c-4 0-6 2-6 4v19c0 1 1 2 2 2h4', 'M27 4c4 0 6 2 6 4v19c0 1-1 2-2 2h-4'],
  psp: ['M4 16c0-5 3-8 8-8h24c5 0 8 3 8 8s-3 8-8 8H12c-5 0-8-3-8-8z', 'M15 11h18v10H15z', 'M8 16h3M9.5 14.5v3', 'M37 16a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  vita: ['M3 16c0-5 4-8 9-8h24c5 0 9 3 9 8s-4 8-9 8H12c-5 0-9-3-9-8z', 'M14 10h20v12H14z', 'M7 13h3', 'M7 19a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0', 'M38 19a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'],
  xbox: ['M5 11h38v14H5z', 'M5 11l3-3h32l3 3', 'M20 18a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M8 21h6'],
  x360: ['M5 12c4-2 34-2 38 0v10c-4 2-34 2-38 0z', 'M9 17h12', 'M33 17a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'],
  xboxone: ['M4 11h40v13H4z', 'M4 18h40', 'M8 14.5h12', 'M36 14.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  sms: ['M5 12l3-4h32l3 4v12H5z', 'M5 18h38', 'M10 21h6', 'M30 12h8'],
  gamegear: ['M3 14c0-4 3-6 6-6h30c3 0 6 2 6 6v4c0 4-3 6-6 6H9c-3 0-6-2-6-6z', 'M16 10h16v12H16z', 'M8 16h4M10 14v4', 'M36 15a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M39 18a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  megadrive: ['M5 13c0-2 1-3 3-3h32c2 0 3 1 3 3v9c0 1-1 2-2 2H7c-1 0-2-1-2-2z', 'M16 14a8 3 0 1 0 16 0a8 3 0 1 0-16 0', 'M9 20h6'],
  megacd: ['M6 6h36v10H6z', 'M11 11h10', 'M6 18h36v8H6z', 'M10 22h6'],
  '32x': ['M10 12c0-4 6-7 14-7s14 3 14 7z', 'M20 12v6h8v-6', 'M6 18h36v8H6z'],
  saturn: ['M5 11h38v14H5z', 'M9 18a7 4.5 0 1 0 14 0a7 4.5 0 1 0-14 0', 'M30 16h8', 'M30 20h8'],
  dreamcast: ['M9 6h30v20H9z', 'M17 15a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M12 23h4'],
  pc: ['M8 4h32v20H8z', 'M11 7h26v14H11z', 'M21 24l-2 4h10l-2-4', 'M16 28h16'],
  dos: ['M10 3h28v18H10z', 'M14 6h20v12H14z', 'M12 21h24v7H12z', 'M27 24.5h6'],
  pc98: ['M12 3h24v15H12z', 'M15 6h18v9H15z', 'M6 20h36v8H6z', 'M30 23.5h8'],
  mac: ['M15 3h18v26H15z', 'M18 6h12v10H18z', 'M20 21h5', 'M17 26h2'],
  macos: ['M10 6h28v16H10z', 'M13 9h22v10H13z', 'M5 24h38l-3 4H8z'],
  arcade: ['M15 3h18l-2 9 4 6v11H13V18l4-6z', 'M18 6h12v6H18z', 'M17 21h4', 'M27 21a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  neogeo: ['M12 6h24v20H12z', 'M16 6V3h16v3', 'M16 12h16', 'M16 16h16', 'M16 20h8'],
  pce: ['M14 9h20v14H14z', 'M14 13h20', 'M18 9V7h12v2', 'M18 18h4'],
  m2: ['M6 9h36v15H6z', 'M6 15h36', 'M10 19h10', 'M36 19h2'],
  mobile: ['M17 3h14v26H17z', 'M20 6h8v17h-8z', 'M23 26h2'],
  other: ['M12 11h24c4 0 6 4 6 9 0 4-2 6-4 6s-3-3-6-3H16c-3 0-4 3-6 3s-4-2-4-6c0-5 2-9 6-9z', 'M13 17h4M15 15v4', 'M32 16a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M35 19a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
}

export function ConsoleIcon({ slug, size = 48, strokeWidth = 1.5, className }: { slug: string; size?: number; strokeWidth?: number; className?: string }) {
  const paths = ICONS[slug] ?? ICONS.other
  return (
    <svg className={className} width={size} height={(size * 2) / 3} viewBox="0 0 48 32" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  )
}
