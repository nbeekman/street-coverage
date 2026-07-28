export type RegionGroup = 'metro-core' | 'metro-outer' | 'mountain' | 'route'

/**
 * How a region's extent is defined.
 *
 * `relation` and `way` resolve an OSM boundary. `polygon` is an explicit ring,
 * for land that belongs to no boundary at all -- unincorporated county
 * territory has no admin_level=8 place to attach to, but is still ridden.
 */
export type OsmKind = 'relation' | 'way' | 'polygon'

export type Region = {
  /** Stable slug; used as the snapshot directory name. */
  id: string
  name: string
  /** OSM element id for relation/way regions; 0 for polygon regions. */
  osmId: number
  osmKind: OsmKind
  group: RegionGroup
  /**
   * Closed [lat, lon] ring, polygon regions only.
   *
   * Polygon regions overlap the boundary regions they surround, so
   * build-snapshot assigns each way to exactly one region by REGIONS order.
   * List polygon regions last so boundaries win.
   */
  polygon?: readonly (readonly [number, number])[]
}

/**
 * Index order is a storage contract: classes.bin holds indices into this
 * array. Append only. Reordering recolors every existing snapshot.
 */
export const HIGHWAY_CLASSES = [
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
  'cycleway',
] as const

export type HighwayClass = (typeof HIGHWAY_CLASSES)[number]

export function highwayClassIndex(tag: string | undefined): number {
  if (tag === undefined) return -1
  return (HIGHWAY_CLASSES as readonly string[]).indexOf(tag)
}

/**
 * OSM ids verified against live Nominatim and Overpass on 2026-07-27.
 * Denver is admin_level 6 (consolidated city-county), not 8.
 * Columbine and Ken Caryl are census designated places mapped as ways.
 */
export const REGIONS: readonly Region[] = [
  { id: 'denver',            name: 'Denver',            osmId: 1411339,   osmKind: 'relation', group: 'metro-core' },
  { id: 'lakewood',          name: 'Lakewood',          osmId: 112200,    osmKind: 'relation', group: 'metro-core' },
  { id: 'centennial',        name: 'Centennial',        osmId: 112951,    osmKind: 'relation', group: 'metro-core' },
  { id: 'highlands-ranch',   name: 'Highlands Ranch',   osmId: 19685245,  osmKind: 'relation', group: 'metro-core' },
  { id: 'littleton',         name: 'Littleton',         osmId: 112959,    osmKind: 'relation', group: 'metro-core' },
  { id: 'greenwood-village', name: 'Greenwood Village', osmId: 112940,    osmKind: 'relation', group: 'metro-core' },
  { id: 'ken-caryl',         name: 'Ken Caryl',         osmId: 624295048, osmKind: 'way',      group: 'metro-core' },
  { id: 'columbine',         name: 'Columbine',         osmId: 33168093,  osmKind: 'way',      group: 'metro-core' },
  { id: 'englewood',         name: 'Englewood',         osmId: 7243979,   osmKind: 'relation', group: 'metro-core' },
  { id: 'sheridan',          name: 'Sheridan',          osmId: 7240527,   osmKind: 'relation', group: 'metro-core' },
  // Small municipalities interleaved with the larger ones, each found from a
  // visible hole in the rendered map. Bow Mar is an enclave ringed by
  // Littleton and Lakewood; Morrison is the Red Rocks approach; Cherry Hills
  // Village sits between Englewood, Greenwood Village and Littleton.
  { id: 'cherry-hills-village', name: 'Cherry Hills Village', osmId: 7560099, osmKind: 'relation', group: 'metro-core' },
  { id: 'morrison',          name: 'Morrison',          osmId: 18499983,  osmKind: 'relation', group: 'metro-core' },
  { id: 'bow-mar',           name: 'Bow Mar',           osmId: 194060379, osmKind: 'way',      group: 'metro-core' },

  { id: 'castle-rock',       name: 'Castle Rock',       osmId: 112343,    osmKind: 'relation', group: 'metro-outer' },

  { id: 'summit-county',     name: 'Summit County',     osmId: 441008,    osmKind: 'relation', group: 'mountain' },

  // Polygon regions MUST come after every boundary region: build-snapshot
  // dedupes in this order, so a catch-all never steals a way from the town it
  // overlaps.
  //
  // The land between Littleton and Morrison is unincorporated Jefferson
  // County -- Ken Caryl Ranch north, Willowbrook, Willow Springs. It belongs
  // to no admin_level=8 municipality, so no boundary query can reach it, yet
  // it carries S Kipling Pkwy, W Bowles Ave, the C-470 Trail and the Kipling
  // Trail. Measured 2026-07-28: 2,658 rideable ways east of the hogback.
  //
  // The ring stops at -105.18 to stay east of the hogback; deeper foothills
  // roads are mostly park trails and would put 100% out of reach.
  {
    id: 'sw-metro-unincorporated',
    name: 'SW Metro (unincorporated)',
    osmId: 0,
    osmKind: 'polygon',
    group: 'metro-core',
    polygon: [
      [39.73, -105.18],
      [39.73, -105.02],
      [39.52, -105.02],
      [39.52, -105.18],
    ],
  },
]

export function regionsInGroup(group: RegionGroup): Region[] {
  return REGIONS.filter((r) => r.group === group)
}

export function regionById(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id)
}

/**
 * `map_to_area` derives the area from the element itself. The alternative --
 * area(3600000000 + relId) / area(2400000000 + wayId) -- measurably returns
 * zero ways for way-based CDPs, because Overpass only materializes areas for
 * ways present in its areas file.
 */
export function buildOverpassQuery(region: Region): string {
  const classes = HIGHWAY_CLASSES.join('|')
  const filter = `["highway"~"^(${classes})$"]["access"!~"private"]`

  if (region.osmKind === 'polygon') {
    if (!region.polygon || region.polygon.length < 3) {
      throw new Error(`Region "${region.id}" is a polygon region with no usable ring.`)
    }
    // Overpass poly: takes a flat "lat lon lat lon ..." string.
    const ring = region.polygon.map(([lat, lon]) => `${lat} ${lon}`).join(' ')
    return [
      '[out:json][timeout:180];',
      `way(poly:"${ring}")${filter};`,
      '(._;>;);',
      'out body;',
    ].join('\n')
  }

  const seed = region.osmKind === 'relation' ? 'rel' : 'way'
  return [
    '[out:json][timeout:180];',
    `${seed}(${region.osmId});map_to_area->.r;`,
    `way(area.r)${filter};`,
    '(._;>;);',
    'out body;',
  ].join('\n')
}
