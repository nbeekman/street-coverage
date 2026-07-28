import { useEffect, useState } from 'react'
import { CoverageAbsent, loadCoverage, type LoadedCoverage } from './loadCoverage.ts'

export type CoverageState = {
  status: 'loading' | 'ready' | 'absent' | 'error'
  coverage: LoadedCoverage | null
  error?: string
  decodeMs: number
}

export function useCoverage(): CoverageState {
  const [state, setState] = useState<CoverageState>({
    status: 'loading',
    coverage: null,
    decodeMs: 0,
  })

  useEffect(() => {
    let canceled = false
    const started = performance.now()

    async function run() {
      try {
        const coverage = await loadCoverage()
        if (canceled) return
        setState({
          status: 'ready',
          coverage,
          decodeMs: Math.round(performance.now() - started),
        })
      } catch (error) {
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
          decodeMs: Math.round(performance.now() - started),
        })
      }
    }

    void run()
    return () => {
      canceled = true
    }
  }, [])

  return state
}
