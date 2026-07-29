import { describe, expect, it } from 'vitest'
import { loadRegion } from './loadSnapshot'
import { centerOf, toLngLatOffsets } from '../geo/bounds.ts'
import { SNAPSHOT_VERSION, packSnapshot } from './snapshot'

const WAYS = [
  { id: 100, classIndex: 3, coords: [-105.01, 39.6, -104.99, 39.61], nodeRefs: [1, 2] },
  { id: 101, classIndex: 6, coords: [-104.99, 39.61, -104.97, 39.63], nodeRefs: [2, 3] },
]

const BBOX = { minLon: -105.01, minLat: 39.6, maxLon: -104.97, maxLat: 39.63 }
const ORIGIN = centerOf(BBOX)

/** The Float32 offsets the build ships, from the Float64 positions it packs. */
const offsetsOf = (b: ReturnType<typeof packSnapshot>) =>
  toLngLatOffsets(b.positions, ORIGIN)

function fixture() {
  const b = packSnapshot(WAYS)
  const manifest = {
    version: SNAPSHOT_VERSION,
    regionId: 'test',
    regionName: 'Test',
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
      offsets: offsetsOf(b).byteLength,
      startIndices: b.startIndices.byteLength,
      classes: b.classes.byteLength,
    },
  }
  return { manifest, buffers: b }
}

function fetchFor(manifest: unknown, b: ReturnType<typeof packSnapshot>) {
  return async (url: string) => {
    if (url.endsWith('manifest.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(manifest), json: async () => manifest, arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const buf =
      url.endsWith('offsets.bin') ? offsetsOf(b).buffer
      : url.endsWith('startIndices.bin') ? b.startIndices.buffer
      : b.classes.buffer
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => buf }
  }
}

describe('loadRegion', () => {
  it('decodes buffers and computes a render origin', async () => {
    const { manifest, buffers } = fixture()
    const region = await loadRegion('test', fetchFor(manifest, buffers) as never)

    expect(region.manifest.wayCount).toBe(2)
    expect(region.buffers.offsets.length).toBe(8)
    // Origin now comes from the manifest rather than being recomputed from
    // Float64 positions the browser no longer downloads.
    expect(region.origin[0]).toBeCloseTo(-104.99, 5)
    expect(region.offsets).toBeInstanceOf(Float32Array)
    expect(Math.abs(region.offsets[0])).toBeLessThan(0.1)
  })

  it('surfaces a version mismatch as a SnapshotError', async () => {
    const { manifest, buffers } = fixture()
    const bad = { ...manifest, version: SNAPSHOT_VERSION + 1 }
    await expect(
      loadRegion('test', fetchFor(bad, buffers) as never),
    ).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
  })

  it('explains a missing snapshot when a dev server returns HTML under HTTP 200', async () => {
    // Vite's SPA fallback answers a missing file with index.html and status
    // 200, so res.ok is true. Without the HTML guard the user gets
    // "Unexpected token '<'" instead of being told to build the snapshot.
    const spaFallback = async () => ({
      ok: true,
      status: 200,
      text: async () => '<!doctype html><html><body><div id="root"></div></body></html>',
      json: async () => {
        throw new SyntaxError("Unexpected token '<'")
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    await expect(loadRegion('test', spaFallback as never)).rejects.toThrow(
      /HTML rather than JSON.*build:snapshot/s,
    )
  })

  it('surfaces an HTTP failure with the region id', async () => {
    const failing = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    await expect(loadRegion('test', failing as never)).rejects.toThrow(/test/)
  })
})
