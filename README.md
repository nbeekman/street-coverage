# Street Coverage

Ride every street in the Denver metro. The map fills in as you do.

M1 renders the network; coverage arrives in M3.

## Setup

```bash
npm install
npm run fetch:network -- --group metro-core   # Overpass -> data/raw (slow, flaky, resumable)
npm run build:snapshot                        # raw -> public/network (committed)
npm run dev
```

Snapshots are committed, so a fresh clone only needs `npm install && npm run dev`.

## How it works

Overpass is contacted only by the offline scripts, never at runtime. Each region is
packed into typed arrays — `positions` (Float64), `startIndices` (Uint32), `wayIds`
(Float64), `classes` (Uint8) — plus a manifest that pins the OSM timestamp so the
coverage denominator stays comparable between snapshots.

The browser feeds those arrays straight to a deck.gl `PathLayer` as binary attributes.
Geometry is stored Float64 for coverage math but uploaded as Float32 offsets from a
per-region origin: raw Float32 lng/lat carries ~1.4 m of error at Denver's longitude,
which is unusable next to a 25 m coverage radius.

## Regions

Regions are incorporated places and CDPs, not counties — county boundaries include
mountain and plains roads that will never be ridden, which would make 100% unreachable.
Adding one is a single entry in `src/network/regions.ts` followed by a re-fetch.

Some land belongs to no municipality at all. The strip between Littleton and Morrison is
unincorporated Jefferson County, so no boundary query can reach it even though it carries
S Kipling Pkwy and the C-470 Trail. Those areas use **polygon regions**
(`osmKind: 'polygon'`) — an explicit ring rather than an OSM boundary.

Regions may overlap. `build-snapshot` assigns each way to exactly one region, in `REGIONS`
order, so the headline denominator never double-counts. Two consequences worth knowing:

- **List polygon regions last.** They overlap the towns they surround and must lose.
- **Polygon rings can be drawn loosely.** The SW Metro ring is a plain rectangle; it
  fetches 14,276 ways and keeps only the 3,200 no boundary region claimed. No
  border-tracing needed.

The headline percentage covers the `metro-core` group only. Away regions (Summit County,
and an Iowa/RAGBRAI route corridor after M2) are tracked separately and excluded from it,
so the number on screen stays a meaningful progress bar.

## What counts as rideable

Ordinary streets count with no extra qualification: `primary`, `secondary`, `tertiary`,
`residential`, `unclassified`, `living_street`, `cycleway`.

`path` and `bridleway` count **only** when tagged `bicycle=yes` or `bicycle=designated`.
OSM tags bike-legal trails inconsistently — Bear Creek Lake Park has the Bear Creek and
Kipling trails as `cycleway`, but the Stone House, Connector, North Park and Greenbelt
trails as `path` or `bridleway`. Without the gated classes those all vanish from the map.

`footway` is excluded outright, even when tagged for bikes. It is overwhelmingly
sidewalks: including it adds 14,957 ways to the southwest metro against 1,493 for
`path`+`bridleway`, which would more than double the denominator with pavement nobody
sets out to "complete."

Excluded throughout: motorways, trunk roads, service alleys, and anything
`access=private`.

**`HIGHWAY_CLASSES` order is a storage contract.** `classes.bin` holds indices into that
array, so new classes are appended and never inserted. A test pins the original seven
positions.

## Gotchas worth knowing

Each of these cost real time; they are recorded so they only cost it once.

- **Denver is `admin_level=6`, not 8** (relation `1411339`) — it is a consolidated
  city-county. Name-based area lookups are ambiguous across OSM, so the registry pins
  numeric IDs.
- **Use `map_to_area`, never `area(3600000000 + id)`.** The offset form returns zero ways
  for way-based CDP boundaries like Columbine and Ken Caryl, because Overpass only
  materializes areas for ways in its areas file.
- **Overpass reports errors as HTTP 200 with an HTML body.** Status codes alone will
  happily write a corrupt snapshot. The client checks the body shape, and treats a
  zero-way response as a failure rather than an empty region.
- **`overpass.osm.ch` holds only Switzerland.** It answers fast and returns a valid,
  parseable, empty result for Colorado — worse than a timeout. It is excluded from the
  mirror pool on purpose.
- **`maplibre-gl` must stay on v5.** `react-map-gl@8` calls `map.transform.width`, which
  v6 removed, and its peer range (`>=1.13.0`) does not exclude the broken major.
- **Node needs explicit `.ts` extensions.** The scripts run under Node's native type
  stripping, which has no extensionless ESM resolution even though tsc and Vite accept it.
- **Vite caches pre-bundled deps.** A dependency version change looks like it did nothing
  until you clear `node_modules/.vite` or run with `--force`.

## Testing

```bash
npm test
```

Covers `src/geo`, `src/network`, `src/layers`, and the Overpass client. The React
components are deliberately thin and untested in M1.

## Data

Street network © OpenStreetMap contributors, ODbL. Basemap © CARTO.
