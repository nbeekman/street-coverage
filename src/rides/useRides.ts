import { useEffect, useState } from 'react'
import { loadRides, type LoadedRides } from './loadRides.ts'

export type RidesState = {
  status: 'loading' | 'ready' | 'absent' | 'error'
  rides: LoadedRides | null
  error?: string
}

export function useRides(): RidesState {
  const [state, setState] = useState<RidesState>({ status: 'loading', rides: null })

  useEffect(() => {
    let canceled = false
    loadRides()
      .then((rides) => {
        if (canceled) return
        setState(rides ? { status: 'ready', rides } : { status: 'absent', rides: null })
      })
      .catch((error) => {
        if (canceled) return
        setState({
          status: 'error',
          rides: null,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => { canceled = true }
  }, [])

  return state
}
