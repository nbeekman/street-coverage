import type { Bbox } from '../geo/bounds.ts'
import type { NormalizedWay } from './normalize.ts'
import type { OsmKind, RegionGroup } from './regions.ts'

/**
 * Bump when the layout OR the meaning of the data changes. Invalidates
 * snapshots on disk.
 *
 * v2: HIGHWAY_CLASSES gained bike-legal `path` and `bridleway`, so a v1
 * snapshot has a different denominator. Loading one against v2 code would
 * silently compute the wrong coverage percentage.
 *
 * v3: gained `footway` where bicycle=designated. Same reasoning -- a v2
 * snapshot is missing designated bike paths and reports a smaller denominator.
 */
export const SNAPSHOT_VERSION = 3

export type SnapshotBuffers = {
  /** Flat [lon, lat, ...] Float64. Shared nodes are duplicated per way. */
  positions: Float64Array
  /** wayCount + 1 vertex offsets; last entry is the total vertex count. */
  startIndices: Uint32Array
  wayIds: Float64Array
  classes: Uint8Array
}

export type SnapshotManifest = {
  version: number
  regionId: string
  regionName: string
  group: RegionGroup
  osmId: number
  osmKind: OsmKind
  generatedAt: string
  /** Overpass `timestamp_osm_base` -- pins the denominator to an OSM instant. */
  osmTimestamp: string
  queryHash: string
  bbox: Bbox
  wayCount: number
  /** Vertex count including duplicated shared nodes. */
  positionCount: number
  /** Distinct OSM nodes referenced; always <= positionCount. */
  uniqueNodeCount: number
  totalMeters: number
  classes: string[]
  byteLengths: {
    positions: number
    startIndices: number
    wayIds: number
    classes: number
  }
}

export type SnapshotErrorCode = 'VERSION_MISMATCH' | 'TRUNCATED' | 'MISALIGNED'

export class SnapshotError extends Error {
  code: SnapshotErrorCode

  constructor(code: SnapshotErrorCode, message: string) {
    super(message)
    this.name = 'SnapshotError'
    this.code = code
  }
}

export function packSnapshot(ways: NormalizedWay[]): SnapshotBuffers {
  const wayCount = ways.length

  let vertexCount = 0
  for (const w of ways) vertexCount += w.coords.length / 2

  const positions = new Float64Array(vertexCount * 2)
  const startIndices = new Uint32Array(wayCount + 1)
  const wayIds = new Float64Array(wayCount)
  const classes = new Uint8Array(wayCount)

  let vertex = 0
  for (let i = 0; i < wayCount; i++) {
    const w = ways[i]
    startIndices[i] = vertex
    positions.set(w.coords, vertex * 2)
    vertex += w.coords.length / 2
    wayIds[i] = w.id
    classes[i] = w.classIndex
  }
  startIndices[wayCount] = vertex

  return { positions, startIndices, wayIds, classes }
}

/** Coordinates of one way, as a plain array. Test and debug helper. */
export function wayCoords(buffers: SnapshotBuffers, wayIndex: number): number[] {
  const start = buffers.startIndices[wayIndex]
  const end = buffers.startIndices[wayIndex + 1]
  return Array.from(buffers.positions.subarray(start * 2, end * 2))
}

export function validateSnapshot(
  manifest: SnapshotManifest,
  buffers: SnapshotBuffers,
): void {
  if (manifest.version !== SNAPSHOT_VERSION) {
    throw new SnapshotError(
      'VERSION_MISMATCH',
      `Snapshot version ${manifest.version} does not match expected ${SNAPSHOT_VERSION}. Re-run build:snapshot.`,
    )
  }

  const expected = manifest.byteLengths
  const actual = {
    positions: buffers.positions.byteLength,
    startIndices: buffers.startIndices.byteLength,
    wayIds: buffers.wayIds.byteLength,
    classes: buffers.classes.byteLength,
  }
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (actual[key] !== expected[key]) {
      throw new SnapshotError(
        'TRUNCATED',
        `Buffer "${key}" is ${actual[key]} bytes, manifest declares ${expected[key]}.`,
      )
    }
  }

  if (buffers.startIndices.length !== manifest.wayCount + 1) {
    throw new SnapshotError(
      'MISALIGNED',
      `startIndices has ${buffers.startIndices.length} entries, expected wayCount + 1 = ${manifest.wayCount + 1}.`,
    )
  }

  const terminator = buffers.startIndices[manifest.wayCount]
  if (terminator !== manifest.positionCount) {
    throw new SnapshotError(
      'MISALIGNED',
      `startIndices terminator is ${terminator}, manifest declares positionCount ${manifest.positionCount}.`,
    )
  }
}
