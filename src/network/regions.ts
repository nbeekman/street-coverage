export type RegionGroup = 'metro-core' | 'metro-outer' | 'mountain' | 'route'
export type OsmKind = 'relation' | 'way'

export type Region = {
  /** Stable slug; used as the snapshot directory name. */
  id: string
  name: string
  osmId: number
  osmKind: OsmKind
  group: RegionGroup
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

  { id: 'castle-rock',       name: 'Castle Rock',       osmId: 112343,    osmKind: 'relation', group: 'metro-outer' },

  { id: 'summit-county',     name: 'Summit County',     osmId: 441008,    osmKind: 'relation', group: 'mountain' },
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
  const seed = region.osmKind === 'relation' ? 'rel' : 'way'
  const classes = HIGHWAY_CLASSES.join('|')
  return [
    '[out:json][timeout:180];',
    `${seed}(${region.osmId});map_to_area->.r;`,
    `way(area.r)["highway"~"^(${classes})$"]["access"!~"private"];`,
    '(._;>;);',
    'out body;',
  ].join('\n')
}
