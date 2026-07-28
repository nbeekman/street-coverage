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
  // Appended 2026-07-28. Indices 0-6 above must never move: classes.bin
  // stores indices into this array, so reordering recolors every snapshot.
  'path',
  'bridleway',
] as const

/**
 * Classes that only count when the way is explicitly open to bikes.
 *
 * OSM tags bike-legal trails inconsistently -- Bear Creek Lake Park has the
 * Bear Creek and Kipling trails as `cycleway` but the Stone House, Connector,
 * North Park and Greenbelt trails as `path` or `bridleway`. Requiring a
 * bicycle tag picks those up without swallowing footpaths.
 *
 * `footway` is deliberately absent: it is overwhelmingly sidewalks, and
 * including it more than doubles the denominator.
 */
export const BICYCLE_GATED_CLASSES: readonly string[] = ['path', 'bridleway']

const BICYCLE_ALLOWED = new Set(['yes', 'designated'])

export type HighwayClass = (typeof HIGHWAY_CLASSES)[number]

/**
 * Index into HIGHWAY_CLASSES, or -1 if the way is not rideable.
 *
 * `bicycle` is required for the gated classes; passing it is what keeps a
 * hiking-only path out of the denominator.
 */
export function highwayClassIndex(
  tag: string | undefined,
  bicycle?: string,
): number {
  if (tag === undefined) return -1
  const index = (HIGHWAY_CLASSES as readonly string[]).indexOf(tag)
  if (index < 0) return -1
  if (BICYCLE_GATED_CLASSES.includes(tag) && !BICYCLE_ALLOWED.has(bicycle ?? '')) {
    return -1
  }
  return index
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

  // East-metro corridor, added 2026-07-28 after coverage showed the Cherry
  // Creek Trail fragmenting and the reservoir loop missing entirely. Measured:
  // 17,976 of 151,382 ride points sat more than 60 m from any network node,
  // clustered here. Rides through this corridor drew as traces but could never
  // be credited, because no way existed to credit.
  //
  { id: 'glendale',          name: 'Glendale',          osmId: 112942,    osmKind: 'relation', group: 'metro-core' },
  { id: 'holly-hills',       name: 'Holly Hills',       osmId: 9569979,   osmKind: 'relation', group: 'metro-core' },
  // A protected area rather than a municipality: the reservoir loop belongs to
  // no town, which is why no boundary query reached it. Mapped as a way, so it
  // needs map_to_area like the other way-based regions.
  //
  // Listed before Aurora, which surrounds it, so the park keeps its own ways
  // and stays a distinct row rather than being absorbed.
  { id: 'cherry-creek-state-park', name: 'Cherry Creek State Park', osmId: 224202720, osmKind: 'way', group: 'metro-core' },
  // The whole east side, added 2026-07-28. It roughly doubles the unridden
  // denominator and drops the headline -- the honest trade, since the metro
  // does not stop at the edge of where these rides happen to have been.
  { id: 'aurora',            name: 'Aurora',            osmId: 112875,    osmKind: 'relation', group: 'metro-core' },

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

  // The strip between Holly Hills and Cherry Creek State Park, where the trail
  // runs through unincorporated Arapahoe County. Adding Glendale, Holly Hills
  // and the park left orphan ride points clustered at ~39.67, -104.89 -- this
  // ring closes that last gap.
  //
  // Widened 2026-07-28 to wrap the whole reservoir. The first ring stopped at
  // -104.855 to avoid pulling in Aurora, and that tightness left the trail
  // along the north shore -- tagged cycleway, bicycle=designated, plainly
  // rideable -- in a strip belonging to no region at all. Measured: the
  // nearest snapshot node to that trail was 186 m away.
  //
  // Keeping it tight is no longer necessary. Aurora is a boundary region and
  // is listed above, so it claims its own ways first and this ring only picks
  // up what nothing else covers.
  {
    id: 'cherry-creek-corridor',
    name: 'Cherry Creek corridor (unincorporated)',
    osmId: 0,
    osmKind: 'polygon',
    group: 'metro-core',
    polygon: [
      [39.690, -104.920],
      [39.690, -104.820],
      [39.590, -104.820],
      [39.590, -104.920],
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
  const open = HIGHWAY_CLASSES.filter((c) => !BICYCLE_GATED_CLASSES.includes(c))
  const gated = HIGHWAY_CLASSES.filter((c) => BICYCLE_GATED_CLASSES.includes(c))
  const notPrivate = '["access"!~"private"]'

  /** Two selectors: ordinary streets, plus paths only where bikes are allowed. */
  const selectors = (scope: string) =>
    [
      `way${scope}["highway"~"^(${open.join('|')})$"]${notPrivate};`,
      `way${scope}["highway"~"^(${gated.join('|')})$"]["bicycle"~"^(yes|designated)$"]${notPrivate};`,
    ].join('\n  ')

  if (region.osmKind === 'polygon') {
    if (!region.polygon || region.polygon.length < 3) {
      throw new Error(`Region "${region.id}" is a polygon region with no usable ring.`)
    }
    // Overpass poly: takes a flat "lat lon lat lon ..." string.
    const ring = region.polygon.map(([lat, lon]) => `${lat} ${lon}`).join(' ')
    return [
      '[out:json][timeout:180];',
      '(',
      '  ' + selectors(`(poly:"${ring}")`),
      ');',
      '(._;>;);',
      'out body;',
    ].join('\n')
  }

  const seed = region.osmKind === 'relation' ? 'rel' : 'way'
  return [
    '[out:json][timeout:180];',
    `${seed}(${region.osmId});map_to_area->.r;`,
    '(',
    '  ' + selectors('(area.r)'),
    ');',
    '(._;>;);',
    'out body;',
  ].join('\n')
}
