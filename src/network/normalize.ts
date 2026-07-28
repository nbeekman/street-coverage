import { highwayClassIndex } from './regions.ts'

export type OsmNode = {
  type: 'node'
  id: number
  lon: number
  lat: number
}

export type OsmWay = {
  type: 'way'
  id: number
  nodes: number[]
  tags?: Record<string, string>
}

export type OsmElement = OsmNode | OsmWay

export type NormalizedWay = {
  id: number
  classIndex: number
  /** Flat [lon, lat, lon, lat, ...]. */
  coords: number[]
  /**
   * OSM node ids, index-aligned with the coordinate pairs.
   *
   * Kept so unique-node counts can be recomputed after a caller filters the
   * way list -- and because M3's node coverage matches on node identity.
   */
  nodeRefs: number[]
}

export type NormalizedNetwork = {
  ways: NormalizedWay[]
  uniqueNodeCount: number
  droppedWays: number
}

export function normalize(elements: OsmElement[]): NormalizedNetwork {
  const nodeLon = new Map<number, number>()
  const nodeLat = new Map<number, number>()

  for (const el of elements) {
    if (el.type === 'node') {
      nodeLon.set(el.id, el.lon)
      nodeLat.set(el.id, el.lat)
    }
  }

  const ways: NormalizedWay[] = []
  const referenced = new Set<number>()
  let droppedWays = 0

  for (const el of elements) {
    if (el.type !== 'way') continue

    const classIndex = highwayClassIndex(el.tags?.highway, el.tags?.bicycle)
    if (classIndex < 0) {
      droppedWays++
      continue
    }

    const coords: number[] = []
    const seen: number[] = []
    for (const ref of el.nodes) {
      const lon = nodeLon.get(ref)
      const lat = nodeLat.get(ref)
      // A ref can be absent when the way straddles the boundary.
      if (lon === undefined || lat === undefined) continue
      coords.push(lon, lat)
      seen.push(ref)
    }

    if (coords.length < 4) {
      droppedWays++
      continue
    }

    for (const ref of seen) referenced.add(ref)
    ways.push({ id: el.id, classIndex, coords, nodeRefs: seen })
  }

  return { ways, uniqueNodeCount: referenced.size, droppedWays }
}
