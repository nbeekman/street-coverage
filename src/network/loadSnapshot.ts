import { bboxOf, centerOf, toLngLatOffsets } from '../geo/bounds.ts'
import {
  validateSnapshot,
  type SnapshotBuffers,
  type SnapshotManifest,
} from './snapshot.ts'

export type LoadedRegion = {
  id: string
  name: string
  group: string
  manifest: SnapshotManifest
  buffers: SnapshotBuffers
  /** Render origin for LNGLAT_OFFSETS; the region bbox center. */
  origin: [number, number]
  /** Float32 lng/lat offsets from `origin`, ready for the GPU. */
  offsets: Float32Array
}

type FetchLike = typeof globalThis.fetch

const REBUILD_HINT =
  'Run "npm run fetch:network -- --group metro-core" then "npm run build:snapshot".'

/**
 * Fetch JSON defensively.
 *
 * A dev server with SPA fallback answers a missing file with index.html under
 * HTTP 200, so `res.ok` is not evidence the body is JSON -- the same failure
 * shape Overpass produces. Without the HTML check the user sees
 * "Unexpected token '<'" instead of being told the snapshot is missing.
 */
export async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  context: string,
): Promise<T> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`${context}: ${url} returned HTTP ${res.status}. ${REBUILD_HINT}`)
  }
  const text = await res.text()
  if (text.trimStart().startsWith('<')) {
    throw new Error(
      `${context}: ${url} returned HTML rather than JSON, which means the file is missing. ${REBUILD_HINT}`,
    )
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${context}: ${url} returned malformed JSON. ${REBUILD_HINT}`)
  }
}

async function getBuffer(
  fetchImpl: FetchLike,
  url: string,
  regionId: string,
): Promise<ArrayBuffer> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Region "${regionId}": ${url} returned HTTP ${res.status}`)
  }
  return res.arrayBuffer()
}

export async function loadRegion(
  id: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<LoadedRegion> {
  const base = `network/${id}`

  const manifest = await fetchJson<SnapshotManifest>(
    fetchImpl,
    `${base}/manifest.json`,
    `Region "${id}"`,
  )

  const [pos, starts, ids, classes] = await Promise.all([
    getBuffer(fetchImpl, `${base}/positions.bin`, id),
    getBuffer(fetchImpl, `${base}/startIndices.bin`, id),
    getBuffer(fetchImpl, `${base}/wayIds.bin`, id),
    getBuffer(fetchImpl, `${base}/classes.bin`, id),
  ])

  const buffers: SnapshotBuffers = {
    positions: new Float64Array(pos),
    startIndices: new Uint32Array(starts),
    wayIds: new Float64Array(ids),
    classes: new Uint8Array(classes),
  }

  // Throws SnapshotError with a specific code on version or size mismatch.
  validateSnapshot(manifest, buffers)

  const origin = centerOf(bboxOf(buffers.positions))
  const offsets = toLngLatOffsets(buffers.positions, origin)

  return {
    id,
    name: manifest.regionName,
    group: manifest.group,
    manifest,
    buffers,
    origin,
    offsets,
  }
}
