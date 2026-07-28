# M2 — Ride import, privacy clipping, trace rendering

**Date:** 2026-07-28
**Milestone:** M2 of `~/Sites/ideas/street-coverage.md`
**Status:** approved, not implemented
**Follows:** [M1 — network render](2026-07-27-m1-network-render-design.md)

---

## Goal

Import ride history from a Strava bulk export, drop the parts that should not be stored or
counted, and draw the remaining traces over the M1 street network.

M2 ends with your rides on the map. It computes **no coverage** — the headline percentage
stays 0.00% until M3.

## Scope

**In:** FIT and GPX parsing, virtual-ride and out-of-region rejection, privacy clipping,
distance-based resampling, versioned binary ride snapshots, a deck.gl trace layer.

**Out:** coverage computation, node matching, the percentage moving, PostGIS, neighbourhood
stats, the timeline scrubber, Strava MCP integration.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Data source | Strava bulk export (ZIP) | Whole history in one download. No OAuth, no rate limits, no API terms constraining storage or display. |
| Storage | **Gitignored** local artifacts | Ride traces are personal location data. Keeping them out of git means the repo stays safe to make public, and un-committing later would mean another history rewrite. |
| FIT library | `@garmin/fitsdk` 21.208.0 | Official, zero dependencies, ESM, tracks the FIT profile authoritatively. Verified working against real files (see Findings). |
| Privacy | Fixed distance from both ends | No home address in the codebase, and it protects every origin — friend's house, trailhead, hotel — not just one. |
| Clip timing | In the **importer**, before any write | Unclipped coordinates never touch the filesystem, not even in the gitignored intermediate. |
| Resampling | By distance, not time | The doc's gotcha: a coffee stop otherwise dumps 300 points into a 5 m radius and skews M3's matching. |

---

## Findings that shaped the design

Verified against `@garmin/fitsdk@21.208.0` and real files on 2026-07-28.

**FIT positions are semicircles, and the SDK does not convert them.** A record reads
`positionLat: -138818392`. That is not corruption — FIT stores positions as semicircles,
and decoding with `applyScaleAndOffset: true` returns the same raw value. The conversion is:

```
degrees = semicircles × 180 / 2^31
```

Miss this and every coordinate is silently wrong rather than obviously broken — the same
failure shape as M1's HTML-under-200 and stale-query bugs.

**Zwift rides are real, present, and must be excluded.** 40 `.fit` files sit in
`~/Documents/Zwift/Activities`. Every one carries `sport: cycling`,
`subSport: virtualActivity`, `manufacturer: zwift`. Their coordinates convert to
**−11.64, 166.95 — Watopia, in the Solomon Sea.** The Denver metro bbox is
lat 39.5..39.9, lon −105.2..−104.6: no overlap, so an unfiltered import would plant a
phantom ride 13,000 km away. Detection is reliable on either `subSport` or `manufacturer`.

**The SDK decodes cleanly.** `Decoder.isFIT()` true, `checkIntegrity()` true, 0 errors on
both a 2024 and a 2025 file (1,592 and 3,001 records). Available message types:
`fileIdMesgs`, `recordMesgs`, `lapMesgs`, `sessionMesgs`, `eventMesgs`, `deviceInfoMesgs`.

**A Strava archive is not all GPX.** Activities are exported in whatever format was
uploaded: `.fit.gz` for device recordings, `.gpx` for manual entries, `.tcx.gz` for some
older imports. The M1 plan assumed GPX; the parser must dispatch on extension and handle
gzip.

---

## Architecture

### Two-stage pipeline, mirroring M1

Neither stage runs in the browser.

```
scripts/import-rides.ts   Strava ZIP or a directory  →  data/rides/<id>.json   (gitignored)
scripts/build-rides.ts    parsed rides               →  public/rides/*.bin     (gitignored)
```

Splitting import from build means a re-clip or a re-resample does not require re-parsing
hundreds of FIT files — the same reason M1 separated fetch from snapshot.

**Both outputs are gitignored.** `public/rides/` is served by Vite in dev but never
committed. A fresh clone renders the network and no rides until the owner re-imports.

### Rejection rules

Applied in the importer, in this order, each with a counted reason so a run reports what it
discarded and why:

1. **No positioned records** → reject. Trainer rides, treadmill runs.
2. **Virtual ride** → reject when `subSport === 'virtualActivity'` **or**
   `manufacturer === 'zwift'`. Either alone is sufficient; both are checked because a
   future virtual platform may set only one.
3. **Outside the metro-core bbox** → reject when the trace bbox does not intersect the
   union bbox of the `metro-core` regions, padded by 5 km. Catches RAGBRAI and travel
   rides. These are not errors — they are rides that belong to regions M1 has not fetched,
   and the importer says so rather than silently dropping them.

A rejected ride is never written to disk.

### Privacy clipping

```ts
clipEnds(points: TrackPoint[], meters: number): TrackPoint[]
```

Walks in from each end accumulating haversine distance, discarding points until `meters` is
exceeded. Default **500 m**, overridable with `--clip-meters`.

Runs **inside the importer, before the first write**. Unclipped coordinates exist only in
memory.

Edge cases, all tested:
- A trace shorter than `2 × meters` clips to empty and is rejected with a counted reason.
- `meters === 0` is honoured (opt-out) rather than treated as "use default".
- Clipping is applied after out-of-region rejection, so bbox checks see the true extent.

**This permanently removes real coverage near home.** Streets within ~500 m of any ride
start may never reach 100%. That is the accepted cost of not storing where you live; it is
recorded in the README so it is not rediscovered as a bug in M3.

### Resampling

```ts
resampleByDistance(points: TrackPoint[], spacingMeters: number): TrackPoint[]
```

Keeps the first and last point, and otherwise emits a point only once `spacingMeters` of
cumulative distance has passed. Default **10 m**.

Distance-based, never time-based. A stopped rider produces hundreds of points in a few
metres; time-based sampling keeps them all and biases M3's nearest-node matching toward
wherever you paused.

### Snapshot format

Per the M1 pattern, and versioned for the same reason:

| File | Type | Contents |
|---|---|---|
| `public/rides/manifest.json` | JSON | version, generatedAt, rideCount, pointCount, bbox, totalMeters, clipMeters, resampleMeters, counts of each rejection reason |
| `public/rides/positions.bin` | Float64Array | `[lon, lat, ...]` |
| `public/rides/startIndices.bin` | Uint32Array | `rideCount + 1` offsets |
| `public/rides/times.bin` | Float64Array | ride start time, epoch ms, one per ride — M6's timeline scrubber needs it and it is free to store now |

`RIDES_SNAPSHOT_VERSION` starts at 1. It bumps when the layout **or the meaning** changes —
including a change to the default clip distance, since that alters what the data represents.

### Module layout

```
src/rides/
  semicircles.ts   FIT semicircle <-> degrees                    [pure, tested]
  types.ts         TrackPoint, RawTrack, Ride
  privacy.ts       clipEnds                                       [pure, tested]
  resample.ts      resampleByDistance                             [pure, tested]
  filter.ts        virtual / out-of-region / empty rejection      [pure, tested]
  snapshot.ts      binary pack, unpack, validate                  [pure, tested]
  loadRides.ts     browser fetch + decode
  useRides.ts      React hook
src/layers/
  rideLayer.ts     deck.gl PathLayer for traces
scripts/
  fit.ts           FIT -> RawTrack (Garmin SDK)                   [script-only]
  gpx.ts           GPX -> RawTrack                                [script-only]
  import-rides.ts  CLI: archive -> data/rides
  build-rides.ts   CLI: data/rides -> public/rides
```

`fit.ts` and `gpx.ts` live under `scripts/` because the browser never parses raw files —
consistent with `overpass.ts` in M1.

### Rendering

A second `PathLayer` above the network layer, same binary-attributes approach and the same
Float64-stored / Float32-offset-rendered coordinate treatment M1 established.

- Traces draw in a warm colour with additive-ish blending, so repeatedly ridden streets
  read brighter. That is a free, honest preview of what M3 will compute properly.
- The layer is toggleable, because a dense trace overlay hides the network beneath it.
- Ride count and total ridden km join the stats panel. The **headline percentage stays
  0.00%** — the numerator is still not computed, and showing anything else would be a lie.

### Error handling

Named, distinct states, following M1:

- No archive found at the given path
- Archive contains zero parseable activities
- A single file fails to parse → counted and skipped, never fatal; one corrupt FIT must not
  abandon a 500-ride import
- Rides snapshot missing in the browser → the map renders the network and says rides are
  not imported, rather than showing an error

---

## Testing

Vitest over the pure modules:

- `semicircles` — round-trip; the known Watopia value converts to −11.6356/166.9526; zero;
  extreme values at ±2³¹
- `privacy` — clips ~500 m from each end; a short trace clips to empty; `0` is honoured;
  point count and geometry outside the clip zone are untouched
- `resample` — collapses a dense cluster; preserves first and last; a straight line at
  spacing yields the expected count; a single-point track survives
- `filter` — rejects `virtualActivity`; rejects `manufacturer: zwift`; rejects an
  out-of-bbox trace; accepts a Denver trace; counts each reason separately
- `snapshot` — pack/unpack round-trip preserves geometry exactly; version mismatch and
  truncated buffers are rejected with distinct codes

`fit.ts` is tested against a **real Zwift file** copied into `test/fixtures/` — it is the
one FIT file available before the archive arrives, and it exercises semicircle conversion
and virtual-ride detection, which are precisely the two things most likely to break.

---

## Done when

- `npm run import:rides -- --archive <path>` parses a Strava export, reporting imported and
  rejected counts by reason
- `npm run build:rides` produces the binary snapshot
- `npm run dev` draws traces over the network, toggleable
- Stats panel shows ride count and ridden km; headline stays 0.00%
- `npm test` passes, `tsc` clean
- No ride data is tracked by git — verified with `git ls-files`

---

## Deferred, with reasons

| Deferred | To | Why |
|---|---|---|
| Coverage computation, headline % | M3 | M2 is import and display only |
| Strava MCP incremental sync | post-M3 | The archive covers backfill; MCP suits new rides, and the value only appears once coverage exists |
| RAGBRAI / Iowa corridor | post-M3 | Needs the route geometry the archive provides, plus a region to hold it |
| Summit County rides | post-M3 | Region is registered but unfetched; those rides are rejected as out-of-region until it is |
| Elevation, speed, HR | — | Not needed for coverage; parsing them is free but storing them is not |
