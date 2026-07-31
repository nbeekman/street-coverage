import { timedOnce } from '../loading/timedOnce.ts'
import { fetchJson, loadRegion, type LoadedRegion } from './loadSnapshot.ts'

type IndexFile = {
  version: number
  regions: { id: string; name: string; group: string }[]
}

/** Called once per region as it lands, with the running count and the total. */
type OnProgress = (loaded: number, total: number) => void

/**
 * Load every region in the snapshot index, concurrently.
 *
 * Awaiting them in a loop and rendering each arrival made the map draw itself
 * a suburb at a time, which reads as a fault rather than as progress. They are
 * fetched in parallel and delivered together; `onProgress` carries the count
 * so the loading screen can still say how far along it is.
 *
 * Promise.all preserves index order, so the region list is identical on every
 * load regardless of which response came back first.
 */
export function loadAllRegions(
  onProgress?: OnProgress,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<LoadedRegion[]> {
  return (async () => {
    const index = await fetchJson<IndexFile>(fetchImpl, 'network/index.json', 'Snapshot index')
    if (index.regions.length === 0) {
      throw new Error('Snapshot index lists zero regions.')
    }

    let loaded = 0
    return Promise.all(
      index.regions.map(async (entry) => {
        const region = await loadRegion(entry.id, fetchImpl)
        loaded++
        onProgress?.(loaded, index.regions.length)
        return region
      }),
    )
  })()
}

/**
 * The page-wide loader. Every caller shares this one fetch, so switching back
 * into rides mode costs nothing and the map keeps the regions it already has.
 */
export const loadAllRegionsOnce = timedOnce(loadAllRegions)
