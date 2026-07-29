import { describe, expect, it } from 'vitest'
import { centerOf, toLngLatOffsets } from '../geo/bounds.ts'
import type { NormalizedWay } from './normalize'
import {
  SNAPSHOT_VERSION,
  SnapshotError,
  packSnapshot,
  validateSnapshot,
  wayCoords,
  type SnapshotManifest,
  type SnapshotBuffers,
} from './snapshot'

const WAYS: NormalizedWay[] = [
  { id: 100, classIndex: 3, coords: [-105, 39.6, -104.99, 39.61], nodeRefs: [1, 2] },
  { id: 101, classIndex: 6, coords: [-104.99, 39.61, -104.98, 39.62, -104.97, 39.63], nodeRefs: [2, 3, 4] },
]

const BBOX = { minLon: -105, minLat: 39.6, maxLon: -104.97, maxLat: 39.63 }
const ORIGIN = centerOf(BBOX)

/**
 * What the build ships: Float32 offsets from the origin, no positions and no
 * way ids. Mirrors build-snapshot so the tests exercise the wire shape rather
 * than the intermediate one.
 */
function wireOf(packed: ReturnType<typeof packSnapshot>): SnapshotBuffers {
  return {
    offsets: toLngLatOffsets(packed.positions, ORIGIN),
    startIndices: packed.startIndices,
    classes: packed.classes,
  }
}

function manifestFor(buffers: SnapshotBuffers): SnapshotManifest {
  return {
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
    positionCount: 5,
    uniqueNodeCount: 4,
    totalMeters: 1234,
    classes: ['primary'],
    byteLengths: {
      offsets: buffers.offsets.byteLength,
      startIndices: buffers.startIndices.byteLength,
      classes: buffers.classes.byteLength,
    },

  }
}

describe('packSnapshot', () => {
  it('produces one startIndex per way plus a terminator', () => {
    const b = packSnapshot(WAYS)
    expect(b.startIndices.length).toBe(3)
    expect(Array.from(b.startIndices)).toEqual([0, 2, 5])
  })

  it('preserves coordinates exactly', () => {
    const b = packSnapshot(WAYS)
    expect(wayCoords(b, 0)).toEqual(WAYS[0].coords)
    expect(wayCoords(b, 1)).toEqual(WAYS[1].coords)
  })

  it('stores way ids in Float64 so large OSM ids survive', () => {
    // 624295048 fits in Uint32, but OSM way ids have already passed 2^32.
    const b = packSnapshot([{ id: 12_345_678_901, classIndex: 0, coords: [0, 0, 1, 1], nodeRefs: [1, 2] }])
    expect(b.wayIds).toBeInstanceOf(Float64Array)
    expect(b.wayIds[0]).toBe(12_345_678_901)
  })

  it('stores class indices per way', () => {
    const b = packSnapshot(WAYS)
    expect(Array.from(b.classes)).toEqual([3, 6])
  })

  it('handles an empty way list', () => {
    const b = packSnapshot([])
    expect(b.positions.length).toBe(0)
    expect(Array.from(b.startIndices)).toEqual([0])
  })
})

describe('validateSnapshot', () => {
  it('accepts a matching manifest', () => {
    const b = wireOf(packSnapshot(WAYS))
    expect(() => validateSnapshot(manifestFor(b), b)).not.toThrow()
  })

  it('rejects a version mismatch', () => {
    const b = wireOf(packSnapshot(WAYS))
    const m = { ...manifestFor(b), version: SNAPSHOT_VERSION + 1 }
    expect(() => validateSnapshot(m, b)).toThrow(SnapshotError)
    try {
      validateSnapshot(m, b)
    } catch (e) {
      expect((e as SnapshotError).code).toBe('VERSION_MISMATCH')
    }
  })

  it('rejects a truncated offsets buffer', () => {
    const b = wireOf(packSnapshot(WAYS))
    const m = manifestFor(b)
    const truncated = { ...b, offsets: b.offsets.slice(0, 4) }
    try {
      validateSnapshot(m, truncated)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SnapshotError).code).toBe('TRUNCATED')
    }
  })

  it('rejects a startIndices terminator that disagrees with positionCount', () => {
    const b = wireOf(packSnapshot(WAYS))
    const m = { ...manifestFor(b), positionCount: 99 }
    try {
      validateSnapshot(m, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SnapshotError).code).toBe('MISALIGNED')
    }
  })

  it('rejects a wayCount that disagrees with the buffers', () => {
    const b = wireOf(packSnapshot(WAYS))
    const m = { ...manifestFor(b), wayCount: 7 }
    try {
      validateSnapshot(m, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SnapshotError).code).toBe('MISALIGNED')
    }
  })
})
