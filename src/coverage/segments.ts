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
  /**
   * Bitmask of year indices this stretch was ridden in; 0 when unridden.
   *
   * Runs split on a change of year as well as of ridden state. Grouping by
   * ridden state alone would force the whole run to share one year, and a
   * street ridden in 2018 and again in 2022 would answer a year filter wrongly
   * in one direction or the other.
   */
  years: number
}

export type WayCoverage = {
  runs: Run[]
  /** Length of each run in metres, index-aligned with `runs`. */
  runMeters: number[]
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

/**
 * Years a segment was ridden: the intersection of its endpoints' years.
 *
 * Intersection, not union. Riding one end in 2018 and the other in 2022 does
 * not mean the segment between them was ridden in either -- the same "both
 * endpoints" rule that stops a stray point crediting a stretch, applied per
 * year.
 */
export function segmentYears(
  yearsPerVertex: readonly number[] | undefined,
  segmentIndex: number,
): number {
  if (yearsPerVertex === undefined) return 0
  return yearsPerVertex[segmentIndex] & yearsPerVertex[segmentIndex + 1]
}

/** Split a way's segments into maximal runs of equal state and equal years. */
export function splitIntoRuns(
  hits: readonly boolean[],
  yearsPerVertex?: readonly number[],
): Run[] {
  const segmentCount = hits.length - 1
  if (segmentCount < 1) return []

  const stateAt = (i: number) => ({
    ridden: segmentRidden(hits, i),
    years: segmentRidden(hits, i) ? segmentYears(yearsPerVertex, i) : 0,
  })

  const runs: Run[] = []
  let current = stateAt(0)
  let start = 0

  for (let s = 1; s < segmentCount; s++) {
    const next = stateAt(s)
    if (next.ridden !== current.ridden || next.years !== current.years) {
      runs.push({ ...current, startVertex: start, endVertex: s })
      current = next
      start = s
    }
  }
  runs.push({ ...current, startVertex: start, endVertex: segmentCount })

  return runs
}

/**
 * Coverage for one way.
 *
 * `coords` is flat [lon, lat, ...]; `hits` is one flag per vertex.
 */
export function wayCoverage(
  coords: readonly number[],
  hits: readonly boolean[],
  yearsPerVertex?: readonly number[],
): WayCoverage {
  const segmentCount = hits.length - 1
  let coveredMeters = 0
  let totalMeters = 0
  const segmentMeters: number[] = []

  for (let s = 0; s < segmentCount; s++) {
    const length = haversineMeters(
      coords[s * 2],
      coords[s * 2 + 1],
      coords[s * 2 + 2],
      coords[s * 2 + 3],
    )
    segmentMeters.push(length)
    totalMeters += length
    if (segmentRidden(hits, s)) coveredMeters += length
  }

  const runs = splitIntoRuns(hits, yearsPerVertex)
  // A run spans segments startVertex..endVertex-1, so its length is the sum of
  // those segments. Summed here rather than recomputed so the run lengths and
  // the covered total can never disagree.
  const runMeters = runs.map((r) => {
    let m = 0
    for (let s = r.startVertex; s < r.endVertex; s++) m += segmentMeters[s]
    return m
  })

  return {
    runs,
    runMeters,
    coveredMeters,
    totalMeters,
    complete: hits.length > 0 && hits.every(Boolean),
  }
}
