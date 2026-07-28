/** IUGG mean Earth radius, meters. */
const EARTH_RADIUS_M = 6371008.8
const DEG_TO_RAD = Math.PI / 180

export function haversineMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const phi1 = lat1 * DEG_TO_RAD
  const phi2 = lat2 * DEG_TO_RAD
  const dPhi = (lat2 - lat1) * DEG_TO_RAD
  const dLambda = (lon2 - lon1) * DEG_TO_RAD

  const sinDPhi = Math.sin(dPhi / 2)
  const sinDLambda = Math.sin(dLambda / 2)
  const a =
    sinDPhi * sinDPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda

  // Math.min guards against a > 1 from floating point error at antipodes.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Length of a polyline stored as a flat [lon, lat, lon, lat, ...] array.
 * Indices are vertex indices (not array indices); `endVertex` is exclusive.
 */
export function pathLengthMeters(
  positions: Float64Array,
  startVertex: number,
  endVertex: number,
): number {
  let total = 0
  for (let v = startVertex; v < endVertex - 1; v++) {
    total += haversineMeters(
      positions[v * 2],
      positions[v * 2 + 1],
      positions[v * 2 + 2],
      positions[v * 2 + 3],
    )
  }
  return total
}
