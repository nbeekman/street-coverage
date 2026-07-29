import { describe, expect, it } from 'vitest'
import type { Ride } from './types'
import {
  RIDES_SNAPSHOT_VERSION,
  RidesSnapshotError,
  packRides,
  ridePoints,
  validateRides,
  type RidesManifest,
} from './snapshot'

const RIDES: Ride[] = [
  { id: 'a', startTime: 1_700_000_000_000, points: [
    { lon: -105.0, lat: 39.6, t: 1_700_000_000_000 },
    { lon: -104.99, lat: 39.61, t: 1_700_000_001_000 },
  ] },
  { id: 'b', startTime: 1_700_000_100_000, points: [
    { lon: -104.98, lat: 39.62, t: 1_700_000_100_000 },
    { lon: -104.97, lat: 39.63, t: 1_700_000_101_000 },
    { lon: -104.96, lat: 39.64, t: 1_700_000_102_000 },
  ] },
]

function manifestFor(b: ReturnType<typeof packRides>): RidesManifest {
  return {
    version: RIDES_SNAPSHOT_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    rideCount: 2,
    outOfRegionCount: 0,
    pointCount: 5,
    totalMeters: 1234,
    clipMeters: 500,
    resampleMeters: 10,
    bbox: { minLon: -105, minLat: 39.6, maxLon: -104.96, maxLat: 39.64 },
    rejected: { 'no-positions': 0, virtual: 35, 'out-of-region': 2, 'too-short-after-clip': 1 },
    byteLengths: {
      positions: b.positions.byteLength,
      startIndices: b.startIndices.byteLength,
      times: b.times.byteLength,
    },
  }
}

describe('packRides', () => {
  it('produces one startIndex per ride plus a terminator', () => {
    expect(Array.from(packRides(RIDES).startIndices)).toEqual([0, 2, 5])
  })

  it('preserves coordinates exactly', () => {
    const b = packRides(RIDES)
    expect(ridePoints(b, 0)).toEqual([-105.0, 39.6, -104.99, 39.61])
    expect(ridePoints(b, 1)).toEqual([-104.98, 39.62, -104.97, 39.63, -104.96, 39.64])
  })

  it('stores one start time per ride, for the M6 scrubber', () => {
    expect(Array.from(packRides(RIDES).times)).toEqual([1_700_000_000_000, 1_700_000_100_000])
  })

  it('handles an empty ride list', () => {
    const b = packRides([])
    expect(b.positions.length).toBe(0)
    expect(Array.from(b.startIndices)).toEqual([0])
  })
})

describe('validateRides', () => {
  it('accepts a matching manifest', () => {
    const b = packRides(RIDES)
    expect(() => validateRides(manifestFor(b), b)).not.toThrow()
  })

  it('rejects a version mismatch', () => {
    const b = packRides(RIDES)
    try {
      validateRides({ ...manifestFor(b), version: RIDES_SNAPSHOT_VERSION + 1 }, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as RidesSnapshotError).code).toBe('VERSION_MISMATCH')
    }
  })

  it('rejects a truncated buffer', () => {
    const b = packRides(RIDES)
    try {
      validateRides(manifestFor(b), { ...b, positions: b.positions.slice(0, 4) })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as RidesSnapshotError).code).toBe('TRUNCATED')
    }
  })

  it('rejects a terminator that disagrees with pointCount', () => {
    const b = packRides(RIDES)
    try {
      validateRides({ ...manifestFor(b), pointCount: 99 }, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as RidesSnapshotError).code).toBe('MISALIGNED')
    }
  })
})
