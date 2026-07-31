import { describe, expect, it } from 'vitest'
import { centerOf, toLngLatOffsets } from '../geo/bounds.ts'
import { timedOnce } from '../loading/timedOnce.ts'
import { loadAllRegions } from './regionLoader.ts'
import { SNAPSHOT_VERSION, packSnapshot } from './snapshot.ts'

const WAYS = [
  { id: 100, classIndex: 3, coords: [-105.01, 39.6, -104.99, 39.61], nodeRefs: [1, 2] },
  { id: 101, classIndex: 6, coords: [-104.99, 39.61, -104.97, 39.63], nodeRefs: [2, 3] },
]

const BBOX = { minLon: -105.01, minLat: 39.6, maxLon: -104.97, maxLat: 39.63 }
const ORIGIN = centerOf(BBOX)

const IDS = ['denver', 'aurora', 'lakewood']

function manifestFor(id: string, b: ReturnType<typeof packSnapshot>) {
  return {
    version: SNAPSHOT_VERSION,
    regionId: id,
    regionName: id,
    group: 'metro-core',
    osmId: 1,
    osmKind: 'relation',
    generatedAt: '2026-07-27T00:00:00.000Z',
    osmTimestamp: '2026-07-27T00:00:00Z',
    queryHash: 'abc123',
    bbox: BBOX,
    origin: ORIGIN,
    wayCount: 2,
    positionCount: 4,
    uniqueNodeCount: 3,
    totalMeters: 100,
    classes: ['primary'],
    byteLengths: {
      offsets: toLngLatOffsets(b.positions, ORIGIN).byteLength,
      startIndices: b.startIndices.byteLength,
      classes: b.classes.byteLength,
    },
  }
}

type Harness = {
  fetch: typeof globalThis.fetch
  /** Every URL requested, in order. */
  urls: string[]
  /** Highest number of region requests open at the same time. */
  peakConcurrency: number
}

/**
 * A fetch that answers the index and every region, holding each response open
 * for a tick so overlapping requests are observable.
 */
function harness(options: { regions?: string[] } = {}): Harness {
  const ids = options.regions ?? IDS
  const b = packSnapshot(WAYS)
  const offsets = toLngLatOffsets(b.positions, ORIGIN)
  const index = { version: 4, regions: ids.map((id) => ({ id, name: id, group: 'metro-core' })) }

  const h: Harness = { fetch: null as never, urls: [], peakConcurrency: 0 }
  let inFlight = 0

  h.fetch = (async (url: string) => {
    h.urls.push(url)
    const isRegion = url !== 'network/index.json'
    if (isRegion) {
      inFlight++
      h.peakConcurrency = Math.max(h.peakConcurrency, inFlight)
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
    if (isRegion) inFlight--

    if (url === 'network/index.json') {
      return { ok: true, status: 200, text: async () => JSON.stringify(index), arrayBuffer: async () => new ArrayBuffer(0) }
    }
    if (url.endsWith('manifest.json')) {
      const m = manifestFor(url.split('/')[1], b)
      return { ok: true, status: 200, text: async () => JSON.stringify(m), arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const buf =
      url.endsWith('offsets.bin') ? offsets.buffer
      : url.endsWith('startIndices.bin') ? b.startIndices.buffer
      : b.classes.buffer
    return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => buf }
  }) as never

  return h
}

describe('loadAllRegions', () => {
  it('resolves every region in index order', async () => {
    const regions = await loadAllRegions(undefined, harness().fetch)

    expect(regions.map((r) => r.id)).toEqual(IDS)
  })

  it('loads regions concurrently rather than one after another', async () => {
    // The whole point: sequential loading is what made each region pop onto
    // the map on its own, one at a time.
    const h = harness()
    await loadAllRegions(undefined, h.fetch)

    expect(h.peakConcurrency).toBeGreaterThan(1)
  })

  it('counts regions as they land, against the index total', async () => {
    const seen: string[] = []
    await loadAllRegions((n, total) => seen.push(`${n}/${total}`), harness().fetch)

    expect(seen).toEqual(['1/3', '2/3', '3/3'])
  })

  it('rejects an index that lists no regions', async () => {
    await expect(loadAllRegions(undefined, harness({ regions: [] }).fetch)).rejects.toThrow(
      /zero regions/,
    )
  })

  it('fetches once however many times the memoized loader is called', async () => {
    // Switching Coverage -> Rides -> Coverage -> Rides re-runs the effect;
    // without the memo that reloaded all nineteen regions from an empty list.
    const h = harness()
    const load = timedOnce(loadAllRegions)

    const first = await load(undefined, h.fetch)
    const requests = h.urls.length
    const second = await load(undefined, h.fetch)

    expect(h.urls.length).toBe(requests)
    expect(second.value).toBe(first.value)
  })
})
