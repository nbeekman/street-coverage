import type { Bbox } from '../geo/bounds.ts'
import type { RejectReason } from './filter.ts'
import type { Ride } from './types.ts'

/**
 * Bump when the layout OR the meaning changes.
 *
 * A change to the default clip distance counts as a meaning change: the same
 * layout would describe a different denominator once M3 computes coverage.
 *
 * v2: the dataset now includes rides outside the metro. Same layout, but
 * rideCount and totalMeters describe all riding rather than metro riding, and
 * the bbox can span the country.
 */
export const RIDES_SNAPSHOT_VERSION = 2

export type RidesBuffers = {
  /** Flat [lon, lat, ...] Float64. */
  positions: Float64Array
  /** rideCount + 1 point offsets; last entry is the total point count. */
  startIndices: Uint32Array
  /** Ride start time in epoch ms, one per ride. For the M6 timeline. */
  times: Float64Array
}

export type RidesManifest = {
  version: number
  generatedAt: string
  rideCount: number
  /** Of rideCount, how many fall outside the metro and score no coverage. */
  outOfRegionCount: number
  pointCount: number
  totalMeters: number
  /** Meters clipped from each end. Part of what the data means. */
  clipMeters: number
  resampleMeters: number
  bbox: Bbox
  rejected: Record<RejectReason, number>
  byteLengths: {
    positions: number
    startIndices: number
    times: number
  }
}

export type RidesSnapshotErrorCode = 'VERSION_MISMATCH' | 'TRUNCATED' | 'MISALIGNED'

export class RidesSnapshotError extends Error {
  code: RidesSnapshotErrorCode

  constructor(code: RidesSnapshotErrorCode, message: string) {
    super(message)
    this.name = 'RidesSnapshotError'
    this.code = code
  }
}

export function packRides(rides: Ride[]): RidesBuffers {
  let pointCount = 0
  for (const r of rides) pointCount += r.points.length

  const positions = new Float64Array(pointCount * 2)
  const startIndices = new Uint32Array(rides.length + 1)
  const times = new Float64Array(rides.length)

  let p = 0
  for (let i = 0; i < rides.length; i++) {
    startIndices[i] = p
    times[i] = rides[i].startTime
    for (const pt of rides[i].points) {
      positions[p * 2] = pt.lon
      positions[p * 2 + 1] = pt.lat
      p++
    }
  }
  startIndices[rides.length] = p

  return { positions, startIndices, times }
}

/** Flat [lon, lat, ...] for one ride. Test and debug helper. */
export function ridePoints(buffers: RidesBuffers, index: number): number[] {
  const start = buffers.startIndices[index]
  const end = buffers.startIndices[index + 1]
  return Array.from(buffers.positions.subarray(start * 2, end * 2))
}

export function validateRides(manifest: RidesManifest, buffers: RidesBuffers): void {
  if (manifest.version !== RIDES_SNAPSHOT_VERSION) {
    throw new RidesSnapshotError(
      'VERSION_MISMATCH',
      `Rides snapshot version ${manifest.version} does not match expected ${RIDES_SNAPSHOT_VERSION}. Re-run build:rides.`,
    )
  }

  const expected = manifest.byteLengths
  const actual = {
    positions: buffers.positions.byteLength,
    startIndices: buffers.startIndices.byteLength,
    times: buffers.times.byteLength,
  }
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (actual[key] !== expected[key]) {
      throw new RidesSnapshotError(
        'TRUNCATED',
        `Buffer "${key}" is ${actual[key]} bytes, manifest declares ${expected[key]}.`,
      )
    }
  }

  if (buffers.startIndices.length !== manifest.rideCount + 1) {
    throw new RidesSnapshotError(
      'MISALIGNED',
      `startIndices has ${buffers.startIndices.length} entries, expected rideCount + 1 = ${manifest.rideCount + 1}.`,
    )
  }

  const terminator = buffers.startIndices[manifest.rideCount]
  if (terminator !== manifest.pointCount) {
    throw new RidesSnapshotError(
      'MISALIGNED',
      `startIndices terminator is ${terminator}, manifest declares pointCount ${manifest.pointCount}.`,
    )
  }
}
