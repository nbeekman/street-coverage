# Measurements

Baseline numbers for the M7 performance write-up. Update whenever the snapshot is
rebuilt; note the snapshot version and OSM timestamp.

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
