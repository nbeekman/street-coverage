# M3 — Node coverage, the headline percentage, streets recolored

**Date:** 2026-07-28
**Milestone:** M3 of `~/Sites/ideas/street-coverage.md`
**Status:** approved, not implemented
**Follows:** [M2 — ride import](2026-07-28-m2-ride-import-design.md)

---

## Goal

Connect the two datasets that currently sit side by side and never touch: the 51,086-way
street network from M1 and the 165 ride traces from M2.

M3 ends with a headline percentage that means something and a map where the streets you have
ridden are lit and the ones you have not are dim.

## Scope

**In:** node-to-trace matching over a spatial index, segment-level coverage derived from node
hits, covered-distance rollups, a versioned binary coverage snapshot, coverage-colored
rendering.

**Out:** PostGIS (M4), incremental per-ride updates (M4), neighbourhood breakdown (M5),
nearest-unridden (M5), the timeline scrubber (M6), dual-carriageway pairing.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Matching rule | Node coverage — a node is hit when any ride point is within the radius | Option A in the source doc. Robust to GPS noise, no perpendicular-distance math, no matching ambiguity. Failure modes are obvious rather than subtle. |
| Match radius | **25 m**, overridable with `--radius` | The doc's value and CityStrides' effective default. Forgiving of urban-canyon drift. Its cost is quantified below rather than hidden. |
| Segment rule | A segment is ridden when **both** endpoints are hit | Stops one stray GPS point from crediting a 400 m stretch never ridden. The "both" is the whole safeguard. |
| **Headline** | **Ridden metres / total metres** | Reads as "12% of Denver's street miles". Avoids the intersection-density bias that makes a raw node percentage mean something other than what a rider assumes. |
| Where it runs | Offline script → static binary snapshot | The source doc's "coverage computed once, cached". Matches the M1/M2 two-stage pattern and keeps M4's move to PostGIS a swap rather than a rewrite. |
| Rendering | Ways split into runs of ridden / unridden, one colour per run | An exact two-tone map. A half-ridden street renders half bright at the point the rider turned off, not as a uniform mid-colour. |
| Storage | **Gitignored** | Coverage is derived from ride traces. Which streets someone has ridden is location data, and publishing it would defeat M2's privacy clipping. |

---

## The performance problem, and why a grid

369,823 unique nodes against 151,382 ride points is **56 billion** distance tests. Nearly
every pair is tens of kilometres apart, so the work is making the question cheap rather than
making each test fast.

A uniform grid keyed at the match radius, built over the ride points and queried per node:

1. Hash all ride points into cells whose sides are at least `radius` metres. One pass.
2. For a node, examine its cell plus the 8 neighbours. Any point within `radius` **must**
   lie in those 9 cells, so nothing is missed.
3. Haversine decides each candidate.

Typical candidate counts drop from 151,382 to zero or a handful.

### Sizing the cells conservatively

The grid is in degrees; the radius is in metres; the conversion differs by axis and varies
with latitude. Getting this wrong silently loses matches, so both axes are sized to
guarantee a cell is **at least** `radius` metres across anywhere in the bbox:

```
cellLatDeg = radius / 110574                       // min metres per degree of latitude
cellLonDeg = radius / (111320 * cos(maxAbsLat))    // min metres per degree of longitude in bbox
```

Using the minimum metres-per-degree makes the cell larger, never smaller. The grid only
proposes candidates and haversine makes the final call, so a sizing error can cost speed but
cannot produce a wrong answer. A test asserts the grid returns exactly what brute force
returns over random points.

### Node identity

Node hits are computed **once per distinct OSM node id**, not once per vertex. Shared
intersection nodes appear in several ways; testing them repeatedly would be wasted work and
would make the "nodes hit" statistic count the same node many times. This is why M1 kept
`nodeRefs` on `NormalizedWay`.

---

## Architecture

```
scripts/build-coverage.ts   data/raw + data/rides  →  public/coverage/**   (gitignored)
```

### The denominator must match the map

Coverage computed over a different way set than the one rendered would produce a percentage
that does not correspond to the visible map. `build-snapshot.ts` already loads raw regions,
verifies query hashes, normalizes, and deduplicates ways by registry order.

That path is **extracted into `scripts/networkSource.ts`** and used by both scripts, so they
cannot drift. The coverage build additionally asserts that its per-region way counts equal
the counts in the rendered snapshot manifests, and refuses to write on a mismatch — the same
guard style that caught the stale-query bug in M1.

### Snapshot format

Per region, following the M1 pattern:

| File | Type | Contents |
|---|---|---|
| `public/coverage/manifest.json` | JSON | version, generatedAt, radiusMeters, per-region and total rollups, source network query hashes, source rides snapshot version |
| `public/coverage/<region>/positions.bin` | Float64Array | `[lon, lat, ...]` for run geometry |
| `public/coverage/<region>/startIndices.bin` | Uint32Array | `runCount + 1` offsets |
| `public/coverage/<region>/flags.bin` | Uint8Array | `1` ridden, `0` unridden, one per run |

A **run** is a maximal stretch of consecutive segments in one way sharing the same state.
Splitting a way at each state change duplicates one vertex per boundary; total geometry stays
close to the network's 440,416 vertices.

`COVERAGE_SNAPSHOT_VERSION` starts at 1 and bumps when the layout **or the meaning** changes
— including a change to the default radius, since that alters what the data represents.

### Rollups recorded per region and in total

- `coveredMeters` / `totalMeters` → the headline
- `nodesHit` / `uniqueNodeCount`
- `waysComplete` (every node hit) / `wayCount`

All three are cheap once node hits exist, and reporting several is more honest than
reporting one.

### Rendering

One `PathLayer` per region over the run geometry, coloured from `flags` through the
`updateTriggers.getColor` hook M1 left in place. When no coverage snapshot is present the
map falls back to M1's class-coloured network layers, so a fresh clone still renders.

A toggle switches between coverage colouring and M1's highway-class colouring. Both are
useful: coverage answers "where have I been", classes answer "is the network right".

### Module layout

```
src/coverage/
  grid.ts           PointGrid — uniform spatial hash              [pure, tested]
  nodes.ts          node hit computation over the grid            [pure, tested]
  segments.ts       runs, covered metres, way completion          [pure, tested]
  snapshot.ts       pack / unpack / validate                      [pure, tested]
  loadCoverage.ts   browser fetch + decode
  useCoverage.ts    React hook
src/layers/
  coverageLayer.ts  deck.gl PathLayer over runs
scripts/
  networkSource.ts  shared raw → normalize → dedup                [extracted]
  build-coverage.ts CLI
```

### Error handling

Named, distinct states, following M1 and M2:

- No rides snapshot → the build explains that `import:rides` must run first
- Way counts disagree with the rendered snapshot → refuse to write, name the region
- Coverage snapshot missing in the browser → render the class-coloured network and say
  coverage has not been computed, rather than showing an error
- Coverage version mismatch → distinct error code, tells the user to re-run the build

---

## Known limits, stated rather than discovered later

**Denver's grid will credit some streets ridden past.** Block spacing reaches ~30 m in
places and a 25 m radius reaches most of the way across. This is inherent to node coverage at
this radius. The build reports how many hit nodes lie on ways with no *other* evidence of
being ridden, giving the false-positive rate a number instead of a shrug. Segment-level map
matching is the upgrade path, and that upgrade is itself the interesting story.

**Streets near home can never reach 100%.** M2 clips 500 m from both ends of every ride, so
those nodes have no points near them by construction. Already in the README; repeated here so
it is not rediscovered as a bug.

**Dual carriageways read as half-ridden forever.** A divided road is two OSM ways and riding
one direction leaves the other unhit. M3 does not pair them. The build reports the share of
total metres carried by ways tagged `oneway=yes`, which bounds how much of the denominator is
affected.

---

## Testing

Vitest over the pure modules, with fixtures whose answers are known by hand:

- `grid` — finds a point at exactly the radius; excludes one just beyond; **matches brute
  force exactly** over random points; handles an empty point set; cells sized from the
  northernmost latitude still catch southern matches
- `nodes` — a node with a trace through it is hit; a node 1 km away is not; a shared node is
  tested once and reported once
- `segments` — both endpoints hit → ridden; one endpoint hit → not; runs split at each state
  change; a fully ridden way yields one run; covered metres equal the sum of ridden segment
  lengths
- `snapshot` — pack/unpack round-trips geometry exactly; version mismatch and truncated
  buffers raise distinct codes

Plus an end-to-end assertion in the build: covered metres never exceed total metres, and
per-region way counts match the rendered snapshot.

---

## Done when

- `npm run build:coverage` reports covered km, node hit rate, and completed ways
- `npm run dev` renders ridden streets lit and unridden dim, with a coverage/class toggle
- The headline percentage is non-zero and equals covered km / total km
- The panel honours the miles/kilometres toggle
- `npm test` passes, `tsc` clean
- No coverage or ride data is tracked by git — verified with `git ls-files`

---

## Deferred, with reasons

| Deferred | To | Why |
|---|---|---|
| PostGIS, `ST_DWithin`, GiST | M4 | The offline build is fast enough now; the database story is its own milestone |
| Incremental per-ride updates | M4 | A full recompute takes seconds; incremental only matters once it does not |
| Neighbourhood breakdown, nearest-unridden | M5 | Needs coverage to exist first |
| Dual-carriageway pairing | post-M5 | Bounded and reported in M3, solved later |
| Densifying sparse ways | post-M5 | The doc's gotcha: long ways with few nodes can complete early. Measured first, fixed if it bothers. |
