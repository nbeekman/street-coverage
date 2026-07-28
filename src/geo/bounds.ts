export type Bbox = {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

/** Bounding box of a flat [lon, lat, ...] coordinate array. */
export function bboxOf(positions: Float64Array): Bbox {
  if (positions.length === 0) {
    throw new Error('bboxOf: positions array is empty')
  }
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  for (let i = 0; i < positions.length; i += 2) {
    const lon = positions[i]
    const lat = positions[i + 1]
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

export function centerOf(bbox: Bbox): [number, number] {
  return [(bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2]
}

/**
 * Convert absolute lng/lat to Float32 offsets from `origin`.
 *
 * Float32 has ~7 significant decimal digits. At longitude -105 that leaves
 * roughly 1.4 m of error, which is visible on a 30 m street grid and useless
 * beside a 25 m coverage radius. Subtracting a nearby origin first drops the
 * magnitude to ~0.3 degrees, where Float32 resolves to a few millimeters.
 */
export function toLngLatOffsets(
  positions: Float64Array,
  origin: [number, number],
): Float32Array {
  const offsets = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 2) {
    offsets[i] = positions[i] - origin[0]
    offsets[i + 1] = positions[i + 1] - origin[1]
  }
  return offsets
}
