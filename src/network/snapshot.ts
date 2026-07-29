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
 *
 * v4: the wire format ships Float32 offsets instead of Float64 positions.
 * The browser converted the one into the other on every load and then never
 * touched the Float64 again, so it was downloading twice the bytes to throw
 * half of them away. Coverage math runs offline from data/raw and is
 * unaffected. `wayIds` is still written but no longer fetched: nothing in the
 * browser reads it.
 */
export const SNAPSHOT_VERSION = 4

/**
 * What the build produces. Float64 throughout, because distances are measured
 * from these and the snapshot's own bbox and origin are derived from them.
 */
export type PackedBuffers = {
  /** Flat [lon, lat, ...] Float64. Shared nodes are duplicated per way. */
  positions: Float64Array
  /** wayCount + 1 vertex offsets; last entry is the total vertex count. */
  startIndices: Uint32Array
  wayIds: Float64Array
  classes: Uint8Array
}

/**
 * What the browser fetches. Half the bytes of PackedBuffers, and exactly what
 * the GPU wants.
 *
 * Float32 is only safe because these are offsets from a nearby origin: raw
 * Float32 lng/lat carries ~1.4 m of error at Denver's longitude, but a ~0.3
 * degree offset resolves to millimetres.
 */
export type SnapshotBuffers = {
  /** Flat [dLon, dLat, ...] Float32, relative to the manifest's origin. */
  offsets: Float32Array
  /** wayCount + 1 vertex offsets; last entry is the total vertex count. */
  startIndices: Uint32Array
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
  /** Origin the Float32 offsets are relative to; the bbox centre. */
  origin: [number, number]
  wayCount: number
  /** Vertex count including duplicated shared nodes. */
  positionCount: number
  /** Distinct OSM nodes referenced; always <= positionCount. */
  uniqueNodeCount: number
  totalMeters: number
  classes: string[]
  /** Only what the browser fetches. wayIds is written but not shipped. */
  byteLengths: {
    offsets: number
    startIndices: number
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

export function packSnapshot(ways: NormalizedWay[]): PackedBuffers {
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
export function wayCoords(buffers: PackedBuffers, wayIndex: number): number[] {
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
    offsets: buffers.offsets.byteLength,
    startIndices: buffers.startIndices.byteLength,
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
