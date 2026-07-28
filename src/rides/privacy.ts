import { haversineMeters } from '../geo/haversine.ts'
import type { TrackPoint } from './types.ts'

/**
 * Drop the first and last `meters` of a trace.
 *
 * Rides start where you live. This runs in the importer, before anything is
 * written, so unclipped coordinates never reach disk.
 *
 * It permanently removes real coverage near every ride start -- streets within
 * `meters` of home may never reach 100%. That is the accepted cost of not
 * storing where you live.
 */
export function clipEnds(points: TrackPoint[], meters: number): TrackPoint[] {
  if (meters <= 0) return points.slice()
  if (points.length < 2) return []

  // First index at least `meters` along the track.
  let start = points.length
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    acc += haversineMeters(points[i - 1].lon, points[i - 1].lat, points[i].lon, points[i].lat)
    if (acc >= meters) {
      start = i
      break
    }
  }

  // Last index at least `meters` from the end.
  let end = -1
  acc = 0
  for (let i = points.length - 2; i >= 0; i--) {
    acc += haversineMeters(points[i].lon, points[i].lat, points[i + 1].lon, points[i + 1].lat)
    if (acc >= meters) {
      end = i
      break
    }
  }

  if (start > end) return []
  return points.slice(start, end + 1)
}
