import { describe, expect, it } from 'vitest'
import {
  HIGHWAY_CLASSES,
  REGIONS,
  buildOverpassQuery,
  regionById,
  regionsInGroup,
} from './regions'

describe('REGIONS', () => {
  it('has unique ids', () => {
    const ids = REGIONS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique osm ids', () => {
    const keys = REGIONS.map((r) => `${r.osmKind}:${r.osmId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('defines exactly ten metro-core regions', () => {
    expect(regionsInGroup('metro-core')).toHaveLength(10)
  })

  it('pins Denver to relation 1411339', () => {
    // Denver is a consolidated city-county at admin_level 6, so a name lookup
    // or an admin_level=8 filter finds nothing. The numeric id is the contract.
    const denver = regionById('denver')
    expect(denver).toMatchObject({ osmId: 1411339, osmKind: 'relation' })
  })

  it('includes both way-boundary CDPs in metro-core', () => {
    const ways = regionsInGroup('metro-core').filter((r) => r.osmKind === 'way')
    expect(ways.map((r) => r.id).sort()).toEqual(['columbine', 'ken-caryl'])
  })
})

describe('HIGHWAY_CLASSES', () => {
  it('is frozen in this exact order', () => {
    // classes.bin stores indices into this array. Reordering silently
    // recolors every snapshot already on disk.
    expect([...HIGHWAY_CLASSES]).toEqual([
      'primary',
      'secondary',
      'tertiary',
      'residential',
      'unclassified',
      'living_street',
      'cycleway',
    ])
  })
})

describe('buildOverpassQuery', () => {
  it('seeds a relation with rel()', () => {
    const q = buildOverpassQuery(regionById('denver')!)
    expect(q).toContain('rel(1411339);map_to_area->.r;')
  })

  it('seeds a way with way()', () => {
    const q = buildOverpassQuery(regionById('columbine')!)
    expect(q).toContain('way(33168093);map_to_area->.r;')
  })

  it('never uses area id offset arithmetic', () => {
    // area(2400000000 + wayId) measurably returns zero ways for these CDPs.
    const q = buildOverpassQuery(regionById('ken-caryl')!)
    expect(q).not.toMatch(/area\(\d{10,}\)/)
  })

  it('filters to every highway class', () => {
    const q = buildOverpassQuery(regionById('littleton')!)
    for (const cls of HIGHWAY_CLASSES) {
      expect(q).toContain(cls)
    }
  })

  it('excludes private access and requests node geometry', () => {
    const q = buildOverpassQuery(regionById('littleton')!)
    expect(q).toContain('["access"!~"private"]')
    expect(q).toContain('(._;>;);')
    expect(q).toContain('out body;')
  })
})
