import { describe, expect, it } from 'vitest'
import type { Bbox } from '../geo/bounds.ts'
import { PointGrid } from './grid.ts'
import { computeNodeHits, wayHits, type CoverageWay } from './nodes.ts'

const DENVER: Bbox = { minLon: -105.2, minLat: 39.26, maxLon: -104.57, maxLat: 39.77 }

/** ~50 m of longitude at Denver's latitude, so nodes are comfortably apart. */
const STEP = 0.0006

function gridOf(coords: number[]): PointGrid {
  return new PointGrid(new Float64Array(coords), 25, DENVER)
}

describe('computeNodeHits', () => {
  it('hits a node the trace passes through', () => {
    const way: CoverageWay = {
      id: 1,
      coords: [-105.0, 39.7, -105.0 + STEP, 39.7],
      nodeRefs: [10, 11],
    }
    const grid = gridOf([-105.0, 39.7])
    const { hitNodeIds, uniqueNodeCount } = computeNodeHits([way], grid, 25)

    expect(hitNodeIds.has(10)).toBe(true)
    expect(hitNodeIds.has(11)).toBe(false)
    expect(uniqueNodeCount).toBe(2)
  })

  it('misses a node a kilometer from any point', () => {
    const way: CoverageWay = { id: 1, coords: [-105.0, 39.7, -105.0, 39.71], nodeRefs: [10, 11] }
    const grid = gridOf([-104.9, 39.6])
    expect(computeNodeHits([way], grid, 25).hitNodeIds.size).toBe(0)
  })

  it('counts a node shared by two ways exactly once', () => {
    // Both ways start at the same OSM node 10.
    const a: CoverageWay = { id: 1, coords: [-105.0, 39.7, -105.0 + STEP, 39.7], nodeRefs: [10, 11] }
    const b: CoverageWay = { id: 2, coords: [-105.0, 39.7, -105.0, 39.7 + STEP], nodeRefs: [10, 12] }
    const grid = gridOf([-105.0, 39.7])

    const { hitNodeIds, uniqueNodeCount } = computeNodeHits([a, b], grid, 25)

    // 4 vertices across the two ways, but only 3 distinct nodes.
    expect(uniqueNodeCount).toBe(3)
    expect(hitNodeIds.size).toBe(1)
    expect(hitNodeIds.has(10)).toBe(true)
  })

  it('reports nothing hit when there are no ride points', () => {
    const way: CoverageWay = { id: 1, coords: [-105.0, 39.7, -105.0 + STEP, 39.7], nodeRefs: [10, 11] }
    const { hitNodeIds, uniqueNodeCount } = computeNodeHits([way], gridOf([]), 25)
    expect(hitNodeIds.size).toBe(0)
    expect(uniqueNodeCount).toBe(2)
  })

  it('hits every node under a trace that follows the whole way', () => {
    const way: CoverageWay = {
      id: 1,
      coords: [-105.0, 39.7, -105.0 + STEP, 39.7, -105.0 + 2 * STEP, 39.7],
      nodeRefs: [10, 11, 12],
    }
    const grid = gridOf([-105.0, 39.7, -105.0 + STEP, 39.7, -105.0 + 2 * STEP, 39.7])
    expect(computeNodeHits([way], grid, 25).hitNodeIds.size).toBe(3)
  })

  it('widening the radius can only add hits', () => {
    const way: CoverageWay = {
      id: 1,
      coords: [-105.0, 39.7, -105.0 + STEP, 39.7],
      nodeRefs: [10, 11],
    }
    // A point midway between the two nodes: ~25 m from each.
    const mid = [-105.0 + STEP / 2, 39.7]
    const tight = computeNodeHits([way], new PointGrid(new Float64Array(mid), 10, DENVER), 10)
    const loose = computeNodeHits([way], new PointGrid(new Float64Array(mid), 40, DENVER), 40)

    expect(tight.hitNodeIds.size).toBe(0)
    expect(loose.hitNodeIds.size).toBe(2)
  })
})

describe('wayHits', () => {
  it('maps node ids to per-vertex flags in order', () => {
    const way: CoverageWay = {
      id: 1,
      coords: [0, 0, 1, 1, 2, 2],
      nodeRefs: [10, 11, 12],
    }
    expect(wayHits(way, new Set([10, 12]))).toEqual([true, false, true])
  })

  it('repeats the flag when a way revisits a node', () => {
    const way: CoverageWay = { id: 1, coords: [0, 0, 1, 1, 0, 0], nodeRefs: [10, 11, 10] }
    expect(wayHits(way, new Set([10]))).toEqual([true, false, true])
  })
})
