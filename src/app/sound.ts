// Sonido de inicio: un acorde corto generado con Web Audio (sin archivos de audio de terceros).
// Se puede desactivar en Ajustes.

const KEY = 'nh-startup-sound'

export function startupSoundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setStartupSound(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* sin almacenamiento */ }
}

/** Tres notas suaves que suben (Re, La, Re) con un brillo final, ~1,6 s. */
export function playStartupChime(volume = 0.18) {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  const ctx = new Ctx()
  const master = ctx.createGain()
  master.gain.value = volume
  master.connect(ctx.destination)

  // Eco ligero para que no suene seco.
  const delay = ctx.createDelay()
  delay.delayTime.value = 0.18
  const fb = ctx.createGain()
  fb.gain.value = 0.25
  delay.connect(fb).connect(delay)
  delay.connect(master)

  const note = (freq: number, at: number, dur: number, type: OscillatorType, gain: number) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    const t = ctx.currentTime + at
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(master)
    g.connect(delay)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  note(293.66, 0.0, 0.9, 'sine', 0.5)      // Re4
  note(440.0, 0.16, 0.9, 'sine', 0.45)     // La4
  note(587.33, 0.32, 1.2, 'sine', 0.5)     // Re5
  note(880.0, 0.32, 1.0, 'triangle', 0.08) // brillo
  note(1174.66, 0.48, 0.8, 'sine', 0.05)   // Re6, muy suave

  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  setTimeout(() => ctx.close().catch(() => {}), 2600)
}
