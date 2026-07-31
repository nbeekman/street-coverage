import { useEffect, useState } from 'react'
import type { LoadedRegion } from './loadSnapshot.ts'
import { loadAllRegionsOnce } from './regionLoader.ts'

export type NetworkState = {
  status: 'loading' | 'ready' | 'error'
  regions: LoadedRegion[]
  error?: string
  decodeMs: number
  /** Regions decoded so far, and how many there are. For the loading screen. */
  progress: { loaded: number; total: number }
}

const NOTHING_YET: NetworkState = {
  status: 'loading',
  regions: [],
  decodeMs: 0,
  progress: { loaded: 0, total: 0 },
}

export function useNetwork(enabled: boolean): NetworkState {
  const [state, setState] = useState<NetworkState>(NOTHING_YET)

  useEffect(() => {
    // Nothing is fetched until this view needs it. The loader memoizes, so the
    // second and every later switch into this view resolves from cache in a
    // microtask -- the map keeps the regions it already has and never blinks.
    if (!enabled) return

    let canceled = false

    loadAllRegionsOnce((loaded, total) => {
      // Progress is a counter, not geometry. Committing each region as it
      // landed is what made the map draw itself one suburb at a time.
      if (!canceled) {
        setState((s) => (s.status === 'ready' ? s : { ...s, progress: { loaded, total } }))
      }
    })
      .then(({ value: regions, decodeMs }) => {
        if (canceled) return
        setState({
          status: 'ready',
          regions,
          decodeMs,
          progress: { loaded: regions.length, total: regions.length },
        })
      })
      .catch((error: unknown) => {
        if (canceled) return
        setState({
          ...NOTHING_YET,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      canceled = true
    }
  }, [enabled])

  return state
}
