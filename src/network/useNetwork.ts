import { useEffect, useState } from 'react'
import { fetchJson, loadRegion, type LoadedRegion } from './loadSnapshot.ts'

type IndexFile = {
  version: number
  regions: { id: string; name: string; group: string }[]
}

export type NetworkState = {
  status: 'loading' | 'ready' | 'error'
  regions: LoadedRegion[]
  error?: string
  decodeMs: number
}

export function useNetwork(): NetworkState {
  const [state, setState] = useState<NetworkState>({
    status: 'loading',
    regions: [],
    decodeMs: 0,
  })

  useEffect(() => {
    let cancelled = false
    const started = performance.now()

    async function run() {
      try {
        const index = await fetchJson<IndexFile>(
          globalThis.fetch,
          'network/index.json',
          'Snapshot index',
        )
        if (index.regions.length === 0) {
          throw new Error('Snapshot index lists zero regions.')
        }

        const loaded: LoadedRegion[] = []
        // Render regions as they arrive rather than waiting for all ten.
        for (const entry of index.regions) {
          const region = await loadRegion(entry.id)
          if (cancelled) return
          loaded.push(region)
          setState({
            status: 'loading',
            regions: [...loaded],
            decodeMs: Math.round(performance.now() - started),
          })
        }

        if (cancelled) return
        setState({
          status: 'ready',
          regions: loaded,
          decodeMs: Math.round(performance.now() - started),
        })
      } catch (error) {
        if (cancelled) return
        setState({
          status: 'error',
          regions: [],
          error: error instanceof Error ? error.message : String(error),
          decodeMs: Math.round(performance.now() - started),
        })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
