// Animación de inicio: se dibuja la N, aparece el punto lima y el nombre, y se desvanece.
// Se salta con un clic o una tecla. Con «reducir movimiento» dura menos y no se mueve.

import { useEffect, useState } from 'react'
import { playStartupChime, startupSoundEnabled } from './sound'

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [minPassed, setMinPassed] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (startupSoundEnabled()) {
      // El acorde entra justo cuando aparece el punto lima.
      const t = setTimeout(() => playStartupChime(), reduced ? 0 : 650)
      return () => clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setMinPassed(true), reduced ? 600 : 2300)
    return () => clearTimeout(t)
  }, [])

  const done = ready && minPassed
  useEffect(() => {
    if (!done) return
    setLeaving(true)
    const t = setTimeout(onDone, reduced ? 150 : 450)
    return () => clearTimeout(t)
  }, [done, onDone])

  useEffect(() => {
    const skip = () => { if (ready) setMinPassed(true) }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [ready])

  return (
    <div className={`splash${leaving ? ' out' : ''}${reduced ? ' still' : ''}`} onClick={() => ready && setMinPassed(true)} role="presentation">
      <div className="splash-inner">
        <svg className="splash-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path className="splash-n" d="M6 22V6l16 16V6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" pathLength={1} />
          <circle className="splash-dot" cx="22" cy="6" r="2.2" fill="var(--accent)" />
        </svg>
        <div className="splash-word">NATIVE <span>HUB</span></div>
        <div className="splash-line"><i /></div>
        <div className="splash-sub">{ready ? 'Recompilaciones y ports nativos' : 'Abriendo el catálogo…'}</div>
      </div>
    </div>
  )
}
