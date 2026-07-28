import { haversineMeters } from '../geo/haversine.ts'
import type { TrackPoint } from './types.ts'

/**
 * Thin a trace so kept points are at least `spacingMeters` apart.
 *
 * Distance-based, never time-based. A stopped rider emits hundreds of points
 * within a few metres; keeping them all biases M3's nearest-node matching
 * toward wherever the ride paused.
 *
 * Crucially this measures displacement from the LAST KEPT POINT, not
 * cumulative distance along the path. GPS jitter while stationary accumulates
 * real path length -- 300 jittering points rack up ~255 m without moving --
 * so a cumulative measure keeps the whole cluster and defeats the purpose.
 */
export function resampleByDistance(
  points: TrackPoint[],
  spacingMeters: number,
): TrackPoint[] {
  if (spacingMeters <= 0 || points.length <= 2) return points.slice()

  const out: TrackPoint[] = [points[0]]
  let last = points[0]

  for (let i = 1; i < points.length - 1; i++) {
    const moved = haversineMeters(last.lon, last.lat, points[i].lon, points[i].lat)
    if (moved >= spacingMeters) {
      out.push(points[i])
      last = points[i]
    }
  }

  out.push(points[points.length - 1])
  return out
}
