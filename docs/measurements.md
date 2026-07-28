# Measurements

Baseline numbers for the M7 performance write-up. Update whenever the snapshot is
rebuilt; note the snapshot version and OSM timestamp.

## M1 — snapshot build

Snapshot version 1. Fetched 2026-07-28, OSM base timestamp `2026-07-28T14:51:57Z`.

| Region | Ways | Vertices | Unique nodes | km | MB |
|---|---:|---:|---:|---:|---:|
| Denver | 22,979 | 173,250 | 139,074 | 4,083 | 3.07 |
| Lakewood | 6,728 | 53,343 | 44,379 | 1,170 | 0.94 |
| Centennial | 4,882 | 55,987 | 49,738 | 869 | 0.96 |
| Highlands Ranch | 2,837 | 28,532 | 24,775 | 650 | 0.49 |
| Littleton | 2,052 | 16,321 | 13,608 | 362 | 0.29 |
| Greenwood Village | 1,821 | 14,726 | 12,544 | 230 | 0.26 |
| Ken Caryl | 1,363 | 13,674 | 11,891 | 275 | 0.24 |
| Columbine | 1,052 | 7,198 | 5,858 | 211 | 0.13 |
| Englewood | 984 | 8,015 | 6,498 | 251 | 0.14 |
| Sheridan | 304 | 2,761 | 2,385 | 57 | 0.05 |
| **Total** | **45,002** | **373,807** | **310,750** | **8,158** | **6.57** |

**Zero ways dropped** in normalization across all ten regions.

| Size | Value |
|---|---|
| Raw Overpass JSON (gitignored) | ~37 MB |
| Packed snapshots (committed) | 6.57 MB |
| Gzipped over the wire | ~4.3 MB |

The two-stage pipeline gives a **5.6x** reduction from raw JSON to packed binary. Gzip
adds only 1.53x on top — modest because Float64 coordinates have high-entropy low bits.
Delta-encoding coordinates along each path would compress far better if it ever matters.

**Vertex duplication ratio:** 373,807 ÷ 310,750 = **1.203**

The design spec predicted 1.3–1.5x from shared intersection nodes, and estimated
6.5–7.5 MB. The ratio came in below the predicted range but total size landed inside the
estimate at 6.57 MB. Denver's grid shares fewer nodes between ways than assumed, because
long arterials are split into many short ways that each own their interior vertices.

## M1 — client render

Chrome on macOS (Darwin 25.5.0), all ten regions loaded, full metro core in view.

| Metric | Value |
|---|---|
| Snapshot fetch + decode, 10 regions | **658 ms** |
| Steady-state FPS | **58** |
| FPS while panning | **60** |
| Paths rendered | 45,002 |
| Vertices uploaded | 373,807 |

60 fps while panning 45k paths, with no geometry simplification and no Web Worker. Both
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
