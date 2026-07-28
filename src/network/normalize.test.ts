import { describe, expect, it } from 'vitest'
import { normalize, type OsmElement } from './normalize'

function node(id: number, lon: number, lat: number): OsmElement {
  return { type: 'node', id, lon, lat }
}

function way(id: number, nodes: number[], highway?: string): OsmElement {
  return { type: 'way', id, nodes, tags: highway ? { highway } : {} }
}

describe('normalize', () => {
  it('resolves node refs into flat coordinates', () => {
    const result = normalize([
      node(1, -105, 39.6),
      node(2, -104.9, 39.7),
      way(100, [1, 2], 'residential'),
    ])
    expect(result.ways).toHaveLength(1)
    expect(result.ways[0].id).toBe(100)
    expect(result.ways[0].coords).toEqual([-105, 39.6, -104.9, 39.7])
  })

  it('maps the highway tag to its class index', () => {
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      way(100, [1, 2], 'cycleway'),
    ])
    expect(result.ways[0].classIndex).toBe(6)
  })

  it('drops ways whose highway tag is not in the class list', () => {
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      way(100, [1, 2], 'motorway'),
    ])
    expect(result.ways).toHaveLength(0)
    expect(result.droppedWays).toBe(1)
  })

  it('drops ways with no highway tag at all', () => {
    const result = normalize([node(1, 0, 0), node(2, 0, 1), way(100, [1, 2])])
    expect(result.ways).toHaveLength(0)
    expect(result.droppedWays).toBe(1)
  })

  it('skips node refs that were not returned', () => {
    // Overpass can return a way whose nodes fall outside the requested set.
    const result = normalize([
      node(1, 0, 0),
      node(3, 0, 2),
      way(100, [1, 2, 3], 'residential'),
    ])
    expect(result.ways[0].coords).toEqual([0, 0, 0, 2])
  })

  it('drops ways left with fewer than two resolvable nodes', () => {
    const result = normalize([node(1, 0, 0), way(100, [1, 2], 'residential')])
    expect(result.ways).toHaveLength(0)
    expect(result.droppedWays).toBe(1)
  })

  it('counts unique referenced nodes, not repeats', () => {
    // Intersection nodes are shared between ways; the positions array
    // duplicates them but the unique count must not.
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      node(3, 0, 2),
      way(100, [1, 2], 'residential'),
      way(101, [2, 3], 'residential'),
    ])
    expect(result.uniqueNodeCount).toBe(3)
    expect(result.ways).toHaveLength(2)
  })

  it('preserves way order for deterministic snapshots', () => {
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      way(200, [1, 2], 'residential'),
      way(100, [1, 2], 'primary'),
    ])
    expect(result.ways.map((w) => w.id)).toEqual([200, 100])
  })
})
