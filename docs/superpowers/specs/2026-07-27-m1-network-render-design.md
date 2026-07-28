# M1 — Overpass fetch → multi-region network render

**Date:** 2026-07-27
**Milestone:** M1 of `~/Sites/ideas/street-coverage.md`
**Status:** approved, not implemented

---

## Goal

`npm run dev` renders the street network of the Denver metro core over a basemap at
interactive framerates, with a stats panel reporting what is on screen and a single
headline percentage that later milestones fill in.

M1 proves deck.gl at scale and establishes the data pipeline. It computes no coverage.

## Scope

**In:** Overpass fetch pipeline, binary snapshot format, region registry, MapLibre +
deck.gl render, stats panel, Vitest over the pure modules.

**Out:** GPX parsing, coverage computation, Supabase/PostGIS, neighborhood breakdown,
timeline scrubber, route planning. No auth, no database, no Strava.

---

## Decisions

Settled during brainstorming. Not open questions.

| Decision | Choice | Why |
|---|---|---|
| Basemap | MapLibre GL + free tiles | No token, no account, repo can go public immediately. Same API surface as Mapbox GL v1; swappable in one file if the Mapbox résumé line is wanted later. |
| Overpass access | Offline script → committed snapshot | Honors the "cache the extract" and "version the snapshot" gotchas. Stable denominator, fast dev loop, no rate-limit exposure at runtime. |
| Render attributes | Binary typed arrays from day one | The single biggest perf win at this scale, and harder to retrofit than to start with. |
| Metro extent | Union of incorporated places | County boundaries carry mountain and plains roads that will never be ridden, making 100% unreachable and the percentage meaningless. |
| Headline number | One percentage over `metro-core` | A single moving number is the progress bar the project depends on. Away regions are tracked separately and excluded from it. |
| Iowa / RAGBRAI | Route-corridor region, post-M2 | RAGBRAI is a route, not a place. The corridor is defined by the GPX, which does not exist until M2. Zero M1 overhead. |

---

## Findings that shaped the design

Verified against live OSM and Overpass on 2026-07-27.

**Denver's boundary is `admin_level=6`, not 8.** Relation `1411339`. Denver is a
consolidated city-county, so it carries the county admin level while functioning as the
city. A name-based query (`area["name"="Denver"]`) is ambiguous across OSM, and an
`admin_level=8` filter matches nothing at all. The registry pins numeric OSM IDs for
exactly this reason.

**Not every boundary is a relation.** The unincorporated places next to Littleton are
census designated places mapped as OSM *ways*: Columbine (`way 33168093`), Ken Caryl
(`way 624295048`). Highlands Ranch (`relation 19685245`) is a census boundary with no
`admin_level` at all.

**The `2400000000 + wayId` area formula does not work, and `map_to_area` does.** Measured:

| Query form | Columbine result |
|---|---:|
| `area(2400033168093)` | **0 ways** |
| `way(33168093); map_to_area->.r;` | **1,052 ways** |

Overpass only materializes way-derived areas for ways in its areas file, and these CDPs are
not in it. `map_to_area` derives the area from the element directly and works for both
kinds — Ken Caryl resolves to 1,363 ways, Littleton (a relation) to 2,055.

So the query builder uses **one uniform mechanism**: seed with `rel(id);` or `way(id);`
according to `osmKind`, then pipe through `map_to_area`. No offset arithmetic anywhere.

```
[out:json][timeout:180];
{rel|way}(<osmId>); map_to_area -> .r;
way(area.r)["highway"~"^(primary|secondary|tertiary|residential|living_street|unclassified|cycleway)$"]
  ["access"!~"private"];
(._;>;);
out body;
```

This is also why the fetcher must treat a zero-way response as a failure rather than an
empty region — the broken formula returned a clean, parseable, entirely wrong `0`.

**Overpass is unreliable enough to design around.** During sizing, 6 of 10 probe queries
failed and two of three public mirrors were returning dispatcher timeouts. Failures arrive
as **HTTP 200 with an HTML error body**, so status-code checks alone will silently write
corrupt snapshots. Separately, `overpass.osm.ch` responds fast but holds only Switzerland —
it returns `0` results for Colorado rather than an error, so it must stay out of the
mirror pool.

**Scale, measured.** Metro-core regions:

| Region | Ways | Unique nodes |
|---|---:|---:|
| Denver | 22,994 | 139,040 |
| Lakewood | 6,728 | 44,379 |
| Centennial | 4,885 | 49,745 |
| Littleton | 2,052 | 13,608 |
| Greenwood Village | 1,821 | 12,544 |
| Englewood | 984 | 6,498 |
| Sheridan | 304 | 2,385 |
| **Total** | **39,768** | **268,199** |

About 6.7 unique nodes per way.

**Positions are not `nodeCount × 2`.** Overpass `out count` reports *unique* nodes, but the
positions array stores each way's node list independently, so nodes shared between ways —
every intersection — are duplicated once per way that references them. On a street grid
that inflates the array by roughly 30–50%, putting the core near **350k–400k position
entries ≈ 5.6–6.4 MB** of Float64, not 4.3 MB. Still committable, and git compresses
coordinate data well, but `build-snapshot.ts` must report the true packed byte count rather
than deriving it from node counts. This is the first number to verify against reality during
implementation.

Whole counties, for contrast — larger and mostly unrideable, which is what ruled the
county approach out: Jefferson 27,283 ways, Arapahoe 25,453, Adams 23,180, Denver 22,940,
Douglas 16,621, Broomfield 4,058.

Future regions are cheap: Summit County **2,156** ways, Castle Rock **3,515**,
Highlands Ranch **2,837**, Ken Caryl **1,363**, Columbine **1,052**.

**The denominator already moved during design.** Littleton measured 2,052 ways at one point
and 2,055 roughly forty minutes later — live OSM edits, mid-session. This is the
"denominator moves" gotcha appearing before a line of code was written, and it is the
concrete reason the manifest pins `osmTimestamp` and the snapshot is versioned. Coverage
percentages are only comparable within a snapshot version.

---

## Architecture

### Region registry

`src/network/regions.ts` is the single source of truth. Adding a region is one entry plus
a re-fetch; no code changes anywhere else.

```ts
export type RegionGroup = 'metro-core' | 'metro-outer' | 'mountain' | 'route'

export type Region = {
  id: string            // stable slug, used in filenames
  name: string          // display name
  osmId: number
  osmKind: 'relation' | 'way'
  group: RegionGroup
}
```

`metro-core` is the set the headline percentage is computed over. Every other group
displays separately and is excluded from it.

**M1 fetches `metro-core` only:**

| id | name | OSM id | kind |
|---|---|---|---|
| `littleton` | Littleton | 112959 | relation |
| `denver` | Denver | 1411339 | relation |
| `englewood` | Englewood | 7243979 | relation |
| `centennial` | Centennial | 112951 | relation |
| `greenwood-village` | Greenwood Village | 112940 | relation |
| `lakewood` | Lakewood | 112200 | relation |
| `sheridan` | Sheridan | 7240527 | relation |

**Registered but not fetched in M1**, present to prove the registry and make expansion a
config change: Highlands Ranch (`19685245`, relation), Columbine (`33168093`, way),
Ken Caryl (`624295048`, way), Castle Rock (`112343`, relation) — all `metro-outer`;
Summit County (`441008`, relation) as `mountain`.

### Two-stage pipeline

Overpass never runs at application runtime.

```
scripts/fetch-network.ts     Overpass → data/raw/<region>-<date>.json   (gitignored)
scripts/build-snapshot.ts    raw JSON → public/network/<region>/*       (committed)
```

`fetch-network.ts` owns all network flakiness:

- Mirror pool: `overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`.
  Explicitly **not** `overpass.osm.ch`.
- Exponential backoff, rotating mirrors across attempts.
- Treats any response body beginning with `<` as an error regardless of HTTP status.
- Treats a zero-way response as a failure, not an empty region.
- Per-region: writes each raw response as it lands, skips regions already on disk unless
  `--force`. A run that dies on region 6 must not restart from region 1.
- CLI: `--region <id>`, `--group <group>`, `--all`, `--force`.

`build-snapshot.ts` resolves node refs to coordinates, drops ways with fewer than two
resolvable nodes, computes per-way length, and packs to binary.

### Snapshot format

Per region, under `public/network/<region>/`:

| File | Type | Contents |
|---|---|---|
| `manifest.json` | JSON | version, generatedAt, osmTimestamp, osmId, osmKind, queryHash, bbox, wayCount, nodeCount, totalMeters, classes[], byteLengths |
| `positions.bin` | Float64Array | `[lon, lat, lon, lat, ...]` |
| `startIndices.bin` | Uint32Array | `wayCount + 1` offsets into positions |
| `wayIds.bin` | Float64Array | OSM way IDs exceed 2^32, so not Uint32 |
| `classes.bin` | Uint8Array | highway class index per way |

Plus `public/network/index.json` listing available regions and their manifest hashes.

The manifest is the versioned denominator. Coverage percentages stay comparable across
snapshots, and re-fetching becomes an explicit, dated event rather than silent drift.

### Coordinate precision

Float32 at longitude −105 carries roughly 1.4 m of error — visible on a 30 m street grid,
and unusable for M3's 25 m coverage radius.

So: **store Float64, render Float32 relative to an origin.** The layer subtracts a
`coordinateOrigin` (region bbox center) and passes offsets through
`COORDINATE_SYSTEM.LNGLAT_OFFSETS`, restoring centimeter precision inside a 32-bit
attribute. Full precision stays in the snapshot for coverage math in M3.

### Module layout

```
src/
  network/
    regions.ts      region registry                              [pure, tested]
    overpass.ts     query builder, mirror client, error detection [script-only]
    normalize.ts    OSM elements → ways with resolved coords      [pure, tested]
    snapshot.ts     pack / unpack binary                          [pure, tested]
    useNetwork.ts   React hook: fetch, decode, loading/error
  geo/
    haversine.ts    distance, path length                         [pure, tested]
    bounds.ts       bbox, center, lnglat offsets                  [pure, tested]
  layers/
    networkLayer.ts PathLayer factory, binary attributes, colors
  components/
    MapView.tsx     MapLibre basemap + DeckGL overlay
    StatsPanel.tsx  headline %, per-region rows, decode ms, FPS
  App.tsx
scripts/
  fetch-network.ts
  build-snapshot.ts
```

The pure modules carry the test suite. The React surface stays thin deliberately.

### Rendering

One `PathLayer` per region, fed binary:

```ts
data: {
  length: wayCount,
  startIndices,                            // Uint32Array
  attributes: { getPath: { value: positions32, size: 2 } }
}
_pathType: 'open'
coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS
coordinateOrigin: [originLon, originLat]
```

Color by highway class through an index accessor over `classes.bin` — five classes, so the
map reads as a real street map rather than one flat color. This is the same styling path
M3 reuses to recolor by coverage, so `updateTriggers` is wired from the start.

Regions render as they arrive rather than waiting for the full set.

### Stats panel

- Headline: one percentage over `metro-core`. In M1 it reads `0%` with a populated
  denominator — the number is real and honest, it simply has no numerator until M3.
- Per-region rows: name, ways, nodes, centerline km.
- Diagnostics: snapshot version, decode ms, current FPS.

### Error handling

Each surfaces as a distinct named state in the UI:

- snapshot fetch failure (network, 404)
- manifest/binary version mismatch
- truncated or misaligned buffer (`byteLength` disagrees with manifest)
- zero regions loaded

A blank map is the failure mode to avoid — it is indistinguishable from being zoomed
somewhere empty.

---

## Testing

Vitest over the pure modules:

- `geo/haversine` — known distances, identical points, path length accumulation
- `geo/bounds` — bbox over a point set, center, offset round-trip
- `network/regions` — query construction emits `rel(id)` vs `way(id)` per `osmKind` and
  always routes through `map_to_area`; group filtering; slug uniqueness
- `network/normalize` — node ref resolution, ways with missing nodes dropped, ways with
  fewer than two nodes dropped, tag → class mapping
- `network/snapshot` — pack/unpack round-trip preserves geometry exactly; truncated buffer
  rejected; version mismatch rejected

`overpass.ts` mirror rotation and error detection are tested against recorded fixtures,
including a captured dispatcher-timeout HTML body and a Switzerland-style
empty-but-valid response.

---

## Done when

- `npm run fetch:network -- --group metro-core` then `npm run build:snapshot` produces
  seven committed region snapshots
- `npm run dev` renders all seven as one continuous street map over MapLibre, panning and
  zooming smoothly
- Stats panel shows the headline percentage, per-region rows, and diagnostics
- `npm test` passes
- Adding an eighth region requires only a registry entry and a re-fetch
- Baseline numbers recorded for the M7 perf table: snapshot bytes, way count, node count,
  decode ms, FPS

---

## Deferred, with reasons

| Deferred | To | Why |
|---|---|---|
| Dual-carriageway pairing | M3+ | Only matters once coverage exists |
| Node densification on sparse ways | M3 | A coverage-accuracy concern, not a render concern |
| Douglas–Peucker display simplification | M7 | Measure before optimizing; ~40k paths may not need it |
| Web Worker for decode | M7 | Same reason — measure first |
| PostGIS | M4 | M1 is deliberately client-only |
| Away-region rendering (Summit, Iowa) | post-M2 | Registered in M1, fetched later |
