# Measurements

Baseline numbers for the M7 performance write-up. Update whenever the snapshot is
rebuilt; note the snapshot version and OSM timestamp.

**About the figures below.** Network numbers — ways, vertices, kilometres per region — are
properties of OpenStreetMap and reproducible by anyone who runs the fetch. Ride numbers come
from **one sample Strava export** used during development, and are kept only because the
engineering findings (grid sizing, trace density, radius sensitivity) are meaningless without
the data that produced them. They are illustrative, not a target: your own export will
produce entirely different coverage figures.

## M1 — snapshot build

Snapshot version 2. Fetched 2026-07-28. Filter includes bike-legal `path`/`bridleway`.

| Region | Ways | Vertices | Unique nodes | km | MB |
|---|---:|---:|---:|---:|---:|
| Denver | 23,603 | 180,412 | 145,431 | 4,159 | 3.19 |
| Lakewood | 7,519 | 64,627 | 54,583 | 1,285 | 1.13 |
| Centennial | 5,003 | 57,225 | 50,794 | 885 | 0.98 |
| SW Metro (unincorporated) | 3,502 | 35,967 | 31,704 | 714 | 0.62 |
| Highlands Ranch | 2,985 | 30,305 | 26,329 | 673 | 0.52 |
| Littleton | 2,207 | 17,503 | 14,587 | 377 | 0.31 |
| Greenwood Village | 1,875 | 15,304 | 13,057 | 227 | 0.27 |
| Ken Caryl | 1,446 | 14,620 | 12,726 | 288 | 0.25 |
| Columbine | 1,132 | 7,682 | 6,236 | 213 | 0.14 |
| Englewood | 912 | 7,073 | 5,749 | 205 | 0.13 |
| Cherry Hills Village | 407 | 5,122 | 4,625 | 107 | 0.09 |
| Sheridan | 296 | 2,240 | 1,902 | 43 | 0.04 |
| Morrison | 161 | 1,696 | 1,511 | 32 | 0.03 |
| Bow Mar | 38 | 640 | 589 | 14 | 0.01 |
| **Total** | **51,086** | **440,416** | **369,823** | **9,224** | **7.71** |

**Zero ways dropped** in normalization. **Zero duplicate way ids** across regions.

Adding bike-legal `path`/`bridleway` (v1 -> v2) contributed **+2,685 ways and +418 km**.

## Coverage gaps and how they were found

The first ten-region build left visible holes. Three classes of cause, all found by
diffing OSM way ids in a bbox against the ids in our own `wayIds.bin`:

**1. Missing municipalities.** Cherry Hills Village, Morrison and Bow Mar are ordinary
`admin_level=8` places that were simply never added to the registry. 575 ways.

**2. Unincorporated land.** The strip between Littleton and Morrison -- Ken Caryl Ranch
north, Willowbrook, Willow Springs -- sits in no municipality at all. An `is_in` probe
returns only Jefferson County (`admin_level=6`), so no boundary query can reach it. It
carries S Kipling Pkwy, W Bowles Ave, the C-470 Trail and the Kipling Trail; **22% of the
missing ways there were `cycleway`**. Fixed with a polygon region (3,200 net new ways).

This is the cost of choosing incorporated places over whole counties. That choice was
still right -- whole Jefferson County reaches the Continental Divide and would put 100%
out of reach -- but it needs polygon patches wherever people actually ride.

**3. Double-counted border ways.** Overpass `way(area.r)` returns any way with a node
inside the area, so a way straddling a shared municipal border was claimed by both
neighbours. **395 ways across 19 region pairs** (Denver+Lakewood 98, Denver+Englewood 66,
...), inflating the denominator by 127 km before anyone noticed. `build-snapshot` now
assigns each way to exactly one region in `REGIONS` order.

That ordering is what lets polygon regions be drawn loosely: the SW Metro ring overlaps
its neighbours freely, fetches 14,276 ways, and keeps only the 3,200 nobody else claimed.
No precise border-tracing required.

## M1 — client render

Chrome on macOS (Darwin 25.5.0), all fourteen regions loaded, full metro core in view.

| Metric | Value |
|---|---|
| Snapshot fetch + decode, 14 regions | **1,105 ms** |
| Steady-state FPS | **58** |
| FPS while panning | **60** |
| Paths rendered | 51,086 |
| Vertices uploaded | 440,416 |

60 fps while panning 51k paths, with no geometry simplification and no Web Worker. Both
were deferred to M7 pending measurement — this is the measurement, and neither is needed
yet. That is the useful M7 result: the binary-attribute path was sufficient on its own.

**Measuring FPS correctly.** The in-app counter is `requestAnimationFrame`-based, so it
only reports meaningfully in a foregrounded tab. Chrome throttles rAF to ~0–1 fps in
hidden tabs, and an automated screenshot session leaves the tab hidden. Early readings of
0–1 fps were measurement artifacts, not render performance.

## Overpass fetch behavior

Fetching the ten regions took roughly 50 minutes wall clock, and the per-region times
have **no correlation with region size**:

| Region | Ways | Time |
|---|---:|---:|
| Denver | 22,979 | 15.3s |
| Littleton | 2,052 | 4.4s |
| Greenwood Village | 1,821 | 5.5s |
| Columbine (retry) | 1,052 | 3.5s |
| Englewood | 984 | 235.6s |
| Ken Caryl | 1,363 | 238.0s |
| Highlands Ranch | 2,837 | 246.4s |
| Lakewood | 6,728 | 268.1s |
| Centennial | 4,882 | 894.4s |
| Columbine (first) | — | failed, 9 attempts |

The largest region was the second fastest. Direct probing showed why: two of the three
public mirrors were accepting TCP connections and never responding, while
`overpass-api.de` returned fast 504s. A trivial one-bbox node count took 60s+ against the
hung mirrors.

The client originally had no per-request timeout, so `fetch()` blocked until the OS
abandoned the socket — minutes of dead waiting per attempt before the retry loop could
rotate away. Fixed with a 90s `AbortController` cap plus per-attempt logging. Columbine
re-fetched in 3.5s on the first attempt afterward.

**Takeaway for later milestones:** budget fetch time by mirror health, not by region
size, and never re-fetch without the resumable skip logic.

## Overpass reliability, measured

The v2 re-fetch of 14 regions, with per-attempt logging:

| | |
|---|---:|
| Time in successful fetches | 1,007 s |
| **Time burned on failed attempts** | **1,073 s** |
| Failed attempts | 19 |

Causes: 11 mirrors that accepted the connection and never responded (each capped at the
90 s client timeout), 5 HTTP 504, and **3 HTTP 429** — the last self-inflicted by firing
14 regions back to back at a service allowing 2 slots per IP. Hence the 4 s inter-region
pacing and 30 s post-throttle cooldown.

Region size does not predict fetch time. Denver (23,603 ways) took 229 s; Bow Mar
(38 ways) exhausted 9 attempts twice and needed 215 s on a third run. Budget by mirror
health, not by data volume.

## M2 — ride import

Strava bulk export, 2026-07-28. 225 activity files, **100% `.fit.gz`** — zero GPX.

| | Count |
|---|---:|
| Files in archive | 225 |
| **Imported** | **165** |
| Rejected — virtual | 35 |
| Rejected — out-of-region | 25 |
| Rejected — no GPS / too short | 0 |

165 + 35 + 25 = 225, and the 35 virtual matches `activities.csv`'s "Virtual Ride" count
exactly — an independent check that the filter is neither over- nor under-matching.

| Metric | Value |
|---|---|
| Ridden distance (after clipping) | 3,955 km |
| Points after resampling at 10 m | 151,382 |
| Snapshot size | 2.42 MB |
| Clip distance | 500 m from each end |

### Render cost of the ride layer

| Layers | FPS |
|---|---:|
| Network only (51,086 paths) | 60 |
| Network + rides (51,251 paths) | **43** |

Adding 165 ride paths cost ~17 fps — far more than their path count suggests, because the
ride layer is semi-transparent and overlapping traces force per-fragment blending along
heavily-repeated corridors like the Platte River Trail. Worth revisiting in M7 if it drops
further; still comfortably interactive.

Combined decode (network + rides) is 2,783 ms, up from 1,105 ms for the network alone.

### The out-of-region 25

Not errors. These are rides whose bbox falls outside the metro-core regions — travel, tours,
and riding in areas the registry does not yet cover. They score coverage once those regions
are added and fetched.

---

## M3 — coverage

Computed 2026-07-28 at a 25 m match radius against the 165 imported rides.

| Metric | Value |
|---|---:|
| **Headline — ridden street distance** | **3.56%** |
| Covered | 329 km of 9,224 km |
| Nodes hit | 16,241 of 369,823 (4.39%) |
| Streets complete | 2,005 of 51,086 |
| Runs after splitting | 52,235 |
| Snapshot size | 7.33 MB |
| Build time | 0.7 s |

### Making 56 billion comparisons cheap

369,823 network nodes against 484,778 ride points is 1.8×10¹¹ naive distance tests. A
uniform grid sized at the match radius, built over the ride points and queried per node,
reduces each query to the 9 cells that could possibly contain a match.

| | Value |
|---|---:|
| Naive comparisons | 1.8 × 10¹¹ |
| Grid cells occupied | 17,345 |
| Whole-metro build | **0.7 s** |

A test asserts the grid returns exactly what brute force returns over 3,000 random queries,
so the optimization is verified rather than assumed.

### Two bugs the tests caught

**Undersized grid cells.** Cell width came from the ellipsoidal 111,320 m per degree of
longitude while `haversineMeters` measures on a sphere of radius 6,371,008.8 m — 111,194.9 m
per degree. Cells came out 24.97 m for a 25 m radius. Undersized cells silently lose matches
rather than failing loudly. Both axes now derive from the same sphere, plus a 1% margin.

**Sparse traces under-reported coverage.** Coverage asks whether a ride *point* came within
25 m of a node, but the rider traveled the *line between* points. The archive's traces have
a median gap of 23.5 m, p90 of 38.6 m, and 9,634 gaps over 50 m — worst 262 m. A node mid-gap
was missed despite being ridden straight over.

| | Before densify | After |
|---|---:|---:|
| Ride points indexed | 151,382 | 484,778 |
| Headline | 3.45% | **3.56%** |
| Covered | 318 km | 329 km |
| Nodes hit | 15,939 | 16,241 |
| Streets complete | 1,879 | 2,005 |

Densifying to ≤10 m spacing makes the point test approximate a line test to within 5 m.

### Render cost

| Layers | FPS |
|---|---:|
| Network only (51,086 paths) | 60 |
| Network + rides | 43 |
| **Coverage (52,235 runs)** | **48** |

Splitting ways into runs adds ~1,150 paths over the plain network and costs ~12 fps against
the network-only baseline, largely from the per-run color and width accessors. Initial
decode is 1,709 ms.

### Zero-coverage regions are real, not a matching failure

Three regions report 0.00% in this sample. Probing the nearest ride point to each confirms
the zeros are genuine — no ride came near — rather than a matching failure:

| Region | Nearest ride point |
|---|---:|
| Morrison | ~64 m |
| Cherry Hills Village | ~396 m |
| Bow Mar | ~1,383 m |

Centennial's 0.01% is consistent too — its nearest ride point is 3 m, so the rider clips one
edge and no more.

### Known limits

- **Streets near home can never reach 100%.** M2 clips 500 m from both ends of every ride, so
  those nodes have no points near them by construction. Accepted cost of not storing where
  the rider lives.
- **A 25 m radius will credit some streets ridden past.** Denver block spacing reaches ~30 m,
  so a parallel street occasionally lights up. Inherent to node coverage at this radius;
  segment-level map matching is the upgrade path.
- **Dual carriageways read as half-ridden forever.** A divided road is two OSM ways and
  riding one direction leaves the other unhit. Not solved in M3.

### East-metro gap, found by eye and confirmed by measurement

Coverage showed the Cherry Creek Trail fragmenting and the reservoir loop missing entirely,
while the ride overlay drew both continuously. Traces do not depend on the network, so the
difference isolated the cause: **17,976 of 151,382 ride points sat more than 60 m from any
network node.** In the reservoir area specifically, 46% of sampled ride points had no network
node within 25 m — p75 321 m, p90 871 m, max 2,295 m. Nothing existed to credit.

Four regions closed it: Glendale (relation 112942), Holly Hills (relation 9569979), Cherry
Creek State Park (**way** 224202720, a protected area rather than a municipality) and a tight
polygon for the unincorporated Arapahoe corridor between them.

| | Before | After |
|---|---:|---:|
| Regions | 14 | 18 |
| Denominator | 9,224 km | 9,420 km |
| Covered | 329 km | 348 km |
| **Headline** | 3.56% | **3.70%** |

The headline *rose* despite a larger denominator: the added regions were disproportionately
ridden. Cherry Creek State Park alone reads 21.26%.

Aurora was deliberately excluded. It would add a few thousand km of mostly-unridden
residential streets and depress the number without reflecting where these rides go.

**Still unexplained, and out of scope:** ~1,180 orphan points near 39.71, -104.97 lie inside
Denver, which *is* fetched. That stretch of the Cherry Creek Trail is tagged `footway`, which
the rideable filter excludes on purpose — including footways would more than double the
denominator with sidewalks.

## All rides, everywhere

The importer previously rejected out-of-region rides. It now keeps them: a ride in another
state is still a ride, and it costs only the bytes of its geometry. Coverage is unaffected — a
rebuild produced a byte-identical 3.70%, confirming that out-of-region traces credit nothing.

| | Metro only | All rides |
|---|---:|---:|
| Rides | 165 | **190** |
| Distance | 3,955 km | **5,433 km** |
| Points | 151,382 | 209,328 |
| Snapshot | 2.42 MB | 3.35 MB |
| Bbox | Denver metro | −106.45 to −88.91 lon |

190 + 35 virtual = 225, so the archive still reconciles exactly. Zwift stays rejected.

### Rendering the whole country

| View | FPS |
|---|---:|
| Metro, coverage + rides | 50 |
| Continental, network on screen | **6** |
| Continental, network off screen | 60 |

The network layer has no level-of-detail or culling, so all 52,491 runs rasterize even when
the metro occupies 40 px. This is the clearest thing for M7 to fix.

## Aurora, and what a denominator change costs

Aurora (relation 112875) joins the metro-core group. It is listed after Cherry Creek State
Park so the park keeps its own ways rather than being absorbed by the city surrounding it.

| | Before | After |
|---|---:|---:|
| Regions | 18 | 19 |
| Ways | 52,491 | 67,437 |
| Denominator | 9,420 km | **12,214 km** |
| Covered | 348 km | 348 km |
| **Headline** | 3.70% | **2.85%** |

Covered distance did not move by a single metre — only the denominator grew. In this sample dataset **Aurora reads 0.00% — 2 nodes hit of 133,494**, because the sample
contains essentially no riding there. That is the honest answer to "is the east side
covered", and it is worth more than a flattering percentage.

Dedup did its job on the overlap: `cherry-creek-corridor` fell from 938 ways / 108 km to
497 / 50 km as Aurora claimed the shared ways first, and the corridor's own percentage rose
from 5.87% to 12.43% because the unridden bulk moved to Aurora's row.

### The fetch failed before it succeeded

Aurora failed all 9 attempts, every one timing out at the 90 s per-attempt cap. The retry
then succeeded **in 16.7 s**. The cap was never the binding constraint — Overpass was simply
overloaded, and had been returning `runtime error: ... too busy` to plain ID lookups minutes
earlier. The per-attempt cap was raised to 180 s with a `--timeout` override anyway, since
90 s cannot distinguish a large query from a hung mirror, but the honest cause was server
load and the honest fix was retrying.

### The reservoir gap, part two

Widening the corridor ring closed part of it. The first ring stopped at −104.855 to avoid
pulling in Aurora; that tightness left the north-shore trail — tagged `cycleway`,
`bicycle=designated` — in a strip belonging to no region. The nearest snapshot node to it was
**186 m** away. Aurora is now a boundary region listed above the polygon, so it claims its own
ways first and the ring can be widened safely.

| | Before | After |
|---|---:|---:|
| Corridor ways | 497 | 885 |
| Corridor km | 50 | 113 |
| Unmatched in the reservoir box | 12.8% | **7.0%** |
| Covered | 348 km | 351 km |

**What remains there is not a missing region.** The leftover orphans sit 27–39 m from the
Cherry Creek Trail, which *is* in the snapshot — just outside the 25 m radius. The nearer
features are a `track` with `bicycle=no` (correctly excluded) and a `footway` with
`bicycle=designated` (excluded by the blanket footway rule).

### Where every unmatched ride point actually is

Across the whole metro, of 505,100 ride points:

| Nearest rideable way | Points | Share of unmatched |
|---|---:|---:|
| within 25 m (matched) | 406,658 | — |
| 25–40 m | 31,660 | 32.2% |
| 40–75 m | 25,023 | 25.4% |
| 75–150 m | 8,883 | 9.0% |
| 150 m+ | 32,876 | 33.4% |

19.5% of points are unmatched at 25 m. **A third of those have a rideable street 25–40 m
away** — the radius is the binding constraint, not the map. The 150 m+ third is mostly
out-of-region riding, which has no network by definition.

## Footways tagged bicycle=designated — a change that did almost nothing

`footway` now counts when tagged `bicycle=designated` (not `yes`, which on a footway means
bikes are merely permitted). The reasoning was sound: OSM uses `designated` for real bike
routes, and the nearest feature to the reservoir orphans was exactly such a footway at 27 m.

The measurement does not support the hope.

| | Before | After |
|---|---:|---:|
| Ways | 67,825 | 68,574 |
| Denominator | 12,277 km | 12,346 km |
| Covered | 351 km | 353 km |
| Metro points unmatched at 25 m | 98,442 | 98,419 |
| Reservoir box unmatched | 7.0% | 7.0% |
| **Headline** | 2.86% | **2.86%** |

749 ways and 69 km added; **23 ride points changed status.** Denominator and numerator grew
by the same fraction, so the headline did not move at all. Designated footways are simply
rare in this metro.

The change is kept — it is correct, and it costs nothing — but it was not the binding
constraint, and predicting that it would be was wrong.

### The radius is the actual lever

Same network, same rides, radius varied:

| Radius | Covered | Headline | Nodes hit |
|---:|---:|---:|---:|
| 25 m | 353 km | 2.86% | 3.48% |
| 30 m | 367 km | 2.97% | 3.65% |
| 35 m | 382 km | 3.09% | 3.82% |
| 40 m | 396 km | 3.21% | 3.99% |

35 m recovers 29 km that 25 m misses — an order of magnitude more than the footway change.

**The cost is unmeasured and real.** Denver's grid has ~30 m block spacing, so a wider radius
credits streets merely ridden past, and nothing here distinguishes a genuine match from a
false one. The numbers above say what a wider radius *gains*; they say nothing about what it
wrongly claims. Establishing that needs ground truth this project does not have.

## Zoom-out performance: two failed attempts

Neither approach landed. Recording both so the next attempt does not repeat them.

**Attempt 1 — viewport in React state.** Culling needs zoom and bounds, so `MapView` held
them in state and updated on `moveend`. That re-renders react-map-gl's `<Map>`, whose
`setProps` calls `_updateSize` and threw `Cannot read properties of undefined (reading
'width')` on every move. The map froze; frame rate fell from 6 to 2. Reverting `MapView`
alone removed the exception, which is what pinned the cause. maplibre was correctly pinned at
5.24.0, so this was *not* the documented v6 trap.

**Attempt 2 — a deck.gl CompositeLayer.** Avoids React entirely: `renderLayers` reads
`this.context.viewport`. Two problems in sequence.

Without a `shouldUpdateState` override the composite never re-renders on camera change, so
the zoom gate was evaluated once at construction and never again — it compiled, rendered, and
silently did nothing. Adding the override back made it re-run, and the frame rate at the
*default* zoom collapsed to 1 fps: worse than the 48–60 fps baseline it was meant to improve.

Reverted. The map is back to its known-good state.

### What the failures actually establish

Rebuilding the layer list on camera change is the thing that cannot be afforded here. Each
`createCoverageLayer` call constructs a fresh `data` object around the binary attributes, and
deck.gl cannot diff binary payloads by value — so a rebuild re-uploads all 613,505 vertices.
Any culling scheme that recreates layers per move pays that cost on every frame.

**A viable attempt would memoize the `data` object per region first**, so a rebuilt layer
carries the same buffer reference and deck.gl's diff is a no-op. Only then does per-viewport
culling become affordable. That is the prerequisite both attempts skipped.

The measurement that motivated all this is unchanged: 6 fps at continental zoom, 60 fps with
the network off screen, 69,791 paths and 613,505 vertices rasterizing into a few hundred
pixels.

## Zoom-out performance: fixed, on the third attempt

The prerequisite the first two attempts skipped: **memoize the binary `data` object and the
accessors per region.** deck.gl diffs layer props by reference, and a `data` payload is a
plain object wrapping typed arrays, so constructing a fresh one per render reads as new data
and re-uploads all 613,505 vertices. Culling rebuilds layers as the camera moves, so every
frame paid for the whole network — which is why both earlier attempts were slower than the
problem.

With `data` and accessors held in a `WeakMap` keyed on the loaded region, a rebuilt layer
hands deck.gl the references it already uploaded and the diff is a no-op. Nine tests pin the
reference identity specifically; a value-equality test would pass while the bug returned.

Then culling works. `RegionStackLayer` is a `CompositeLayer` that reads `this.context.viewport`
— deck.gl already knows the camera, so nothing goes through React state, which is what
crashed react-map-gl's `setProps` on attempt one. It needs a `shouldUpdateState` override:
without one a composite never re-runs `renderLayers` on camera change, and the gate is
evaluated once at construction and never again. Attempt two shipped exactly that and silently
did nothing.

| View | Before | After |
|---|---:|---:|
| Default city zoom | 48–60 | 29–30 |
| **Continental zoom** | **6** | **29** |
| Network off screen | 60 | 60 |

Continental zoom is ~5× faster and the map stays responsive. Zooming back in restores the
network, verified in both directions.

Sublayers are additionally cached on the *set* of visible region ids, so panning within the
same regions rebuilds nothing at all.

### Bundle chunks

The 500 kB warning fired on two chunks. Splitting by change frequency rather than size:

| Chunk | Before | After |
|---|---:|---:|
| `index` (app code) | 825 kB | **37.6 kB** |
| `react` | — | 189.6 kB |
| `deck` | — | 597.2 kB |
| `maplibre-gl` | 1,027.7 kB | 1,027.7 kB |

This does not speed up a cold load — every chunk is needed to render. It means editing a
component invalidates 37 kB of a returning visitor's cache instead of 825 kB. maplibre-gl
cannot be split; the warning limit is raised to 1,100 kB so it can only fire on something
actionable.

**The real first-load cost is not JavaScript.** It is ~21 MB of binary snapshots and roughly
600–1,700 ms of decode. That is the next thing worth attacking.
