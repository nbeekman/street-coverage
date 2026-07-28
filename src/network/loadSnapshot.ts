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

  const manifestRes = await fetchImpl(`${base}/manifest.json`)
  if (!manifestRes.ok) {
    throw new Error(`Region "${id}": manifest returned HTTP ${manifestRes.status}`)
  }
  const manifest = (await manifestRes.json()) as SnapshotManifest

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
