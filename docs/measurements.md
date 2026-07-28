# Measurements

Baseline numbers for the M7 performance write-up. Update whenever the snapshot is
rebuilt; note the snapshot version and OSM timestamp.

## M1 — snapshot build

Snapshot version 1. OSM base timestamp `2026-07-28T14:51:57Z` (Denver).

_Table filled from `npm run build:snapshot` output once all ten regions are fetched._

| Region | Ways | Vertices | Unique nodes | km | MB |
|---|---:|---:|---:|---:|---:|
| Denver | 22,979 | 173,250 | 139,074 | 4,083 | 3.07 |
| Lakewood | | | | | |
| Sheridan | 304 | 2,761 | 2,385 | 57 | 0.05 |

**Vertex duplication ratio (Denver):** 173,250 ÷ 139,074 = **1.246**

The design spec predicted 1.3–1.5x from shared intersection nodes. Actual is slightly
below that range, so the packed snapshot comes in under the 6.5–7.5 MB estimate.
Worth noting the prediction was directionally right but pessimistic: Denver's grid
shares fewer nodes between ways than assumed, because long arterials are split into
many short ways that each own their interior vertices.

## M1 — client render

| Metric | Value |
|---|---|
| Snapshot fetch + decode, 2 regions (ms) | 776 |
| Snapshot fetch + decode, 10 regions (ms) | _pending full fetch_ |
| Steady-state FPS, full metro core | _see note_ |
| FPS while panning | _see note_ |
| Browser / GPU | Chrome, macOS (Darwin 25.5.0) |

**Note on FPS measurement.** The in-app counter is `requestAnimationFrame`-based, so it
only reports meaningfully when the tab is foregrounded — Chrome throttles rAF to ~0–1 fps
in hidden tabs, and an automated screenshot session leaves the tab hidden. Readings of
0–1 fps captured that way are measurement artifacts, not render performance. Record these
numbers from a visible, focused window.

## Verified behaviors

- Binary `PathLayer` renders Denver's 22,979 ways over a MapLibre basemap; DIA's detached
  parcel appears to the northeast as expected for a consolidated city-county.
- Regions paint incrementally as each snapshot decodes, rather than blocking on all ten.
- Manifest `byteLengths` match the files on disk exactly (checked for Denver).
