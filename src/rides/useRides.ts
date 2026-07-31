import { useEffect, useState } from 'react'
import { loadRidesOnce, type LoadedRides } from './loadRides.ts'

export type RidesState = {
  status: 'loading' | 'ready' | 'absent' | 'error'
  rides: LoadedRides | null
  error?: string
}

export function useRides(enabled: boolean): RidesState {
  const [state, setState] = useState<RidesState>({ status: 'loading', rides: null })

  useEffect(() => {
    // Nothing is fetched until this view needs it. The loader memoizes, so
    // switching back into this view resolves from cache and hands the map the
    // same object it is already drawing.
    if (!enabled) return

    let canceled = false
    loadRidesOnce()
      .then(({ value: rides }) => {
        if (canceled) return
        setState(rides ? { status: 'ready', rides } : { status: 'absent', rides: null })
      })
      .catch((error: unknown) => {
        if (canceled) return
        setState({
          status: 'error',
          rides: null,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => { canceled = true }
  }, [enabled])

  return state
}
