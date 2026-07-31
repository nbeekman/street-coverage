import { useEffect, useState } from 'react'
import { CoverageAbsent, loadCoverageOnce, type LoadedCoverage } from './loadCoverage.ts'

export type CoverageState = {
  status: 'loading' | 'ready' | 'absent' | 'error'
  coverage: LoadedCoverage | null
  error?: string
  decodeMs: number
}

export function useCoverage(enabled: boolean): CoverageState {
  const [state, setState] = useState<CoverageState>({
    status: 'loading',
    coverage: null,
    decodeMs: 0,
  })

  useEffect(() => {
    // Nothing is fetched until this view needs it. The loader memoizes, so
    // switching back into this view resolves from cache and hands the map the
    // same object it is already drawing.
    if (!enabled) return

    let canceled = false

    loadCoverageOnce()
      .then(({ value: coverage, decodeMs }) => {
        if (canceled) return
        setState({ status: 'ready', coverage, decodeMs })
      })
      .catch((error: unknown) => {
        if (canceled) return
        // A missing snapshot means "run the build", not "something broke".
        if (error instanceof CoverageAbsent) {
          setState({ status: 'absent', coverage: null, decodeMs: 0 })
          return
        }
        setState({
          status: 'error',
          coverage: null,
          error: error instanceof Error ? error.message : String(error),
          decodeMs: 0,
        })
      })

    return () => {
      canceled = true
    }
  }, [enabled])

  return state
}
