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

  it('defines exactly thirteen metro-core regions', () => {
    expect(regionsInGroup('metro-core')).toHaveLength(13)
  })

  it('pins Denver to relation 1411339', () => {
    // Denver is a consolidated city-county at admin_level 6, so a name lookup
    // or an admin_level=8 filter finds nothing. The numeric id is the contract.
    const denver = regionById('denver')
    expect(denver).toMatchObject({ osmId: 1411339, osmKind: 'relation' })
  })

  it('includes every way-boundary region in metro-core', () => {
    const ways = regionsInGroup('metro-core').filter((r) => r.osmKind === 'way')
    expect(ways.map((r) => r.id).sort()).toEqual(['bow-mar', 'columbine', 'ken-caryl'])
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

  it('builds a poly: query for polygon regions', () => {
    // Unincorporated county land belongs to no admin_level=8 boundary, so it
    // can only be described by an explicit ring.
    const q = buildOverpassQuery({
      id: 'test-poly',
      name: 'Test Poly',
      osmId: 0,
      osmKind: 'polygon',
      group: 'metro-core',
      polygon: [
        [39.6, -105.2],
        [39.7, -105.2],
        [39.7, -105.05],
        [39.6, -105.05],
      ],
    })
    expect(q).toContain('way(poly:"39.6 -105.2 39.7 -105.2 39.7 -105.05 39.6 -105.05")')
    expect(q).toContain('["access"!~"private"]')
    expect(q).not.toContain('map_to_area')
  })

  it('rejects a polygon region with no usable ring', () => {
    expect(() =>
      buildOverpassQuery({
        id: 'bad',
        name: 'Bad',
        osmId: 0,
        osmKind: 'polygon',
        group: 'metro-core',
      }),
    ).toThrow(/no usable ring/)
  })

  it('lists every polygon region after all boundary regions', () => {
    // REGIONS order is the dedup precedence in build-snapshot. A polygon
    // catch-all overlaps the boundaries it surrounds, so it must lose.
    const firstPolygon = REGIONS.findIndex((r) => r.osmKind === 'polygon')
    if (firstPolygon === -1) return
    const boundariesAfter = REGIONS.slice(firstPolygon).filter(
      (r) => r.osmKind !== 'polygon',
    )
    expect(boundariesAfter).toEqual([])
  })

  it('excludes private access and requests node geometry', () => {
    const q = buildOverpassQuery(regionById('littleton')!)
    expect(q).toContain('["access"!~"private"]')
    expect(q).toContain('(._;>;);')
    expect(q).toContain('out body;')
  })
})
