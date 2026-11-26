import { useEffect, useState } from 'react'

export type Async<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: string }

/** Ejecuta una consulta y vuelve a lanzarla cuando cambian sus dependencias. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    fn().then(
      (data) => alive && setState({ status: 'ok', data }),
      (e) => alive && setState({ status: 'error', error: String(e) }),
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}
