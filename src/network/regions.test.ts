import { describe, expect, it } from 'vitest'
import {
  HIGHWAY_CLASSES,
  highwayClassIndex,
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
    // Polygon regions carry osmId 0 as a placeholder -- they are defined by
    // their ring, not by an OSM element -- so only real ids must be distinct.
    const keys = REGIONS.filter((r) => r.osmKind !== 'polygon').map(
      (r) => `${r.osmKind}:${r.osmId}`,
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every polygon region a ring and no osm id', () => {
    for (const r of REGIONS.filter((x) => x.osmKind === 'polygon')) {
      expect(r.osmId).toBe(0)
      expect(r.polygon?.length ?? 0).toBeGreaterThanOrEqual(3)
    }
  })

  // A deliberate tripwire: adding or losing a metro-core region moves the
  // headline denominator, so it should never happen silently.
  it('defines exactly nineteen metro-core regions', () => {
    expect(regionsInGroup('metro-core')).toHaveLength(19)
  })

  it('orders Cherry Creek State Park before Aurora, which surrounds it', () => {
    const ids = REGIONS.map((r) => r.id)
    expect(ids.indexOf('cherry-creek-state-park')).toBeLessThan(ids.indexOf('aurora'))
  })

  it('pins Denver to relation 1411339', () => {
    // Denver is a consolidated city-county at admin_level 6, so a name lookup
    // or an admin_level=8 filter finds nothing. The numeric id is the contract.
    const denver = regionById('denver')
    expect(denver).toMatchObject({ osmId: 1411339, osmKind: 'relation' })
  })

  it('includes every way-boundary region in metro-core', () => {
    const ways = regionsInGroup('metro-core').filter((r) => r.osmKind === 'way')
    expect(ways.map((r) => r.id).sort()).toEqual([
      'bow-mar',
      'cherry-creek-state-park',
      'columbine',
      'ken-caryl',
    ])
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
      'path',
      'bridleway',
      'footway',
    ])
  })

  it('keeps the original seven at their original indices', () => {
    // path/bridleway were appended in v2. If these shift, every classes.bin
    // written before the change silently recolors.
    expect(HIGHWAY_CLASSES.indexOf('primary')).toBe(0)
    expect(HIGHWAY_CLASSES.indexOf('cycleway')).toBe(6)
    expect(HIGHWAY_CLASSES.indexOf('path')).toBe(7)
    expect(HIGHWAY_CLASSES.indexOf('bridleway')).toBe(8)
  })
})

describe('highwayClassIndex', () => {
  it('accepts ordinary streets with no bicycle tag', () => {
    expect(highwayClassIndex('residential')).toBe(3)
    expect(highwayClassIndex('cycleway')).toBe(6)
  })

  it('accepts a path or bridleway open to bikes', () => {
    // Bear Creek Lake Park tags the Connector and Greenbelt trails this way.
    expect(highwayClassIndex('path', 'yes')).toBe(7)
    expect(highwayClassIndex('path', 'designated')).toBe(7)
    expect(highwayClassIndex('bridleway', 'yes')).toBe(8)
  })

  it('rejects a path or bridleway with no bicycle access', () => {
    expect(highwayClassIndex('path')).toBe(-1)
    expect(highwayClassIndex('path', 'no')).toBe(-1)
    expect(highwayClassIndex('bridleway')).toBe(-1)
  })

  it('accepts a footway only when bicycle=designated', () => {
    // A footway is overwhelmingly a sidewalk. bicycle=yes there means bikes
    // are merely permitted; only 'designated' says the way IS a bike route.
    // Accepting 'yes' would pull in pavement nobody sets out to complete.
    expect(highwayClassIndex('footway', 'designated')).toBe(
      HIGHWAY_CLASSES.indexOf('footway'),
    )
    expect(highwayClassIndex('footway', 'yes')).toBe(-1)
    expect(highwayClassIndex('footway')).toBe(-1)
    expect(highwayClassIndex('footway', 'dismount')).toBe(-1)
  })

  it('still accepts yes for path and bridleway', () => {
    // The looser gate is deliberate: these are not sidewalks.
    expect(highwayClassIndex('path', 'yes')).toBeGreaterThanOrEqual(0)
    expect(highwayClassIndex('bridleway', 'yes')).toBeGreaterThanOrEqual(0)
  })

  it('rejects motorways', () => {
    expect(highwayClassIndex('motorway')).toBe(-1)
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

  it('emits a separate selector per bicycle gate', () => {
    const q = buildOverpassQuery(regionById('littleton')!)
    // path and bridleway share the looser gate...
    expect(q).toMatch(/\(path\|bridleway\)\$"\]\["bicycle"~"\^\(designated\|yes\)\$"\]/)
    // ...while footway carries the strict one. Expressing it in the query
    // means Overpass never ships sidewalks we would only discard locally.
    expect(q).toMatch(/\(footway\)\$"\]\["bicycle"~"\^\(designated\)\$"\]/)
    // The street selector must NOT carry a bicycle requirement.
    const streetLine = q.split('\n').find((l) => l.includes('residential'))!
    expect(streetLine).not.toContain('bicycle')
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
