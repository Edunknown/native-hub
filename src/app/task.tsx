// Panel de progreso por pasos para acciones que, de tan rápidas, parecían no hacer nada
// (instalar, desinstalar, borrar, aprobar…). La acción real se ejecuta a la vez; el panel
// garantiza una duración mínima y enseña en qué paso está. Si la acción falla, lo dice.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { tr } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { ErrorNote } from '../components/ErrorNote'

export interface TaskSpec {
  title: string
  steps: string[]
  /** Duración mínima en ms (por defecto 1800). */
  minMs?: number
  done?: string
}

interface State {
  spec: TaskSpec
  step: number
  phase: 'running' | 'done' | 'error'
  error?: string
}

type Run = <T>(spec: TaskSpec, fn: () => Promise<T>) => Promise<T>

const Ctx = createContext<Run | null>(null)
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function TaskProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  const run = useCallback<Run>(async (spec, fn) => {
    const min = reduced ? 400 : (spec.minMs ?? 1800)
    const stepMs = min / Math.max(1, spec.steps.length)
    setState({ spec, step: 0, phase: 'running' })
    let finished = false
    // Avanza por los pasos; el último espera a que termine la acción real.
    const ticker = (async () => {
      for (let i = 1; i < spec.steps.length; i++) {
        await sleep(stepMs)
        if (finished) break
        setState((s) => (s && s.phase === 'running' ? { ...s, step: i } : s))
      }
    })()
    try {
      const [result] = await Promise.all([fn(), sleep(min)])
      finished = true
      await ticker
      setState((s) => (s ? { ...s, step: spec.steps.length, phase: 'done' } : s))
      await sleep(reduced ? 200 : 650)
      setState(null)
      return result
    } catch (e) {
      finished = true
      setState((s) => (s ? { ...s, phase: 'error', error: errorText(e) } : s))
      await new Promise<void>((r) => { closeRef.current = r })
      setState(null)
      throw e
    }
  }, [])

  const s = state
  const total = s ? s.spec.steps.length : 1
  const pct = s ? (s.phase === 'running' ? Math.round(((s.step + 0.6) / total) * 100) : 100) : 0

  return (
    <Ctx.Provider value={run}>
      {children}
      {s && (
        <div className="task-backdrop" role="dialog" aria-modal="true" aria-labelledby="task-title">
          <div className={`task task-${s.phase}`}>
            <div className="eyebrow">{s.phase === 'error' ? tr('No se pudo completar', 'Could not complete') : s.phase === 'done' ? tr('Hecho', 'Done') : tr('Trabajando', 'Working')}</div>
            <p id="task-title" className="task-title">{s.spec.title}</p>
            <div className="task-bar"><i style={{ width: `${pct}%` }} /></div>
            <ol className="task-steps">
              {s.spec.steps.map((t, i) => (
                <li key={t} className={i < s.step || s.phase === 'done' ? 'ok' : i === s.step && s.phase === 'running' ? 'now' : s.phase === 'error' && i === s.step ? 'bad' : ''}>{t}</li>
              ))}
            </ol>
            {s.phase === 'done' && s.spec.done && <p className="note-line yes">{s.spec.done}</p>}
            {s.phase === 'error' && (
              <>
                <ErrorNote error={s.error ?? ''} />
                <div className="actions"><button type="button" className="btn-line" onClick={() => closeRef.current?.()}>{tr('Cerrar', 'Close')}</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

/** `const task = useTask(); await task({title, steps}, () => api.algo())` */
export function useTask(): Run {
  const r = useContext(Ctx)
  if (!r) throw new Error('useTask fuera de TaskProvider')
  return useMemo(() => r, [r])
}
