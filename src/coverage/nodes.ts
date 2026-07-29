import type { PointGrid } from './grid.ts'

/**
 * The shape node matching needs from a way. Structurally satisfied by
 * `NormalizedWay`, but narrow enough to build by hand in a test.
 */
export type CoverageWay = {
  id: number
  /** Flat [lon, lat, lon, lat, ...]. */
  coords: number[]
  /** OSM node ids, index-aligned with the coordinate pairs. */
  nodeRefs: number[]
}

export type NodeHitResult = {
  /** OSM ids of nodes with a ride point within the radius. */
  hitNodeIds: Set<number>
  /**
   * Per hit node, a bitmask of the year indices it was hit in.
   *
   * Kept alongside the set rather than replacing it: a zero mask is a real
   * possibility if years are not being tracked, and conflating "not hit" with
   * "hit in no year" is exactly the kind of silent wrong answer this project
   * keeps guarding against.
   */
  yearMasks: Map<number, number>
  /** Distinct nodes considered -- the denominator for the hit rate. */
  uniqueNodeCount: number
}

/**
 * Decide, for every distinct OSM node in `ways`, whether a ride point passed
 * within `radiusMeters`.
 *
 * Keyed by node id rather than by vertex. Intersection nodes belong to several
 * ways, and testing one repeatedly would both waste work and inflate the hit
 * rate by counting the same node once per way that mentions it.
 */
export function computeNodeHits(
  ways: readonly CoverageWay[],
  grid: PointGrid,
  radiusMeters: number,
): NodeHitResult {
  const hitNodeIds = new Set<number>()
  const yearMasks = new Map<number, number>()
  const seen = new Set<number>()

  for (const way of ways) {
    for (let v = 0; v < way.nodeRefs.length; v++) {
      const id = way.nodeRefs[v]
      if (seen.has(id)) continue
      seen.add(id)
      const mask = grid.yearsWithin(way.coords[v * 2], way.coords[v * 2 + 1], radiusMeters)
      if (mask !== 0) {
        hitNodeIds.add(id)
        yearMasks.set(id, mask)
      }
    }
  }

  return { hitNodeIds, yearMasks, uniqueNodeCount: seen.size }
}

/** Per-vertex hit flags for one way, from the global hit set. */
export function wayHits(way: CoverageWay, hitNodeIds: ReadonlySet<number>): boolean[] {
  return way.nodeRefs.map((id) => hitNodeIds.has(id))
}
