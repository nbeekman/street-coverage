# Measurements

The evidence behind [learnings.md](learnings.md). Numbers only, with enough context to know
what each one is measuring.

**Network figures** — ways, vertices, kilometres per region — are properties of
OpenStreetMap and reproducible by anyone who runs the fetch, though OSM moves under you, so
a fresh fetch will not reproduce them exactly. **Ride and coverage figures come from one
sample Strava export** used during development. They are kept because the engineering
findings — grid sizing, trace density, radius sensitivity — are meaningless without the data
that produced them. They are illustrative, not a target: your own export will produce
entirely different coverage.

Where a table compares "before" and "after", both sides were measured on the same snapshot
unless stated otherwise.

---

## The network snapshot

Snapshot version 4, built 2026-07-29. 19 regions, all in the `metro-core` group. Sizes are
the Float32 wire format actually shipped to the browser.

| Region | Ways | Vertices | km | MB |
|---|---:|---:|---:|---:|
| Denver | 24,011 | 182,729 | 4,193 | 1.51 |
| Aurora | 15,560 | 155,670 | 2,869 | 1.26 |
| Lakewood | 7,550 | 64,737 | 1,286 | 0.53 |
| Centennial | 5,004 | 57,237 | 885 | 0.46 |
| SW Metro (unincorporated) | 3,535 | 36,374 | 718 | 0.29 |
| Highlands Ranch | 2,988 | 30,347 | 674 | 0.25 |
| Littleton | 2,230 | 17,660 | 379 | 0.15 |
| Greenwood Village | 1,880 | 15,435 | 229 | 0.13 |
| Ken Caryl | 1,446 | 14,620 | 288 | 0.12 |
| Columbine | 1,173 | 8,001 | 220 | 0.07 |
| Englewood | 922 | 7,121 | 206 | 0.06 |
| Cherry Creek corridor | 900 | 7,487 | 114 | 0.06 |
| Cherry Hills Village | 407 | 5,122 | 107 | 0.04 |
| Sheridan | 296 | 2,236 | 43 | 0.02 |
| Cherry Creek State Park | 265 | 4,903 | 61 | 0.04 |
| Morrison | 161 | 1,696 | 32 | 0.01 |
| Glendale | 158 | 951 | 14 | 0.01 |
| Holly Hills | 50 | 539 | 14 | 0.01 |
| Bow Mar | 38 | 640 | 14 | 0.00 |
| **Total** | **68,574** | **613,505** | **12,346** | **5.01** |

Zero ways dropped in normalization. Zero duplicate way ids across regions.

---

## How the denominator got to 12,346 km

Every step here changed what the headline percentage *means*, which is why each one is
recorded. Ride coverage was held constant across each comparison.

### Filling holes in the map

The first ten-region build left visible gaps. Three classes of cause, all found by diffing
OSM way ids in a bbox against the ids in our own `wayIds.bin`.

**1. Missing municipalities.** Cherry Hills Village, Morrison and Bow Mar are ordinary
`admin_level=8` places that were simply never added to the registry. **575 ways.**

**2. Unincorporated land.** The strip between Littleton and Morrison — Ken Caryl Ranch
north, Willowbrook, Willow Springs — sits in no municipality at all. An `is_in` probe returns
only Jefferson County (`admin_level=6`), so no boundary query can reach it. It carries S
Kipling Pkwy, W Bowles Ave, the C-470 Trail and the Kipling Trail; **22% of the missing ways
there were `cycleway`**. Fixed with a polygon region: **3,200 net new ways.**

**3. Double-counted border ways.** Overpass `way(area.r)` returns any way with a node inside
the area, so a way straddling a shared municipal border was claimed by both neighbours.
**395 ways across 19 region pairs** (Denver+Lakewood 98, Denver+Englewood 66, …), inflating
the denominator by **127 km** before anyone noticed.

### The east-metro gap

Coverage showed the Cherry Creek Trail fragmenting and the reservoir loop missing entirely,
while the ride overlay drew both continuously. **17,976 of 151,382 ride points sat more than
60 m from any network node.** In the reservoir area specifically, 46% of sampled ride points
had no network node within 25 m — p75 321 m, p90 871 m, max 2,295 m.

Four regions closed it: Glendale (relation 112942), Holly Hills (relation 9569979), Cherry
Creek State Park (**way** 224202720 — a protected area, not a municipality) and a polygon for
the unincorporated Arapahoe corridor between them.

| | Before | After |
|---|---:|---:|
| Regions | 14 | 18 |
| Denominator | 9,224 km | 9,420 km |
| Covered | 329 km | 348 km |
| **Headline** | 3.56% | **3.70%** |

The headline *rose* despite a larger denominator — the added regions were disproportionately
ridden. Cherry Creek State Park alone read 21.26%.

### Aurora

| | Before | After |
|---|---:|---:|
| Regions | 18 | 19 |
| Ways | 52,491 | 67,437 |
| Denominator | 9,420 km | **12,214 km** |
| Covered | 348 km | 348 km |
| **Headline** | 3.70% | **2.85%** |

Covered distance did not move by a single metre. In this sample dataset Aurora reads
**0.00% — 2 nodes hit of 133,494**, because the sample contains essentially no riding there.

Dedup did its job on the overlap: `cherry-creek-corridor` fell from 938 ways / 108 km to
497 / 50 km as Aurora claimed the shared ways first, and the corridor's own percentage *rose*
from 5.87% to 12.43% because the unridden bulk moved to Aurora's row.

Widening the corridor ring afterwards was then safe, and closed the rest of the reservoir
gap. The first ring had stopped at −104.855 to avoid pulling in Aurora, leaving the
north-shore trail — tagged `cycleway`, `bicycle=designated` — in a strip belonging to no
region, 186 m from the nearest snapshot node.

| | Before | After |
|---|---:|---:|
| Corridor ways | 497 | 885 |
| Corridor km | 50 | 113 |
| Unmatched in the reservoir box | 12.8% | **7.0%** |
| Covered | 348 km | 351 km |

### Ruleset changes

Adding bike-legal `path`/`bridleway` (network v1 → v2): **+2,685 ways, +418 km.**

Adding `footway` where `bicycle=designated` (v2 → v3):

| | Before | After |
|---|---:|---:|
| Ways | 67,825 | 68,574 |
| Denominator | 12,277 km | 12,346 km |
| Covered | 351 km | 353 km |
| Metro points unmatched at 25 m | 98,442 | 98,419 |
| Reservoir box unmatched | 7.0% | 7.0% |
| **Headline** | 2.86% | **2.86%** |

749 ways and 69 km added; **23 ride points changed status.** Numerator and denominator grew
by the same fraction, so the headline did not move at all.

---

## Where every unmatched ride point actually is

Across the whole metro, of 505,100 ride points:

| Nearest rideable way | Points | Share of unmatched |
|---|---:|---:|
| within 25 m (matched) | 406,658 | — |
| 25–40 m | 31,660 | 32.2% |
| 40–75 m | 25,023 | 25.4% |
| 75–150 m | 8,883 | 9.0% |
| 150 m+ | 32,876 | 33.4% |

19.5% of points are unmatched at 25 m, and **a third of those have a rideable street 25–40 m
away** — the radius is the binding constraint, not the map. The 150 m+ third is mostly
out-of-region riding, which has no network by definition.

### The radius sweep

Same network, same rides, radius varied:

| Radius | Covered | Headline | Nodes hit |
|---:|---:|---:|---:|
| 25 m | 353 km | 2.86% | 3.48% |
| 30 m | 367 km | 2.97% | 3.65% |
| 35 m | 382 km | 3.09% | 3.82% |
| 40 m | 396 km | 3.21% | 3.99% |

35 m recovers 29 km that 25 m misses. **The cost is unmeasured and real** — Denver's grid has
~30 m block spacing, so a wider radius also credits streets merely ridden past, and nothing
here distinguishes a genuine match from a false one. It stays at 25 m.

### Zero-coverage regions are genuine

Probing the nearest ride point to each region that read 0.00% confirms the zeros are real
riding gaps, not matching failures:

| Region | Nearest ride point |
|---|---:|
| Morrison | ~64 m |
| Cherry Hills Village | ~396 m |
| Bow Mar | ~1,383 m |

Centennial's 0.01% is consistent too — its nearest ride point is 3 m, so the rider clips one
edge and no more.

**One thing left unexplained:** ~1,180 orphan points near 39.71, −104.97 lie inside Denver,
which *is* fetched. That stretch of the Cherry Creek Trail is tagged `footway`, excluded on
purpose.

---

## Overpass, measured

### Fetch time does not correlate with region size

Fetching the first ten regions took roughly 50 minutes wall clock:

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

The largest region was the second fastest. Direct probing showed why: two of the three public
mirrors were accepting TCP connections and never responding, while `overpass-api.de` returned
fast 504s. A trivial one-bbox node count took 60s+ against the hung mirrors.

The client originally had no per-request timeout, so `fetch()` blocked until the OS abandoned
the socket. A 90 s `AbortController` cap plus per-attempt logging fixed it; Columbine
re-fetched in 3.5 s on the first attempt afterwards.

### Half the time is spent failing

The v2 re-fetch of 14 regions, with per-attempt logging:

| | |
|---|---:|
| Time in successful fetches | 1,007 s |
| **Time burned on failed attempts** | **1,073 s** |
| Failed attempts | 19 |

Causes: 11 mirrors that accepted the connection and never responded (each capped at the 90 s
client timeout), 5 HTTP 504, and **3 HTTP 429** — the last self-inflicted by firing 14 regions
back to back at a service allowing 2 slots per IP. Hence the 4 s inter-region pacing and 30 s
post-throttle cooldown.

Denver (23,603 ways) took 229 s; Bow Mar (38 ways) exhausted 9 attempts twice and needed
215 s on a third run. Aurora failed all 9 attempts at the 90 s cap, then succeeded in
**16.7 s** on retry — the cap was never the binding constraint, the server was simply
overloaded. **Budget by mirror health, not by data volume.**

---

## Ride import

Strava bulk export, 2026-07-28. 225 activity files, **100% `.fit.gz`** — zero GPX.

| | Count |
|---|---:|
| Files in archive | 225 |
| **Imported** | **190** |
| Rejected — virtual (Zwift) | 35 |
| Rejected — no GPS / too short | 0 |

190 + 35 = 225, and the 35 virtual matches `activities.csv`'s "Virtual Ride" count exactly —
an independent check that the filter is neither over- nor under-matching.

Out-of-region rides were originally rejected (25 of them) and are now kept: a ride in another
state is still a ride, and it costs only the bytes of its geometry. A rebuild after the change
produced a byte-identical 3.70%, confirming out-of-region traces credit nothing.

| | Metro only | All rides |
|---|---:|---:|
| Rides | 165 | **190** |
| Distance | 3,955 km | **5,433 km** |
| Points | 151,382 | 209,328 |
| Snapshot | 2.42 MB | 3.35 MB |
| Bbox | Denver metro | −106.45 to −88.91 lon |

Clip distance is 500 m from each end of every ride.

---

## Coverage matching

### Making 56 billion comparisons cheap

369,823 network nodes against 484,778 ride points is 1.8×10¹¹ naive distance tests. A uniform
grid sized at the match radius, built over the ride points and queried per node, reduces each
query to the 9 cells that could possibly contain a match.

| | Value |
|---|---:|
| Naive comparisons | 1.8 × 10¹¹ |
| Grid cells occupied | 17,345 |
| Whole-metro build | **0.7 s** |

A test asserts the grid returns exactly what brute force returns over 3,000 random queries, so
the optimization is verified rather than assumed.

### Densifying traces before matching

The archive's traces have a median gap of **23.5 m**, p90 **38.6 m**, and 9,634 gaps over
50 m — worst **262 m**. Densifying to ≤10 m spacing makes the point test approximate a line
test to within 5 m.

| | Before densify | After |
|---|---:|---:|
| Ride points indexed | 151,382 | 484,778 |
| Headline | 3.45% | **3.56%** |
| Covered | 318 km | 329 km |
| Nodes hit | 15,939 | 16,241 |
| Streets complete | 1,879 | 2,005 |

---

## Render performance

Chrome on macOS (Darwin 25.5.0). FPS must be read in a **foregrounded** tab — the counter is
`requestAnimationFrame`-based, and Chrome throttles rAF to ~0–1 fps in hidden tabs, which is
what an automated screenshot session leaves you with.

### Layer cost, at the 51k-way snapshot

| Layers | FPS |
|---|---:|
| Network only (51,086 paths) | 60 |
| Network + rides (51,251 paths) | 43 |
| Coverage (52,235 runs) | 48 |

165 ride paths cost ~17 fps — far more than their path count suggests, because the ride layer
is semi-transparent and overlapping traces force per-fragment blending along heavily-repeated
corridors like the Platte River Trail. Splitting ways into runs adds ~1,150 paths and costs
~12 fps, largely from the per-run colour and width accessors.

### Zoom-out culling

The problem: all 69,791 paths and 613,505 vertices rasterizing into a few hundred pixels.
Baseline before any attempt: **6 fps** continental, 48–60 default, 60 off screen.

| View | Attempt 1 | Attempt 2 | Fixed |
|---|---:|---:|---:|
| Default city zoom | froze | **1** | 29–30 |
| **Continental zoom** | **2** | — | **29** |
| Network off screen | 60 | 60 | 60 |

**Attempt 1** held viewport in React state, which re-rendered react-map-gl's `<Map>`; its
`setProps` threw `Cannot read properties of undefined (reading 'width')` in `_updateSize` on
every move. maplibre was correctly pinned at 5.24.0, so this was *not* the documented v6 trap.
**Attempt 2** used a deck.gl `CompositeLayer` without memoizing the binary `data` object, so
every camera move re-uploaded all 613,505 vertices. **The fix** memoizes `data` and accessors
in a `WeakMap` keyed on the loaded region, then culls; sublayers are additionally cached on the
*set* of visible region ids, so panning within the same regions rebuilds nothing at all.

Continental zoom is ~5× faster and the map stays responsive. Verified in both directions.

---

## Bytes over the wire

### Bundle chunks

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

### First load: 24.3 MB → 4.36 MB

| Stage | Default view | Decode |
|---|---:|---:|
| Before | 24.3 MB | 1,680 ms |
| Float32 wire format | 12.2 MB | |
| Load only the active view | 5.8 MB | |
| Compression | **4.36 MB** | **246 ms** |

Measured live after all three:

| | |
|---|---:|
| Over the wire | **4.36 MB** |
| After decompression | 5.85 MB |
| Saved by compression | **1.50 MB** |
| Load event | 853 ms |

**Measure this in production, not `npm run dev`** — React StrictMode double-invokes effects,
so the dev server fetches every region twice. Any dev-measured byte or decode figure needs
halving.

### Why compression won less than expected

An earlier estimate of ~4 MB came from gzipping the **Float64** positions, which compressed
~4× because every coordinate sat near −105, 39.7 and shared long identical byte prefixes.
Those are no longer shipped.

| File | Raw | gzip saving |
|---|---:|---:|
| `offsets.bin` | 1.47 MB | 82% |
| `flags.bin` | 24.9 KB | 6% |
| `years.bin` | 99.5 KB | 3% |

`offsets.bin` is ~90% of the bytes and compresses least, because Float32 offsets carry far
more entropy than the Float64 coordinates they replaced. The wire-format change had already
taken most of this win.

Verified that letting Netlify negotiate is correct: a request with `Accept-Encoding: identity`
returns 99,532 raw bytes, still divisible by 4 and therefore intact `Uint32` data.

The remaining lever is quantisation — Int16 deltas at ~1 m precision would roughly halve
`offsets.bin` again — a real precision trade-off rather than a free header change.

---

## The timeline

Cumulative: at 2020 the map shows everything ridden up to and including 2020.

| Through | Headline |
|---|---:|
| 2017 | 1.23% |
| 2018 | 1.32% |
| 2019 | 1.34% |
| 2020 | 1.59% |
| 2021 | 2.35% |
| 2022 | 2.71% |
| 2024 | 2.71% |
| 2025 | 2.82% |
| 2026 | **2.85%** |

Verified monotonically increasing across every position, which is the property a cumulative
view has to have.

**The last frame reads 2.85% against an all-time 2.86%.** Measured rather than guessed:
**16 ridden runs, 1.5 km, 0.012 percentage points** carry no year at all, because a run's year
mask is the intersection of its endpoints' years and those two ends were first ridden in
different years. Correct for "during 2022"; wrong cumulatively. See
[learnings.md](learnings.md#11-limits-that-are-not-bugs).
