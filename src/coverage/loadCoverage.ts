import { bboxOf, centerOf, toLngLatOffsets, type Bbox } from '../geo/bounds.ts'
import { fetchJson } from '../network/loadSnapshot.ts'
import {
  validateCoverage,
  type CoverageBuffers,
  type CoverageManifest,
  type RegionCoverage,
} from './snapshot.ts'

export type LoadedCoverageRegion = {
  id: string
  region: RegionCoverage
  buffers: CoverageBuffers
  /** Extent of this region's geometry, for viewport culling. */
  bbox: Bbox
  /** Render origin for LNGLAT_OFFSETS; the region bbox center. */
  origin: [number, number]
  /** Float32 lng/lat offsets from `origin`, ready for the GPU. */
  offsets: Float32Array
}

export type LoadedCoverage = {
  manifest: CoverageManifest
  regions: LoadedCoverageRegion[]
}

type FetchLike = typeof globalThis.fetch

/** Distinguishes "not built yet" from "built but broken". */
export class CoverageAbsent extends Error {}

async function getBuffer(
  fetchImpl: FetchLike,
  url: string,
  regionId: string,
): Promise<ArrayBuffer> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Coverage region "${regionId}": ${url} returned HTTP ${res.status}`)
  }
  return res.arrayBuffer()
}

export async function loadCoverage(
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<LoadedCoverage> {
  let manifest: CoverageManifest
  try {
    manifest = await fetchJson<CoverageManifest>(
      fetchImpl,
      'coverage/manifest.json',
      'Coverage snapshot',
    )
  } catch {
    // Not having run the build is the normal state for a fresh clone, not an
    // error worth an error screen.
    throw new CoverageAbsent('Coverage has not been computed.')
  }

  const regions: LoadedCoverageRegion[] = []

  for (const region of manifest.regions) {
    const base = `coverage/${region.regionId}`
    const [pos, starts, flags] = await Promise.all([
      getBuffer(fetchImpl, `${base}/positions.bin`, region.regionId),
      getBuffer(fetchImpl, `${base}/startIndices.bin`, region.regionId),
      getBuffer(fetchImpl, `${base}/flags.bin`, region.regionId),
    ])

    const buffers: CoverageBuffers = {
      positions: new Float64Array(pos),
      startIndices: new Uint32Array(starts),
      flags: new Uint8Array(flags),
    }

    // Throws CoverageError with a specific code on version or size mismatch.
    validateCoverage(manifest, region, buffers)

    const bbox = bboxOf(buffers.positions)
    const origin = centerOf(bbox)
    regions.push({
      id: region.regionId,
      region,
      buffers,
      bbox,
      origin,
      offsets: toLngLatOffsets(buffers.positions, origin),
    })
  }

  return { manifest, regions }
}
