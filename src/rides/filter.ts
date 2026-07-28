import type { Bbox } from '../geo/bounds.ts'
import type { RawTrack, TrackPoint } from './types.ts'

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

export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return (
    a.minLon <= b.maxLon &&
    a.maxLon >= b.minLon &&
    a.minLat <= b.maxLat &&
    a.maxLat >= b.minLat
  )
}

// Compared lowercased, so these entries must be lowercase too.
const VIRTUAL_SUB_SPORTS = new Set(['virtualactivity'])
const VIRTUAL_MANUFACTURERS = new Set(['zwift'])

/**
 * Decide whether a track belongs in the dataset.
 *
 * Returns null to keep, or the reason to reject. Order matters: virtual is
 * checked before region so a Watopia Zwift ride reports "virtual", which is
 * the actionable reason, rather than "out-of-region".
 */
export function classifyTrack(track: RawTrack, region: Bbox): RejectReason | null {
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
  if (!bboxesIntersect(region, bbox)) return 'out-of-region'

  return null
}
