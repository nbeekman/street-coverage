import { describe, expect, it } from 'vitest'
import { loadRegion } from './loadSnapshot'
import { SNAPSHOT_VERSION, packSnapshot } from './snapshot'

const WAYS = [
  { id: 100, classIndex: 3, coords: [-105.01, 39.6, -104.99, 39.61] },
  { id: 101, classIndex: 6, coords: [-104.99, 39.61, -104.97, 39.63] },
]

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
    bbox: { minLon: -105.01, minLat: 39.6, maxLon: -104.97, maxLat: 39.63 },
    wayCount: 2,
    positionCount: 4,
    uniqueNodeCount: 3,
    totalMeters: 100,
    classes: ['primary'],
    byteLengths: {
      positions: b.positions.byteLength,
      startIndices: b.startIndices.byteLength,
      wayIds: b.wayIds.byteLength,
      classes: b.classes.byteLength,
    },
  }
  return { manifest, buffers: b }
}

function fetchFor(manifest: unknown, b: ReturnType<typeof packSnapshot>) {
  return async (url: string) => {
    if (url.endsWith('manifest.json')) {
      return { ok: true, status: 200, json: async () => manifest, arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const buf =
      url.endsWith('positions.bin') ? b.positions.buffer
      : url.endsWith('startIndices.bin') ? b.startIndices.buffer
      : url.endsWith('wayIds.bin') ? b.wayIds.buffer
      : b.classes.buffer
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => buf }
  }
}

describe('loadRegion', () => {
  it('decodes buffers and computes a render origin', async () => {
    const { manifest, buffers } = fixture()
    const region = await loadRegion('test', fetchFor(manifest, buffers) as never)

    expect(region.manifest.wayCount).toBe(2)
    expect(region.buffers.positions.length).toBe(8)
    // Origin is the bbox center, so offsets stay small.
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
