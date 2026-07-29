import { bboxesIntersect, type Bbox } from '../geo/bounds.ts'
import type { RawTrack, TrackPoint } from './types.ts'

// Re-exported for callers (and tests) that reached for it here first.
export { bboxesIntersect }

export type RejectReason =
  | 'no-positions'
  | 'virtual'
  | 'out-of-region'
  | 'too-short-after-clip'

export function trackBbox(points: TrackPoint[]): Bbox | null {
  if (points.length === 0) return null
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

const METERS_PER_DEGREE_LAT = 111_195

/** Grow a bbox by `meters`, widening longitude to account for latitude. */
export function padBbox(bbox: Bbox, meters: number): Bbox {
  const dLat = meters / METERS_PER_DEGREE_LAT
  const midLat = ((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180)
  // cos(lat) shrinks toward the poles; clamp so a polar bbox cannot explode.
  const dLon = dLat / Math.max(Math.cos(midLat), 0.01)
  return {
    minLon: bbox.minLon - dLon,
    minLat: bbox.minLat - dLat,
    maxLon: bbox.maxLon + dLon,
    maxLat: bbox.maxLat + dLat,
  }
}

// Compared lowercased, so these entries must be lowercase too.
const VIRTUAL_SUB_SPORTS = new Set(['virtualactivity'])
const VIRTUAL_MANUFACTURERS = new Set(['zwift'])

export type ClassifyOptions = {
  /**
   * Reject tracks outside the region bbox.
   *
   * Default false: a ride in Iowa is still a ride, and the rider wants to zoom
   * out and see it. Out-of-region rides contribute nothing to coverage anyway
   * -- there is no network out there to credit -- so keeping them costs only
   * the bytes of their geometry.
   */
  requireRegion?: boolean
}

/**
 * Decide whether a track belongs in the dataset.
 *
 * Returns null to keep, or the reason to reject. Order matters: virtual is
 * checked before region so a Watopia Zwift ride reports "virtual", which is
 * the actionable reason, rather than "out-of-region".
 */
export function classifyTrack(
  track: RawTrack,
  region: Bbox,
  options: ClassifyOptions = {},
): RejectReason | null {
  if (track.points.length === 0) return 'no-positions'

  const subSport = track.subSport?.toLowerCase()
  const manufacturer = track.manufacturer?.toLowerCase()
  if (
    (subSport !== undefined && VIRTUAL_SUB_SPORTS.has(subSport)) ||
    (manufacturer !== undefined && VIRTUAL_MANUFACTURERS.has(manufacturer))
  ) {
    return 'virtual'
  }

  const bbox = trackBbox(track.points)
  if (!bbox) return 'no-positions'
  if (options.requireRegion === true && !bboxesIntersect(region, bbox)) {
    return 'out-of-region'
  }

  return null
}

/** Whether a track touches the region. Recorded, not used to reject. */
export function isInRegion(track: RawTrack, region: Bbox): boolean {
  const bbox = trackBbox(track.points)
  return bbox !== null && bboxesIntersect(region, bbox)
}
