import type { Bbox } from '../geo/bounds.ts'
import type { RegionGroup } from '../network/regions.ts'
import type { Run } from './segments.ts'

/**
 * Bump when the layout OR the meaning of the data changes.
 *
 * The match radius is part of the meaning: the same buffers built at 15 m and
 * at 25 m describe different claims about the world, so changing the default
 * radius is a version bump even though no field moves.
 *
 * v2: ships Float32 offsets instead of Float64 positions, halving the largest
 * payload. The browser converted one into the other on load and discarded the
 * Float64; coverage itself is computed offline from data/raw.
 */
export const COVERAGE_SNAPSHOT_VERSION = 2

/** What the build packs. Float64, because bbox and origin derive from it. */
export type PackedCoverageBuffers = {
  /** Flat [lon, lat, ...] Float64. Adjacent runs share a boundary vertex. */
  positions: Float64Array
  /** runCount + 1 vertex offsets; last entry is the total vertex count. */
  startIndices: Uint32Array
  /** 1 ridden, 0 unridden. One per run. */
  flags: Uint8Array
}

/** What the browser fetches: half the bytes, and what the GPU wants. */
export type CoverageBuffers = {
  /** Flat [dLon, dLat, ...] Float32, relative to the region's origin. */
  offsets: Float32Array
  /** runCount + 1 vertex offsets; last entry is the total vertex count. */
  startIndices: Uint32Array
  /** 1 ridden, 0 unridden. One per run. */
  flags: Uint8Array
}

export type ByteLengths = {
  offsets: number
  startIndices: number
  flags: number
}

export type RegionCoverage = {
  regionId: string
  regionName: string
  group: RegionGroup
  wayCount: number
  uniqueNodeCount: number
  nodesHit: number
  waysComplete: number
  totalMeters: number
  coveredMeters: number
  runCount: number
  riddenRunCount: number
  /** Origin the Float32 offsets are relative to; the region bbox centre. */
  origin: [number, number]
  /** Extent of this region, so the browser need not derive it. */
  bbox: Bbox
  positionCount: number
  byteLengths: ByteLengths
}

export type CoverageTotals = {
  wayCount: number
  uniqueNodeCount: number
  nodesHit: number
  waysComplete: number
  totalMeters: number
  coveredMeters: number
}

export type CoverageManifest = {
  version: number
  generatedAt: string
  radiusMeters: number
  /** Provenance: which ride snapshot produced these hits. */
  ridesSnapshotVersion: number
  rideCount: number
  ridePointCount: number
  /** Points after gap-filling; see `densifyTrace`. Part of what the hits mean. */
  densifiedPointCount: number
  densifyMeters: number
  regions: RegionCoverage[]
  /** metro-core only, matching the headline denominator. */
  totals: CoverageTotals
}

export type CoverageErrorCode = 'VERSION_MISMATCH' | 'TRUNCATED' | 'MISALIGNED'

export class CoverageError extends Error {
  code: CoverageErrorCode

  constructor(code: CoverageErrorCode, message: string) {
    super(message)
    this.name = 'CoverageError'
    this.code = code
  }
}

/** One way's geometry plus the runs it was split into. */
export type PackedWay = {
  /** Flat [lon, lat, ...]. */
  coords: readonly number[]
  runs: readonly Run[]
}

export function packCoverage(ways: readonly PackedWay[]): PackedCoverageBuffers {
  let runCount = 0
  let vertexCount = 0
  for (const way of ways) {
    for (const run of way.runs) {
      runCount++
      vertexCount += run.endVertex - run.startVertex + 1
    }
  }

  const positions = new Float64Array(vertexCount * 2)
  const startIndices = new Uint32Array(runCount + 1)
  const flags = new Uint8Array(runCount)

  let run = 0
  let vertex = 0
  for (const way of ways) {
    for (const r of way.runs) {
      startIndices[run] = vertex
      flags[run] = r.ridden ? 1 : 0
      for (let v = r.startVertex; v <= r.endVertex; v++) {
        positions[vertex * 2] = way.coords[v * 2]
        positions[vertex * 2 + 1] = way.coords[v * 2 + 1]
        vertex++
      }
      run++
    }
  }
  startIndices[runCount] = vertex

  return { positions, startIndices, flags }
}

/** Coordinates of one run, as a plain array. Test and debug helper. */
export function runCoords(buffers: PackedCoverageBuffers, runIndex: number): number[] {
  const start = buffers.startIndices[runIndex]
  const end = buffers.startIndices[runIndex + 1]
  return Array.from(buffers.positions.subarray(start * 2, end * 2))
}

export function validateCoverage(
  manifest: CoverageManifest,
  region: RegionCoverage,
  buffers: CoverageBuffers,
): void {
  if (manifest.version !== COVERAGE_SNAPSHOT_VERSION) {
    throw new CoverageError(
      'VERSION_MISMATCH',
      `Coverage snapshot version ${manifest.version} does not match expected ${COVERAGE_SNAPSHOT_VERSION}. Re-run build:coverage.`,
    )
  }

  const expected = region.byteLengths
  const actual: ByteLengths = {
    offsets: buffers.offsets.byteLength,
    startIndices: buffers.startIndices.byteLength,
    flags: buffers.flags.byteLength,
  }
  for (const key of Object.keys(expected) as (keyof ByteLengths)[]) {
    if (actual[key] !== expected[key]) {
      throw new CoverageError(
        'TRUNCATED',
        `Buffer "${key}" for ${region.regionId} is ${actual[key]} bytes, manifest declares ${expected[key]}.`,
      )
    }
  }

  if (buffers.startIndices.length !== region.runCount + 1) {
    throw new CoverageError(
      'MISALIGNED',
      `startIndices for ${region.regionId} has ${buffers.startIndices.length} entries, expected runCount + 1 = ${region.runCount + 1}.`,
    )
  }

  if (buffers.flags.length !== region.runCount) {
    throw new CoverageError(
      'MISALIGNED',
      `flags for ${region.regionId} has ${buffers.flags.length} entries, expected runCount ${region.runCount}.`,
    )
  }

  const terminator = buffers.startIndices[region.runCount]
  if (terminator !== region.positionCount) {
    throw new CoverageError(
      'MISALIGNED',
      `startIndices terminator for ${region.regionId} is ${terminator}, manifest declares positionCount ${region.positionCount}.`,
    )
  }
}
