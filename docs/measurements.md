# Measurements

Baseline numbers for the M7 performance write-up. Update whenever the snapshot is
rebuilt; note the snapshot version and OSM timestamp.

## M1 — snapshot build

Snapshot version 1. Fetched 2026-07-28, OSM base timestamp `2026-07-28T14:51:57Z`.

| Region | Ways | Vertices | Unique nodes | km | MB |
|---|---:|---:|---:|---:|---:|
| Denver | 22,979 | 173,250 | 139,074 | 4,083 | 3.07 |
| Lakewood | 6,630 | 52,657 | 43,844 | 1,148 | 0.93 |
| Centennial | 4,882 | 55,987 | 49,738 | 869 | 0.96 |
| SW Metro (unincorporated) | 3,200 | 30,596 | 26,713 | 626 | 0.53 |
| Highlands Ranch | 2,826 | 28,466 | 24,722 | 649 | 0.49 |
| Littleton | 2,014 | 15,880 | 13,225 | 351 | 0.28 |
| Greenwood Village | 1,757 | 13,967 | 11,883 | 212 | 0.25 |
| Ken Caryl | 1,363 | 13,674 | 11,891 | 275 | 0.24 |
| Columbine | 1,022 | 6,923 | 5,630 | 204 | 0.12 |
| Englewood | 879 | 6,720 | 5,436 | 202 | 0.12 |
| Cherry Hills Village | 380 | 4,789 | 4,334 | 101 | 0.08 |
| Sheridan | 274 | 2,126 | 1,809 | 42 | 0.04 |
| Morrison | 157 | 1,416 | 1,235 | 29 | 0.02 |
| Bow Mar | 38 | 640 | 589 | 14 | 0.01 |
| **Total** | **48,401** | **407,091** | **340,123** | **8,806** | **7.14** |

**Zero ways dropped** in normalization. **Zero duplicate way ids** across regions.

| Size | Value |
|---|---|
| Raw Overpass JSON (gitignored) | ~52 MB |
| Packed snapshots (committed) | 7.14 MB |

**Vertex duplication ratio:** 407,091 / 340,123 = **1.197**

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
| Snapshot fetch + decode, 14 regions | **1,075 ms** |
| Steady-state FPS | **58** |
| FPS while panning | **60** |
| Paths rendered | 48,401 |
| Vertices uploaded | 407,091 |

60 fps while panning 48k paths, with no geometry simplification and no Web Worker. Both
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
