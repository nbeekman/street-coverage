import { haversineMeters } from '../geo/haversine.ts'

/**
 * A maximal stretch of consecutive segments in one way sharing a state.
 *
 * Vertex indices are inclusive at both ends: a run covering segments i..j
 * spans vertices i..j+1. Adjacent runs therefore share a vertex, which is the
 * one vertex each state change duplicates in the packed geometry.
 */
export type Run = {
  ridden: boolean
  startVertex: number
  endVertex: number
}

export type WayCoverage = {
  runs: Run[]
  coveredMeters: number
  totalMeters: number
  /** Every node in the way was hit. */
  complete: boolean
}

/**
 * A segment counts as ridden only when BOTH endpoints were hit.
 *
 * This is the safeguard against a single stray GPS point crediting a long
 * stretch that was never ridden -- one hit node cannot carry a segment on its
 * own.
 */
export function segmentRidden(hits: readonly boolean[], segmentIndex: number): boolean {
  return hits[segmentIndex] && hits[segmentIndex + 1]
}

/** Split a way's segments into maximal runs of equal state. */
export function splitIntoRuns(hits: readonly boolean[]): Run[] {
  const segmentCount = hits.length - 1
  if (segmentCount < 1) return []

  const runs: Run[] = []
  let state = segmentRidden(hits, 0)
  let start = 0

  for (let s = 1; s < segmentCount; s++) {
    const next = segmentRidden(hits, s)
    if (next !== state) {
      runs.push({ ridden: state, startVertex: start, endVertex: s })
      state = next
      start = s
    }
  }
  runs.push({ ridden: state, startVertex: start, endVertex: segmentCount })

  return runs
}

/**
 * Coverage for one way.
 *
 * `coords` is flat [lon, lat, ...]; `hits` is one flag per vertex.
 */
export function wayCoverage(coords: readonly number[], hits: readonly boolean[]): WayCoverage {
  const segmentCount = hits.length - 1
  let coveredMeters = 0
  let totalMeters = 0

  for (let s = 0; s < segmentCount; s++) {
    const length = haversineMeters(
      coords[s * 2],
      coords[s * 2 + 1],
      coords[s * 2 + 2],
      coords[s * 2 + 3],
    )
    totalMeters += length
    if (segmentRidden(hits, s)) coveredMeters += length
  }

  return {
    runs: splitIntoRuns(hits),
    coveredMeters,
    totalMeters,
    complete: hits.length > 0 && hits.every(Boolean),
  }
}
