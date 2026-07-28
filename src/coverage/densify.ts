import { haversineMeters } from '../geo/haversine.ts'

/**
 * Insert interpolated points so no two consecutive points in a ride are more
 * than `maxGapMeters` apart.
 *
 * Node matching asks whether a ride point came within the radius of a node,
 * but the rider traveled the *line between* the points. Real traces are far
 * sparser than M2's 10 m resample target -- source recordings are already
 * coarse, leaving a median gap of ~23 m and a tail past 250 m -- so a node in
 * the middle of a long gap is missed even though the rider rode straight over
 * it. Densifying closes that gap and makes the point test approximate the
 * line test to within `maxGapMeters / 2`.
 *
 * This does not undo M2's resampling. That collapsed stationary clusters,
 * which stay collapsed; this only adds points along genuine movement.
 *
 * Interpolation is linear in lon/lat. Over gaps of a few hundred meters the
 * departure from a great circle is far below the match radius.
 */
export function densifyTrace(
  positions: Float64Array,
  startIndices: Uint32Array,
  maxGapMeters: number,
): Float64Array {
  if (maxGapMeters <= 0) return positions.slice()

  const out: number[] = []
  const rideCount = startIndices.length - 1

  for (let r = 0; r < rideCount; r++) {
    const start = startIndices[r]
    const end = startIndices[r + 1]
    if (end <= start) continue

    out.push(positions[start * 2], positions[start * 2 + 1])

    // Never interpolate across a ride boundary -- two rides on different days
    // would otherwise be joined by a straight line of phantom coverage.
    for (let v = start; v < end - 1; v++) {
      const lon1 = positions[v * 2]
      const lat1 = positions[v * 2 + 1]
      const lon2 = positions[v * 2 + 2]
      const lat2 = positions[v * 2 + 3]

      const gap = haversineMeters(lon1, lat1, lon2, lat2)
      const steps = Math.ceil(gap / maxGapMeters)
      for (let s = 1; s < steps; s++) {
        const t = s / steps
        out.push(lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t)
      }
      out.push(lon2, lat2)
    }
  }

  return new Float64Array(out)
}
