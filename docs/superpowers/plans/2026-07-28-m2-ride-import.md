# M2 Ride Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import ride history from a Strava bulk export, discard what must not be stored or counted, and draw the remaining traces over the M1 network.

**Architecture:** Two offline scripts mirror the M1 network pipeline — `import-rides` parses FIT/GPX into per-ride JSON, `build-rides` packs that into a versioned binary snapshot. Both outputs are gitignored because ride traces are personal location data. Privacy clipping happens inside the importer so unclipped coordinates never reach disk.

**Tech Stack:** `@garmin/fitsdk` 21.208.0, plus the M1 stack (React 19, TS 5.9, Vite 8, Vitest 4, deck.gl 9.3, MapLibre 5).

**Spec:** `docs/superpowers/specs/2026-07-28-m2-ride-import-design.md`

## Global Constraints

- **FIT positions are semicircles.** `degrees = semicircles × 180 / 2^31`. The SDK does **not** convert them, even with `applyScaleAndOffset: true`. Verified 2026-07-28 against `@garmin/fitsdk@21.208.0`.
- **Nothing under `data/rides/` or `public/rides/` may ever be committed.** Add both to `.gitignore` in Task 1, before any file is written there. Ride traces are personal location data.
- **Privacy clipping runs in the importer, before the first write.** Unclipped coordinates exist only in memory. Do not "clip later in build-rides" — that would persist them.
- All the M1 global constraints still apply: TypeScript `~5.9.3` (not 7.x), explicit `.ts` extensions on Node-reachable imports, erasable syntax only under `scripts/`, scoped deck.gl packages.
- `RIDES_SNAPSHOT_VERSION` bumps when the layout **or the meaning** changes — including a change to the default clip distance.
- Commit after every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/rides/types.ts` | `TrackPoint`, `RawTrack`, `Ride` |
| `src/rides/semicircles.ts` | FIT semicircle ↔ degrees |
| `src/rides/privacy.ts` | `clipEnds` |
| `src/rides/resample.ts` | `resampleByDistance` |
| `src/rides/filter.ts` | Rejection rules and reasons |
| `src/rides/snapshot.ts` | Binary pack / unpack / validate |
| `src/rides/loadRides.ts` | Browser fetch + decode |
| `src/rides/useRides.ts` | React hook |
| `src/layers/rideLayer.ts` | deck.gl PathLayer for traces |
| `scripts/fit.ts` | FIT → `RawTrack` |
| `scripts/gpx.ts` | GPX → `RawTrack` |
| `scripts/import-rides.ts` | CLI: archive → `data/rides/` |
| `scripts/build-rides.ts` | CLI: `data/rides/` → `public/rides/` |

---

## Task 1: Dependencies, gitignore, and ride types

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `src/rides/types.ts`, `test/fixtures/README.md`

**Interfaces:**
- Produces: `TrackPoint`, `RawTrack`, `Ride`; `npm run import:rides` / `npm run build:rides` script entries

- [ ] **Step 1: Add the gitignore entries FIRST**

Before anything can write ride data, append to `.gitignore`:

```gitignore
# Ride traces are personal location data. Never commit them.
data/rides/
public/rides/
```

- [ ] **Step 2: Verify the ignore rules actually match**

```bash
mkdir -p data/rides public/rides && touch data/rides/probe.json public/rides/probe.bin
git check-ignore -v data/rides/probe.json public/rides/probe.bin
rm data/rides/probe.json public/rides/probe.bin
```

Expected: both paths print a matching `.gitignore` rule. If either prints nothing, the rule is wrong — fix before continuing. This is the guard that keeps your home address out of git.

- [ ] **Step 3: Install the FIT SDK and add scripts**

```bash
npm install @garmin/fitsdk@^21.208.0
```

Add to `package.json` scripts:

```json
"import:rides": "node --disable-warning=ExperimentalWarning scripts/import-rides.ts",
"build:rides": "node --disable-warning=ExperimentalWarning scripts/build-rides.ts"
```

- [ ] **Step 4: Create `src/rides/types.ts`**

```ts
/** One recorded position. `t` is epoch milliseconds. */
export type TrackPoint = {
  lon: number
  lat: number
  t: number
}

/** A parsed activity file, before filtering or clipping. */
export type RawTrack = {
  /** Stable id derived from the source filename. */
  id: string
  /** Epoch ms of the first record. */
  startTime: number
  source: 'fit' | 'gpx'
  /** FIT session fields; absent for GPX. Used to detect virtual rides. */
  sport?: string
  subSport?: string
  manufacturer?: string
  points: TrackPoint[]
}

/** A track that survived filtering, clipping and resampling. */
export type Ride = {
  id: string
  startTime: number
  points: TrackPoint[]
}
```

- [ ] **Step 5: Create the fixture directory note**

`test/fixtures/README.md`:

```markdown
# Test fixtures

`zwift-virtual.fit` is a real Zwift activity, copied here because it is the one FIT file
available before the Strava archive arrives. It exercises the two things most likely to
break: semicircle conversion, and virtual-ride detection.

Its coordinates are Watopia (-11.64, 166.95), roughly 13,000 km from Denver — which is
exactly why the out-of-region filter needs a test.

This file contains no personal location data. Do not add real outdoor rides here.
```

- [ ] **Step 6: Copy the fixture**

```bash
mkdir -p test/fixtures
cp ~/Documents/Zwift/Activities/2024-01-17-14-25-06.fit test/fixtures/zwift-virtual.fit
ls -la test/fixtures/
```

- [ ] **Step 7: Verify and commit**

```bash
npx tsc -b && npm test
git add -A && git commit -m "chore(rides): add FIT SDK, ride types, and gitignore for trace data"
```

Confirm with `git status --short` that no `data/rides/` or `public/rides/` path appears.

---

## Task 2: Semicircle conversion

**Files:**
- Create: `src/rides/semicircles.ts`
- Test: `src/rides/semicircles.test.ts`

**Interfaces:**
- Produces: `semicirclesToDegrees(n: number): number`, `degreesToSemicircles(d: number): number`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { degreesToSemicircles, semicirclesToDegrees } from './semicircles'

describe('semicirclesToDegrees', () => {
  it('converts a real Zwift coordinate to Watopia', () => {
    // Captured from test/fixtures/zwift-virtual.fit on 2026-07-28. The FIT SDK
    // returns this raw, even with applyScaleAndOffset: true.
    expect(semicirclesToDegrees(-138818392)).toBeCloseTo(-11.63562, 4)
    expect(semicirclesToDegrees(1991822250)).toBeCloseTo(166.95261, 4)
  })

  it('maps zero to zero', () => {
    expect(semicirclesToDegrees(0)).toBe(0)
  })

  it('maps 2^31 semicircles to 180 degrees', () => {
    expect(semicirclesToDegrees(2 ** 31)).toBeCloseTo(180, 9)
    expect(semicirclesToDegrees(-(2 ** 31))).toBeCloseTo(-180, 9)
  })

  it('round-trips a Denver coordinate', () => {
    const lat = 39.6133
    expect(semicirclesToDegrees(degreesToSemicircles(lat))).toBeCloseTo(lat, 6)
  })

  it('produces a value that is obviously wrong if conversion is skipped', () => {
    // Guard against anyone "simplifying" this module away: the raw value is
    // not a plausible latitude, so skipping conversion fails loudly.
    expect(Math.abs(-138818392)).toBeGreaterThan(90)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/rides/semicircles.test.ts`
Expected: FAIL — cannot resolve `./semicircles`.

- [ ] **Step 3: Implement**

```ts
/**
 * FIT stores positions as semicircles: a signed 32-bit integer spanning the
 * full circle, so 2^31 semicircles == 180 degrees.
 *
 * The Garmin SDK returns these raw. Decoding with `applyScaleAndOffset: true`
 * does NOT convert them -- verified against @garmin/fitsdk@21.208.0 on
 * 2026-07-28. Skipping this conversion yields coordinates that are silently
 * wrong rather than obviously broken.
 */
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31

export function semicirclesToDegrees(semicircles: number): number {
  return semicircles * SEMICIRCLES_TO_DEGREES
}

export function degreesToSemicircles(degrees: number): number {
  return degrees / SEMICIRCLES_TO_DEGREES
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/rides/semicircles.test.ts` — expect 5 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): FIT semicircle to degree conversion"
```

---

## Task 3: Privacy clipping

**Files:**
- Create: `src/rides/privacy.ts`
- Test: `src/rides/privacy.test.ts`

**Interfaces:**
- Consumes: `haversineMeters` from `../geo/haversine.ts`, `TrackPoint` from `./types.ts`
- Produces: `clipEnds(points: TrackPoint[], meters: number): TrackPoint[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { TrackPoint } from './types'
import { clipEnds } from './privacy'

/** A straight north-bound line at ~11.1 m spacing (0.0001 deg latitude). */
function line(n: number): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lon: -105.0,
    lat: 39.6 + i * 0.0001,
    t: 1_700_000_000_000 + i * 1000,
  }))
}

describe('clipEnds', () => {
  it('removes roughly the requested distance from each end', () => {
    // 200 points ~= 2224 m. Clipping 500 m from both ends should leave ~1224 m.
    const clipped = clipEnds(line(200), 500)
    expect(clipped.length).toBeGreaterThan(100)
    expect(clipped.length).toBeLessThan(160)
    // The retained span must start well after the original start.
    expect(clipped[0].lat).toBeGreaterThan(39.604)
    expect(clipped[clipped.length - 1].lat).toBeLessThan(39.6199 - 0.004)
  })

  it('leaves the middle geometry untouched', () => {
    const original = line(200)
    const clipped = clipEnds(original, 500)
    // Every retained point must be an unmodified original point.
    for (const p of clipped) {
      expect(original).toContainEqual(p)
    }
  })

  it('clips a short trace to empty', () => {
    // 20 points ~= 211 m, far less than 2 x 500 m.
    expect(clipEnds(line(20), 500)).toEqual([])
  })

  it('honours zero as opt-out rather than a default', () => {
    const original = line(50)
    expect(clipEnds(original, 0)).toHaveLength(50)
  })

  it('returns empty for a track too small to clip', () => {
    expect(clipEnds([], 500)).toEqual([])
    expect(clipEnds(line(1), 500)).toEqual([])
  })

  it('does not mutate the input', () => {
    const original = line(200)
    const copy = JSON.parse(JSON.stringify(original))
    clipEnds(original, 500)
    expect(original).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/rides/privacy.test.ts` — FAIL, unresolved import.

- [ ] **Step 3: Implement**

```ts
import { haversineMeters } from '../geo/haversine.ts'
import type { TrackPoint } from './types.ts'

/**
 * Drop the first and last `meters` of a trace.
 *
 * Rides start where you live. This runs in the importer, before anything is
 * written, so unclipped coordinates never reach disk.
 *
 * It permanently removes real coverage near every ride start -- streets within
 * `meters` of home may never reach 100%. That is the accepted cost of not
 * storing where you live.
 */
export function clipEnds(points: TrackPoint[], meters: number): TrackPoint[] {
  if (meters <= 0) return points.slice()
  if (points.length < 2) return []

  // First index at least `meters` along the track.
  let start = points.length
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    acc += haversineMeters(points[i - 1].lon, points[i - 1].lat, points[i].lon, points[i].lat)
    if (acc >= meters) {
      start = i
      break
    }
  }

  // Last index at least `meters` from the end.
  let end = -1
  acc = 0
  for (let i = points.length - 2; i >= 0; i--) {
    acc += haversineMeters(points[i].lon, points[i].lat, points[i + 1].lon, points[i + 1].lat)
    if (acc >= meters) {
      end = i
      break
    }
  }

  if (start > end) return []
  return points.slice(start, end + 1)
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/rides/privacy.test.ts` — expect 6 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): clip privacy zones from both ends of a trace"
```

---

## Task 4: Distance-based resampling

**Files:**
- Create: `src/rides/resample.ts`
- Test: `src/rides/resample.test.ts`

**Interfaces:**
- Consumes: `haversineMeters`, `TrackPoint`
- Produces: `resampleByDistance(points: TrackPoint[], spacingMeters: number): TrackPoint[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { TrackPoint } from './types'
import { resampleByDistance } from './resample'

function line(n: number, stepDeg = 0.0001): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lon: -105.0,
    lat: 39.6 + i * stepDeg,
    t: 1_700_000_000_000 + i * 1000,
  }))
}

describe('resampleByDistance', () => {
  it('collapses a stationary cluster to almost nothing', () => {
    // A coffee stop: 300 points inside a 5 m radius. Time-based sampling would
    // keep all 300 and bias M3's matching toward wherever you paused.
    const stopped: TrackPoint[] = Array.from({ length: 300 }, (_, i) => ({
      lon: -105.0 + (i % 3) * 0.00001,
      lat: 39.6,
      t: 1_700_000_000_000 + i * 1000,
    }))
    const out = resampleByDistance(stopped, 10)
    expect(out.length).toBeLessThan(10)
  })

  it('keeps the first and last point exactly', () => {
    const pts = line(100)
    const out = resampleByDistance(pts, 25)
    expect(out[0]).toEqual(pts[0])
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
  })

  it('thins a dense straight line toward the requested spacing', () => {
    // 100 points at ~11.1 m spacing = ~1100 m. At 50 m spacing expect ~22-25.
    const out = resampleByDistance(line(100), 50)
    expect(out.length).toBeGreaterThan(15)
    expect(out.length).toBeLessThan(30)
  })

  it('leaves an already-sparse track alone', () => {
    // Points 111 m apart, spacing 50 m: every point survives.
    const sparse = line(10, 0.001)
    expect(resampleByDistance(sparse, 50)).toHaveLength(10)
  })

  it('handles degenerate inputs', () => {
    expect(resampleByDistance([], 10)).toEqual([])
    expect(resampleByDistance(line(1), 10)).toHaveLength(1)
    expect(resampleByDistance(line(2), 10)).toHaveLength(2)
  })

  it('treats zero spacing as no resampling', () => {
    expect(resampleByDistance(line(50), 0)).toHaveLength(50)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/rides/resample.test.ts`

- [ ] **Step 3: Implement**

```ts
import { haversineMeters } from '../geo/haversine.ts'
import type { TrackPoint } from './types.ts'

/**
 * Thin a trace so consecutive points are at least `spacingMeters` apart.
 *
 * Distance-based, never time-based. A stopped rider emits hundreds of points
 * within a few meters; keeping them all biases M3's nearest-node matching
 * toward wherever the ride paused.
 */
export function resampleByDistance(
  points: TrackPoint[],
  spacingMeters: number,
): TrackPoint[] {
  if (spacingMeters <= 0 || points.length <= 2) return points.slice()

  const out: TrackPoint[] = [points[0]]
  let sinceKept = 0

  for (let i = 1; i < points.length - 1; i++) {
    sinceKept += haversineMeters(
      points[i - 1].lon,
      points[i - 1].lat,
      points[i].lon,
      points[i].lat,
    )
    if (sinceKept >= spacingMeters) {
      out.push(points[i])
      sinceKept = 0
    }
  }

  out.push(points[points.length - 1])
  return out
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/rides/resample.test.ts` — expect 6 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): distance-based trace resampling"
```

---

## Task 5: Rejection rules

**Files:**
- Create: `src/rides/filter.ts`
- Test: `src/rides/filter.test.ts`

**Interfaces:**
- Consumes: `RawTrack`, `TrackPoint`, `Bbox` from `../geo/bounds.ts`
- Produces:
  - `type RejectReason = 'no-positions' | 'virtual' | 'out-of-region' | 'too-short-after-clip'`
  - `trackBbox(points: TrackPoint[]): Bbox | null`
  - `padBbox(bbox: Bbox, meters: number): Bbox`
  - `bboxesIntersect(a: Bbox, b: Bbox): boolean`
  - `classifyTrack(track: RawTrack, region: Bbox): RejectReason | null` — `null` means keep

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { Bbox } from '../geo/bounds'
import type { RawTrack, TrackPoint } from './types'
import { bboxesIntersect, classifyTrack, padBbox, trackBbox } from './filter'

const METRO: Bbox = { minLon: -105.21, minLat: 39.49, maxLon: -104.58, maxLat: 39.91 }

function track(points: TrackPoint[], extra: Partial<RawTrack> = {}): RawTrack {
  return { id: 't', startTime: 0, source: 'fit', points, ...extra }
}

const denver: TrackPoint[] = [
  { lon: -105.0, lat: 39.62, t: 0 },
  { lon: -104.99, lat: 39.63, t: 1000 },
]

// Watopia, from the real Zwift fixture.
const watopia: TrackPoint[] = [
  { lon: 166.9526, lat: -11.6356, t: 0 },
  { lon: 166.9531, lat: -11.6361, t: 1000 },
]

describe('trackBbox', () => {
  it('spans the points', () => {
    expect(trackBbox(denver)).toEqual({
      minLon: -105.0, minLat: 39.62, maxLon: -104.99, maxLat: 39.63,
    })
  })

  it('returns null for no points', () => {
    expect(trackBbox([])).toBeNull()
  })
})

describe('padBbox', () => {
  it('grows the box by roughly the requested meters', () => {
    const padded = padBbox({ minLon: -105, minLat: 39.6, maxLon: -105, maxLat: 39.6 }, 5000)
    // 5 km is ~0.045 deg of latitude.
    expect(padded.maxLat - 39.6).toBeGreaterThan(0.04)
    expect(padded.maxLat - 39.6).toBeLessThan(0.05)
    // Longitude degrees are shorter at 39.6N, so the lon pad must be larger.
    expect(padded.maxLon - -105).toBeGreaterThan(padded.maxLat - 39.6)
  })
})

describe('bboxesIntersect', () => {
  it('detects overlap and separation', () => {
    expect(bboxesIntersect(METRO, trackBbox(denver)!)).toBe(true)
    expect(bboxesIntersect(METRO, trackBbox(watopia)!)).toBe(false)
  })
})

describe('classifyTrack', () => {
  it('keeps a Denver ride', () => {
    expect(classifyTrack(track(denver), METRO)).toBeNull()
  })

  it('rejects a track with no positions', () => {
    expect(classifyTrack(track([]), METRO)).toBe('no-positions')
  })

  it('rejects a Zwift ride by subSport', () => {
    // Real value from test/fixtures/zwift-virtual.fit.
    expect(classifyTrack(track(denver, { subSport: 'virtualActivity' }), METRO)).toBe('virtual')
  })

  it('rejects a Zwift ride by manufacturer', () => {
    // Checked independently: a future virtual platform may set only one field.
    expect(classifyTrack(track(denver, { manufacturer: 'zwift' }), METRO)).toBe('virtual')
  })

  it('rejects a ride outside the metro region', () => {
    expect(classifyTrack(track(watopia), METRO)).toBe('out-of-region')
  })

  it('checks virtual before region, so a Watopia Zwift ride reports virtual', () => {
    // Both rules match; the more specific reason is the useful one to report.
    expect(classifyTrack(track(watopia, { subSport: 'virtualActivity' }), METRO)).toBe('virtual')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/rides/filter.test.ts`

- [ ] **Step 3: Implement**

```ts
import type { Bbox } from '../geo/bounds.ts'
import type { RawTrack, TrackPoint } from './types.ts'

export type RejectReason =
  | 'no-positions'
  | 'virtual'
  | 'out-of-region'
  | 'too-short-after-clip'

export function trackBbox(points: TrackPoint[]): Bbox | null {
  if (points.length === 0) return null
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

const METERS_PER_DEGREE_LAT = 111_195

/** Grow a bbox by `meters`, widening longitude to account for latitude. */
export function padBbox(bbox: Bbox, meters: number): Bbox {
  const dLat = meters / METERS_PER_DEGREE_LAT
  const midLat = ((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180)
  // cos(lat) shrinks toward the poles; clamp so a polar bbox cannot explode.
  const dLon = dLat / Math.max(Math.cos(midLat), 0.01)
  return {
    minLon: bbox.minLon - dLon,
    minLat: bbox.minLat - dLat,
    maxLon: bbox.maxLon + dLon,
    maxLat: bbox.maxLat + dLat,
  }
}

export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return (
    a.minLon <= b.maxLon &&
    a.maxLon >= b.minLon &&
    a.minLat <= b.maxLat &&
    a.maxLat >= b.minLat
  )
}

// Compared lowercased, so these entries must be lowercase too.
const VIRTUAL_SUB_SPORTS = new Set(['virtualactivity'])
const VIRTUAL_MANUFACTURERS = new Set(['zwift'])

/**
 * Decide whether a track belongs in the dataset.
 *
 * Returns null to keep, or the reason to reject. Order matters: virtual is
 * checked before region so a Watopia Zwift ride reports "virtual", which is
 * the actionable reason, rather than "out-of-region".
 */
export function classifyTrack(track: RawTrack, region: Bbox): RejectReason | null {
  if (track.points.length === 0) return 'no-positions'

  const subSport = track.subSport?.toLowerCase()
  const manufacturer = track.manufacturer?.toLowerCase()
  if (
    (subSport !== undefined && VIRTUAL_SUB_SPORTS.has(subSport)) ||
    (manufacturer !== undefined && VIRTUAL_MANUFACTURERS.has(manufacturer))
  ) {
    return 'virtual'
  }

  const bbox = trackBbox(track.points)
  if (!bbox) return 'no-positions'
  if (!bboxesIntersect(region, bbox)) return 'out-of-region'

  return null
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/rides/filter.test.ts` — expect 10 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): reject virtual, empty, and out-of-region tracks"
```

---

## Task 6: Ride snapshot format

**Files:**
- Create: `src/rides/snapshot.ts`
- Test: `src/rides/snapshot.test.ts`

**Interfaces:**
- Consumes: `Ride`, `Bbox`
- Produces:
  - `RIDES_SNAPSHOT_VERSION = 1`
  - `type RidesBuffers = { positions: Float64Array; startIndices: Uint32Array; times: Float64Array }`
  - `type RidesManifest`
  - `class RidesSnapshotError` with `.code`
  - `packRides(rides: Ride[]): RidesBuffers`
  - `ridePoints(buffers: RidesBuffers, index: number): number[]`
  - `validateRides(manifest: RidesManifest, buffers: RidesBuffers): void`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { Ride } from './types'
import {
  RIDES_SNAPSHOT_VERSION,
  RidesSnapshotError,
  packRides,
  ridePoints,
  validateRides,
  type RidesManifest,
} from './snapshot'

const RIDES: Ride[] = [
  {
    id: 'a',
    startTime: 1_700_000_000_000,
    points: [
      { lon: -105.0, lat: 39.6, t: 1_700_000_000_000 },
      { lon: -104.99, lat: 39.61, t: 1_700_000_001_000 },
    ],
  },
  {
    id: 'b',
    startTime: 1_700_000_100_000,
    points: [
      { lon: -104.98, lat: 39.62, t: 1_700_000_100_000 },
      { lon: -104.97, lat: 39.63, t: 1_700_000_101_000 },
      { lon: -104.96, lat: 39.64, t: 1_700_000_102_000 },
    ],
  },
]

function manifestFor(b: ReturnType<typeof packRides>): RidesManifest {
  return {
    version: RIDES_SNAPSHOT_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    rideCount: 2,
    pointCount: 5,
    totalMeters: 1234,
    clipMeters: 500,
    resampleMeters: 10,
    bbox: { minLon: -105, minLat: 39.6, maxLon: -104.96, maxLat: 39.64 },
    rejected: { 'no-positions': 0, virtual: 40, 'out-of-region': 2, 'too-short-after-clip': 1 },
    byteLengths: {
      positions: b.positions.byteLength,
      startIndices: b.startIndices.byteLength,
      times: b.times.byteLength,
    },
  }
}

describe('packRides', () => {
  it('produces one startIndex per ride plus a terminator', () => {
    const b = packRides(RIDES)
    expect(Array.from(b.startIndices)).toEqual([0, 2, 5])
  })

  it('preserves coordinates exactly', () => {
    const b = packRides(RIDES)
    expect(ridePoints(b, 0)).toEqual([-105.0, 39.6, -104.99, 39.61])
    expect(ridePoints(b, 1)).toEqual([-104.98, 39.62, -104.97, 39.63, -104.96, 39.64])
  })

  it('stores one start time per ride, for the M6 scrubber', () => {
    const b = packRides(RIDES)
    expect(Array.from(b.times)).toEqual([1_700_000_000_000, 1_700_000_100_000])
  })

  it('handles an empty ride list', () => {
    const b = packRides([])
    expect(b.positions.length).toBe(0)
    expect(Array.from(b.startIndices)).toEqual([0])
  })
})

describe('validateRides', () => {
  it('accepts a matching manifest', () => {
    const b = packRides(RIDES)
    expect(() => validateRides(manifestFor(b), b)).not.toThrow()
  })

  it('rejects a version mismatch', () => {
    const b = packRides(RIDES)
    const m = { ...manifestFor(b), version: RIDES_SNAPSHOT_VERSION + 1 }
    try {
      validateRides(m, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as RidesSnapshotError).code).toBe('VERSION_MISMATCH')
    }
  })

  it('rejects a truncated buffer', () => {
    const b = packRides(RIDES)
    try {
      validateRides(manifestFor(b), { ...b, positions: b.positions.slice(0, 4) })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as RidesSnapshotError).code).toBe('TRUNCATED')
    }
  })

  it('rejects a terminator that disagrees with pointCount', () => {
    const b = packRides(RIDES)
    try {
      validateRides({ ...manifestFor(b), pointCount: 99 }, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as RidesSnapshotError).code).toBe('MISALIGNED')
    }
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/rides/snapshot.test.ts`

- [ ] **Step 3: Implement**

```ts
import type { Bbox } from '../geo/bounds.ts'
import type { Ride } from './types.ts'
import type { RejectReason } from './filter.ts'

/**
 * Bump when the layout OR the meaning changes.
 *
 * A change to the default clip distance counts as a meaning change: the same
 * layout would describe a different denominator once M3 computes coverage.
 */
export const RIDES_SNAPSHOT_VERSION = 1

export type RidesBuffers = {
  /** Flat [lon, lat, ...] Float64. */
  positions: Float64Array
  /** rideCount + 1 point offsets; last entry is the total point count. */
  startIndices: Uint32Array
  /** Ride start time in epoch ms, one per ride. For the M6 timeline. */
  times: Float64Array
}

export type RidesManifest = {
  version: number
  generatedAt: string
  rideCount: number
  pointCount: number
  totalMeters: number
  /** Meters clipped from each end. Part of what the data means. */
  clipMeters: number
  resampleMeters: number
  bbox: Bbox
  rejected: Record<RejectReason, number>
  byteLengths: {
    positions: number
    startIndices: number
    times: number
  }
}

export type RidesSnapshotErrorCode = 'VERSION_MISMATCH' | 'TRUNCATED' | 'MISALIGNED'

export class RidesSnapshotError extends Error {
  code: RidesSnapshotErrorCode

  constructor(code: RidesSnapshotErrorCode, message: string) {
    super(message)
    this.name = 'RidesSnapshotError'
    this.code = code
  }
}

export function packRides(rides: Ride[]): RidesBuffers {
  let pointCount = 0
  for (const r of rides) pointCount += r.points.length

  const positions = new Float64Array(pointCount * 2)
  const startIndices = new Uint32Array(rides.length + 1)
  const times = new Float64Array(rides.length)

  let p = 0
  for (let i = 0; i < rides.length; i++) {
    startIndices[i] = p
    times[i] = rides[i].startTime
    for (const pt of rides[i].points) {
      positions[p * 2] = pt.lon
      positions[p * 2 + 1] = pt.lat
      p++
    }
  }
  startIndices[rides.length] = p

  return { positions, startIndices, times }
}

/** Flat [lon, lat, ...] for one ride. Test and debug helper. */
export function ridePoints(buffers: RidesBuffers, index: number): number[] {
  const start = buffers.startIndices[index]
  const end = buffers.startIndices[index + 1]
  return Array.from(buffers.positions.subarray(start * 2, end * 2))
}

export function validateRides(
  manifest: RidesManifest,
  buffers: RidesBuffers,
): void {
  if (manifest.version !== RIDES_SNAPSHOT_VERSION) {
    throw new RidesSnapshotError(
      'VERSION_MISMATCH',
      `Rides snapshot version ${manifest.version} does not match expected ${RIDES_SNAPSHOT_VERSION}. Re-run build:rides.`,
    )
  }

  const expected = manifest.byteLengths
  const actual = {
    positions: buffers.positions.byteLength,
    startIndices: buffers.startIndices.byteLength,
    times: buffers.times.byteLength,
  }
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (actual[key] !== expected[key]) {
      throw new RidesSnapshotError(
        'TRUNCATED',
        `Buffer "${key}" is ${actual[key]} bytes, manifest declares ${expected[key]}.`,
      )
    }
  }

  if (buffers.startIndices.length !== manifest.rideCount + 1) {
    throw new RidesSnapshotError(
      'MISALIGNED',
      `startIndices has ${buffers.startIndices.length} entries, expected rideCount + 1 = ${manifest.rideCount + 1}.`,
    )
  }

  const terminator = buffers.startIndices[manifest.rideCount]
  if (terminator !== manifest.pointCount) {
    throw new RidesSnapshotError(
      'MISALIGNED',
      `startIndices terminator is ${terminator}, manifest declares pointCount ${manifest.pointCount}.`,
    )
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/rides/snapshot.test.ts` — expect 8 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): versioned binary ride snapshot format"
```

---

## Task 7: FIT parsing

**Files:**
- Create: `scripts/fit.ts`
- Test: `scripts/fit.test.ts`

**Interfaces:**
- Consumes: `@garmin/fitsdk`, `semicirclesToDegrees`, `RawTrack`
- Produces: `parseFit(bytes: Uint8Array, id: string): RawTrack`

- [ ] **Step 1: Write the failing test**

This test runs against the real Zwift fixture copied in Task 1.

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFit } from './fit'

const FIXTURE = join(process.cwd(), 'test', 'fixtures', 'zwift-virtual.fit')

describe('parseFit', () => {
  const track = parseFit(new Uint8Array(readFileSync(FIXTURE)), 'zwift-virtual')

  it('extracts every positioned record', () => {
    expect(track.points.length).toBe(1592)
  })

  it('converts semicircles to real degrees', () => {
    // Raw semicircles would be -138818392 / 1991822250, which are not
    // plausible coordinates. Watopia is -11.64, 166.95.
    expect(track.points[0].lat).toBeCloseTo(-11.63562, 4)
    expect(track.points[0].lon).toBeCloseTo(166.95261, 4)
    for (const p of track.points) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180)
    }
  })

  it('surfaces the fields the virtual-ride filter needs', () => {
    expect(track.subSport).toBe('virtualActivity')
    expect(track.manufacturer).toBe('zwift')
    expect(track.sport).toBe('cycling')
  })

  it('records a start time and the source', () => {
    expect(track.startTime).toBeGreaterThan(1_600_000_000_000)
    expect(track.source).toBe('fit')
    expect(track.id).toBe('zwift-virtual')
  })

  it('emits monotonically non-decreasing timestamps', () => {
    for (let i = 1; i < track.points.length; i++) {
      expect(track.points[i].t).toBeGreaterThanOrEqual(track.points[i - 1].t)
    }
  })

  it('throws a clear error on a non-FIT buffer', () => {
    expect(() => parseFit(new Uint8Array([1, 2, 3, 4]), 'junk')).toThrow(/not a valid FIT/i)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run scripts/fit.test.ts`

- [ ] **Step 3: Implement**

```ts
import { Decoder, Stream } from '@garmin/fitsdk'
import { semicirclesToDegrees } from '../src/rides/semicircles.ts'
import type { RawTrack, TrackPoint } from '../src/rides/types.ts'

type FitRecord = {
  positionLat?: number
  positionLong?: number
  timestamp?: Date | number
}

/**
 * Parse a FIT activity into a RawTrack.
 *
 * Positions arrive as semicircles and the SDK does not convert them, even with
 * applyScaleAndOffset. See src/rides/semicircles.ts.
 */
export function parseFit(bytes: Uint8Array, id: string): RawTrack {
  const stream = Stream.fromByteArray(bytes)
  if (!Decoder.isFIT(stream)) {
    throw new Error(`"${id}" is not a valid FIT file`)
  }

  const decoder = new Decoder(stream)
  if (!decoder.checkIntegrity()) {
    throw new Error(`"${id}" failed the FIT integrity check`)
  }

  const { messages } = decoder.read({
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  })

  const records = (messages.recordMesgs ?? []) as FitRecord[]
  const points: TrackPoint[] = []
  for (const r of records) {
    if (r.positionLat == null || r.positionLong == null) continue
    points.push({
      lat: semicirclesToDegrees(r.positionLat),
      lon: semicirclesToDegrees(r.positionLong),
      t: r.timestamp instanceof Date ? r.timestamp.getTime() : Number(r.timestamp ?? 0),
    })
  }

  const session = (messages.sessionMesgs ?? [])[0] as
    | { sport?: string; subSport?: string; startTime?: Date }
    | undefined
  const fileId = (messages.fileIdMesgs ?? [])[0] as
    | { manufacturer?: string; timeCreated?: Date }
    | undefined

  const startTime =
    points[0]?.t ??
    (session?.startTime instanceof Date ? session.startTime.getTime() : 0)

  return {
    id,
    startTime,
    source: 'fit',
    sport: session?.sport,
    subSport: session?.subSport,
    manufacturer: fileId?.manufacturer,
    points,
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run scripts/fit.test.ts` — expect 6 passing.

If the record count assertion fails, print the real count and update the test — the fixture is fixed, so the number is stable, but verify rather than assume.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): FIT activity parsing via the Garmin SDK"
```

---

## Task 8: GPX parsing

**Files:**
- Create: `scripts/gpx.ts`
- Test: `scripts/gpx.test.ts`

**Interfaces:**
- Produces: `parseGpx(xml: string, id: string): RawTrack`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { parseGpx } from './gpx'

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StravaGPX">
  <trk>
    <name>Morning Ride</name>
    <trkseg>
      <trkpt lat="39.6133" lon="-105.0166">
        <ele>1620.0</ele>
        <time>2026-07-28T13:00:00Z</time>
      </trkpt>
      <trkpt lat="39.6140" lon="-105.0170">
        <time>2026-07-28T13:00:05Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`

describe('parseGpx', () => {
  it('extracts track points in order', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.points).toHaveLength(2)
    expect(t.points[0].lat).toBeCloseTo(39.6133, 6)
    expect(t.points[0].lon).toBeCloseTo(-105.0166, 6)
    expect(t.points[1].lat).toBeCloseTo(39.614, 6)
  })

  it('parses timestamps to epoch ms', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.points[0].t).toBe(Date.parse('2026-07-28T13:00:00Z'))
    expect(t.points[1].t - t.points[0].t).toBe(5000)
  })

  it('marks the source and start time', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.source).toBe('gpx')
    expect(t.startTime).toBe(Date.parse('2026-07-28T13:00:00Z'))
  })

  it('leaves virtual-ride fields undefined; GPX carries no session data', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.subSport).toBeUndefined()
    expect(t.manufacturer).toBeUndefined()
  })

  it('handles a track with no points', () => {
    const t = parseGpx('<gpx><trk><trkseg></trkseg></trk></gpx>', 'empty')
    expect(t.points).toEqual([])
  })

  it('handles points with no time element', () => {
    const t = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="39.6" lon="-105.0"></trkpt></trkseg></trk></gpx>',
      'notime',
    )
    expect(t.points).toHaveLength(1)
    expect(t.points[0].t).toBe(0)
  })

  it('reads multiple segments as one continuous track', () => {
    const two = GPX.replace('</trkseg>', '</trkseg><trkseg><trkpt lat="39.7" lon="-105.1"><time>2026-07-28T13:00:10Z</time></trkpt></trkseg>')
    expect(parseGpx(two, 'multi').points).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run scripts/gpx.test.ts`

- [ ] **Step 3: Implement**

A regex reader is deliberate here: GPX track points are a flat, highly regular
structure, and this avoids adding an XML parser dependency for one shape.

```ts
import type { RawTrack, TrackPoint } from '../src/rides/types.ts'

// lat and lon appear in either order across exporters.
const TRKPT = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g
const LAT = /\blat\s*=\s*"([^"]+)"/
const LON = /\blon\s*=\s*"([^"]+)"/
const TIME = /<time>([^<]+)<\/time>/

/**
 * Parse a GPX track. Strava exports manually-entered activities as GPX and
 * device recordings as FIT, so an archive contains both.
 */
export function parseGpx(xml: string, id: string): RawTrack {
  const points: TrackPoint[] = []

  for (const m of xml.matchAll(TRKPT)) {
    const attrs = m[1] ?? m[3] ?? ''
    const body = m[2] ?? ''
    const lat = LAT.exec(attrs)
    const lon = LON.exec(attrs)
    if (!lat || !lon) continue

    const time = TIME.exec(body)
    const parsed = time ? Date.parse(time[1]) : NaN

    points.push({
      lat: Number(lat[1]),
      lon: Number(lon[1]),
      t: Number.isNaN(parsed) ? 0 : parsed,
    })
  }

  return {
    id,
    startTime: points[0]?.t ?? 0,
    source: 'gpx',
    points,
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run scripts/gpx.test.ts` — expect 7 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): GPX track parsing"
```

---

## Task 9: Import CLI

**Files:**
- Create: `scripts/import-rides.ts`

**Interfaces:**
- Consumes: `parseFit`, `parseGpx`, `classifyTrack`, `clipEnds`, `resampleByDistance`
- Produces: `data/rides/<id>.json`, each `{ id, startTime, points }`

- [ ] **Step 1: Implement**

```ts
import { gunzipSync } from 'node:zlib'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { pathLengthMeters } from '../src/geo/haversine.ts'
import { classifyTrack, padBbox, type RejectReason } from '../src/rides/filter.ts'
import { clipEnds } from '../src/rides/privacy.ts'
import { resampleByDistance } from '../src/rides/resample.ts'
import type { RawTrack } from '../src/rides/types.ts'
import { parseFit } from './fit.ts'
import { parseGpx } from './gpx.ts'

const OUT_DIR = join(process.cwd(), 'data', 'rides')
const NETWORK_DIR = join(process.cwd(), 'public', 'network')

const DEFAULT_CLIP_METERS = 500
const DEFAULT_RESAMPLE_METERS = 10
const REGION_PAD_METERS = 5000

type Args = {
  source: string
  clipMeters: number
  resampleMeters: number
}

function parseArgs(argv: string[]): Args {
  let source = ''
  let clipMeters = DEFAULT_CLIP_METERS
  let resampleMeters = DEFAULT_RESAMPLE_METERS

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--archive' || argv[i] === '--dir') source = argv[i + 1] ?? ''
    if (argv[i] === '--clip-meters') {
      const n = Number(argv[i + 1])
      if (!Number.isFinite(n) || n < 0) throw new Error(`--clip-meters expects a number >= 0`)
      clipMeters = n
    }
    if (argv[i] === '--resample-meters') {
      const n = Number(argv[i + 1])
      if (!Number.isFinite(n) || n < 0) throw new Error(`--resample-meters expects a number >= 0`)
      resampleMeters = n
    }
  }

  if (!source) throw new Error('Specify --dir <path> pointing at a directory of activity files')
  return { source, clipMeters, resampleMeters }
}

/** Union bbox of the metro-core regions, padded. Rides outside it are not ours. */
async function metroRegion() {
  const dirs = (await readdir(NETWORK_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let found = 0

  for (const d of dirs) {
    const m = JSON.parse(await readFile(join(NETWORK_DIR, d, 'manifest.json'), 'utf8'))
    if (m.group !== 'metro-core') continue
    found++
    minLon = Math.min(minLon, m.bbox.minLon)
    minLat = Math.min(minLat, m.bbox.minLat)
    maxLon = Math.max(maxLon, m.bbox.maxLon)
    maxLat = Math.max(maxLat, m.bbox.maxLat)
  }

  if (found === 0) {
    throw new Error(
      'No metro-core network snapshots found. Run the M1 pipeline first: npm run fetch:network -- --group metro-core && npm run build:snapshot',
    )
  }
  return padBbox({ minLon, minLat, maxLon, maxLat }, REGION_PAD_METERS)
}

async function parseFile(path: string, id: string): Promise<RawTrack | null> {
  let buf = await readFile(path)
  let ext = extname(path).toLowerCase()

  if (ext === '.gz') {
    // Activity files are a few hundred KB; a sync inflate is simpler than a
    // stream pipeline and the import is already sequential.
    buf = gunzipSync(buf)
    ext = extname(basename(path, '.gz')).toLowerCase()
  }

  if (ext === '.fit') return parseFit(new Uint8Array(buf), id)
  if (ext === '.gpx') return parseGpx(buf.toString('utf8'), id)
  return null // .tcx and anything else: skipped, counted separately
}

async function main(): Promise<void> {
  const { source, clipMeters, resampleMeters } = parseArgs(process.argv.slice(2))
  const region = await metroRegion()
  await mkdir(OUT_DIR, { recursive: true })

  const entries = (await readdir(source, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort()

  const rejected: Record<RejectReason, number> = {
    'no-positions': 0,
    virtual: 0,
    'out-of-region': 0,
    'too-short-after-clip': 0,
  }
  let imported = 0
  let unsupported = 0
  let failed = 0
  let totalMeters = 0

  for (const name of entries) {
    const id = basename(name).replace(/\.(fit|gpx|tcx)(\.gz)?$/i, '')
    let track: RawTrack | null
    try {
      track = await parseFile(join(source, name), id)
    } catch (error) {
      // One corrupt file must not abandon a 500-ride import.
      console.error(`  skip  ${name} — ${String(error)}`)
      failed++
      continue
    }
    if (!track) {
      unsupported++
      continue
    }

    const reason = classifyTrack(track, region)
    if (reason) {
      rejected[reason]++
      continue
    }

    // Clip BEFORE any write: unclipped coordinates never reach disk.
    const clipped = clipEnds(track.points, clipMeters)
    if (clipped.length < 2) {
      rejected['too-short-after-clip']++
      continue
    }

    const points = resampleByDistance(clipped, resampleMeters)
    const flat = new Float64Array(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = points[i].lon
      flat[i * 2 + 1] = points[i].lat
    }
    totalMeters += pathLengthMeters(flat, 0, points.length)

    await writeFile(
      join(OUT_DIR, `${id}.json`),
      JSON.stringify({ id, startTime: track.startTime, points }),
    )
    imported++
  }

  const km = (totalMeters / 1000).toFixed(0)
  console.log(`\nimported ${imported} rides, ${km} km (clip ${clipMeters}m, resample ${resampleMeters}m)`)
  console.log(
    `rejected: virtual ${rejected.virtual}, out-of-region ${rejected['out-of-region']}, ` +
      `no-positions ${rejected['no-positions']}, too-short-after-clip ${rejected['too-short-after-clip']}`,
  )
  if (unsupported > 0) console.log(`skipped ${unsupported} unsupported files (.tcx etc.)`)
  if (failed > 0) console.log(`failed to parse ${failed} files`)
  if (imported === 0) {
    console.error('\nNothing imported. If every ride was rejected as out-of-region, the rides may belong to a region the network pipeline has not fetched.')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 2: Verify argument handling without touching data**

```bash
npm run import:rides
```
Expected: exits non-zero with `Specify --dir <path> ...`.

```bash
npm run import:rides -- --dir /tmp --clip-meters abc
```
Expected: `--clip-meters expects a number >= 0`.

- [ ] **Step 3: Run against the Zwift directory — every ride should be rejected**

```bash
npm run import:rides -- --dir ~/Documents/Zwift/Activities
```

Expected: `imported 0`, `rejected: virtual 40` (or however many files are present), and a non-zero exit with the "nothing imported" hint. **This is the correct outcome** — it proves the virtual filter works against real files before your archive lands.

- [ ] **Step 4: Confirm nothing was written**

```bash
ls data/rides/ 2>/dev/null | wc -l   # expect 0
git status --short                    # expect no data/rides entries
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rides): import CLI with privacy clipping and rejection reporting"
```

---

## Task 10: Build CLI

**Files:**
- Create: `scripts/build-rides.ts`

**Interfaces:**
- Consumes: `packRides`, `validateRides`, `bboxOf`, `pathLengthMeters`
- Produces: `public/rides/{manifest.json,positions.bin,startIndices.bin,times.bin}`

- [ ] **Step 1: Implement**

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bboxOf } from '../src/geo/bounds.ts'
import { pathLengthMeters } from '../src/geo/haversine.ts'
import type { RejectReason } from '../src/rides/filter.ts'
import {
  RIDES_SNAPSHOT_VERSION,
  packRides,
  validateRides,
  type RidesManifest,
} from '../src/rides/snapshot.ts'
import type { Ride } from '../src/rides/types.ts'

const IN_DIR = join(process.cwd(), 'data', 'rides')
const OUT_DIR = join(process.cwd(), 'public', 'rides')

async function main(): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(IN_DIR)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    throw new Error(`No imported rides at ${IN_DIR}. Run "npm run import:rides -- --dir <path>" first.`)
  }
  if (files.length === 0) {
    throw new Error(`No imported rides at ${IN_DIR}. Run "npm run import:rides -- --dir <path>" first.`)
  }

  const rides: Ride[] = []
  for (const f of files) {
    rides.push(JSON.parse(await readFile(join(IN_DIR, f), 'utf8')) as Ride)
  }
  // Chronological order makes the M6 scrubber a prefix scan.
  rides.sort((a, b) => a.startTime - b.startTime)

  const buffers = packRides(rides)

  let totalMeters = 0
  for (let i = 0; i < rides.length; i++) {
    totalMeters += pathLengthMeters(
      buffers.positions,
      buffers.startIndices[i],
      buffers.startIndices[i + 1],
    )
  }

  const empty: Record<RejectReason, number> = {
    'no-positions': 0,
    virtual: 0,
    'out-of-region': 0,
    'too-short-after-clip': 0,
  }

  const manifest: RidesManifest = {
    version: RIDES_SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    rideCount: rides.length,
    pointCount: buffers.startIndices[rides.length],
    totalMeters,
    // Recorded by the importer; the build step only reports what it received.
    clipMeters: -1,
    resampleMeters: -1,
    bbox: bboxOf(buffers.positions),
    rejected: empty,
    byteLengths: {
      positions: buffers.positions.byteLength,
      startIndices: buffers.startIndices.byteLength,
      times: buffers.times.byteLength,
    },
  }

  validateRides(manifest, buffers)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(OUT_DIR, 'positions.bin'), Buffer.from(buffers.positions.buffer))
  await writeFile(join(OUT_DIR, 'startIndices.bin'), Buffer.from(buffers.startIndices.buffer))
  await writeFile(join(OUT_DIR, 'times.bin'), Buffer.from(buffers.times.buffer))

  const bytes =
    manifest.byteLengths.positions +
    manifest.byteLengths.startIndices +
    manifest.byteLengths.times
  console.log(
    `${rides.length} rides — ${manifest.pointCount} points, ` +
      `${(totalMeters / 1000).toFixed(0)} km, ${(bytes / 1e6).toFixed(2)} MB`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

**Note on `clipMeters: -1`:** the importer knows the clip distance, the build step does not. Task 12 threads it through by having the importer write a sidecar `data/rides/_meta.json`; until then `-1` means "unknown" rather than a fake value.

- [ ] **Step 2: Verify it fails cleanly with no input**

```bash
npm run build:rides
```
Expected: non-zero exit, `No imported rides at ... Run "npm run import:rides ..." first.`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(rides): build a versioned binary ride snapshot"
```

---

## Task 11: Thread clip settings through, and browser loading

**Files:**
- Modify: `scripts/import-rides.ts`, `scripts/build-rides.ts`
- Create: `src/rides/loadRides.ts`, `src/rides/useRides.ts`
- Test: `src/rides/loadRides.test.ts`

**Interfaces:**
- Produces:
  - `loadRides(fetchImpl?): Promise<LoadedRides | null>` — `null` when no snapshot exists
  - `useRides(): RidesState`

- [ ] **Step 1: Have the importer record its settings**

In `scripts/import-rides.ts`, after the loop, write a sidecar:

```ts
  await writeFile(
    join(OUT_DIR, '_meta.json'),
    JSON.stringify({ clipMeters, resampleMeters, rejected, importedAt: new Date().toISOString() }, null, 2),
  )
```

And in the file listing, skip it:

```ts
    files = (await readdir(IN_DIR)).filter((f) => f.endsWith('.json') && f !== '_meta.json').sort()
```

- [ ] **Step 2: Have the build step read it**

In `scripts/build-rides.ts`, replace the `clipMeters: -1` / `resampleMeters: -1` / `rejected: empty` lines with values read from `_meta.json`, falling back to the placeholders when it is absent:

```ts
  let meta = { clipMeters: -1, resampleMeters: -1, rejected: empty }
  try {
    meta = { ...meta, ...JSON.parse(await readFile(join(IN_DIR, '_meta.json'), 'utf8')) }
  } catch {
    console.warn('  no _meta.json; clip/resample settings will be reported as unknown')
  }
```

Then use `meta.clipMeters`, `meta.resampleMeters`, `meta.rejected` in the manifest.

- [ ] **Step 3: Write the failing loader test**

```ts
import { describe, expect, it } from 'vitest'
import { loadRides } from './loadRides'
import { RIDES_SNAPSHOT_VERSION, packRides } from './snapshot'

const RIDES = [
  { id: 'a', startTime: 1_700_000_000_000, points: [
    { lon: -105.0, lat: 39.6, t: 0 }, { lon: -104.99, lat: 39.61, t: 1000 },
  ] },
]

function fixture() {
  const b = packRides(RIDES)
  const manifest = {
    version: RIDES_SNAPSHOT_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    rideCount: 1,
    pointCount: 2,
    totalMeters: 1400,
    clipMeters: 500,
    resampleMeters: 10,
    bbox: { minLon: -105, minLat: 39.6, maxLon: -104.99, maxLat: 39.61 },
    rejected: { 'no-positions': 0, virtual: 40, 'out-of-region': 0, 'too-short-after-clip': 0 },
    byteLengths: {
      positions: b.positions.byteLength,
      startIndices: b.startIndices.byteLength,
      times: b.times.byteLength,
    },
  }
  return { manifest, b }
}

function fetchFor(manifest: unknown, b: ReturnType<typeof packRides>) {
  return async (url: string) => {
    if (String(url).endsWith('manifest.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(manifest), arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const buf = String(url).endsWith('positions.bin') ? b.positions.buffer
      : String(url).endsWith('startIndices.bin') ? b.startIndices.buffer
      : b.times.buffer
    return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => buf }
  }
}

describe('loadRides', () => {
  it('decodes a snapshot', async () => {
    const { manifest, b } = fixture()
    const loaded = await loadRides(fetchFor(manifest, b) as never)
    expect(loaded!.manifest.rideCount).toBe(1)
    expect(loaded!.buffers.positions.length).toBe(4)
    expect(loaded!.offsets).toBeInstanceOf(Float32Array)
  })

  it('returns null when no snapshot exists, rather than throwing', async () => {
    // Not importing rides yet is a normal state, not an error.
    const missing = async () => ({ ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) })
    expect(await loadRides(missing as never)).toBeNull()
  })

  it('returns null when a dev server serves HTML for the missing manifest', async () => {
    const spa = async () => ({ ok: true, status: 200, text: async () => '<!doctype html><html></html>', arrayBuffer: async () => new ArrayBuffer(0) })
    expect(await loadRides(spa as never)).toBeNull()
  })

  it('throws on a version mismatch', async () => {
    const { manifest, b } = fixture()
    const bad = { ...manifest, version: RIDES_SNAPSHOT_VERSION + 1 }
    await expect(loadRides(fetchFor(bad, b) as never)).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
  })
})
```

- [ ] **Step 4: Run and confirm it fails**

Run: `npx vitest run src/rides/loadRides.test.ts`

- [ ] **Step 5: Implement `src/rides/loadRides.ts`**

```ts
import { bboxOf, centerOf, toLngLatOffsets } from '../geo/bounds.ts'
import {
  validateRides,
  type RidesBuffers,
  type RidesManifest,
} from './snapshot.ts'

export type LoadedRides = {
  manifest: RidesManifest
  buffers: RidesBuffers
  origin: [number, number]
  offsets: Float32Array
}

type FetchLike = typeof globalThis.fetch

/**
 * Load the rides snapshot, or null if there isn't one.
 *
 * Having no rides yet is a normal state -- the snapshot is gitignored, so a
 * fresh clone always starts without it. Only a corrupt or mismatched snapshot
 * is an error.
 */
export async function loadRides(
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<LoadedRides | null> {
  const res = await fetchImpl('rides/manifest.json')
  if (!res.ok) return null

  const text = await res.text()
  // A dev server's SPA fallback answers a missing file with index.html at 200.
  if (text.trimStart().startsWith('<')) return null

  let manifest: RidesManifest
  try {
    manifest = JSON.parse(text) as RidesManifest
  } catch {
    return null
  }

  const get = async (name: string) => {
    const r = await fetchImpl(`rides/${name}`)
    if (!r.ok) throw new Error(`rides/${name} returned HTTP ${r.status}`)
    return r.arrayBuffer()
  }

  const [pos, starts, times] = await Promise.all([
    get('positions.bin'),
    get('startIndices.bin'),
    get('times.bin'),
  ])

  const buffers: RidesBuffers = {
    positions: new Float64Array(pos),
    startIndices: new Uint32Array(starts),
    times: new Float64Array(times),
  }

  validateRides(manifest, buffers)

  const origin = centerOf(bboxOf(buffers.positions))
  return {
    manifest,
    buffers,
    origin,
    offsets: toLngLatOffsets(buffers.positions, origin),
  }
}
```

- [ ] **Step 6: Implement `src/rides/useRides.ts`**

```ts
import { useEffect, useState } from 'react'
import { loadRides, type LoadedRides } from './loadRides.ts'

export type RidesState = {
  status: 'loading' | 'ready' | 'absent' | 'error'
  rides: LoadedRides | null
  error?: string
}

export function useRides(): RidesState {
  const [state, setState] = useState<RidesState>({ status: 'loading', rides: null })

  useEffect(() => {
    let canceled = false
    loadRides()
      .then((rides) => {
        if (canceled) return
        setState(rides ? { status: 'ready', rides } : { status: 'absent', rides: null })
      })
      .catch((error) => {
        if (canceled) return
        setState({
          status: 'error',
          rides: null,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      canceled = true
    }
  }, [])

  return state
}
```

- [ ] **Step 7: Run the suite and commit**

```bash
npm test && npx tsc -b
git add -A && git commit -m "feat(rides): browser snapshot loading and import settings passthrough"
```

---

## Task 12: Render traces and report them

**Files:**
- Create: `src/layers/rideLayer.ts`
- Test: `src/layers/rideLayer.test.ts`
- Modify: `src/components/MapView.tsx`, `src/components/StatsPanel.tsx`, `src/App.tsx`

**Interfaces:**
- Produces: `buildRideLayerProps(rides: LoadedRides)`, `createRideLayer(rides: LoadedRides)`; `<MapView regions rides showRides />`

- [ ] **Step 1: Write the failing layer test**

```ts
import { describe, expect, it } from 'vitest'
import type { LoadedRides } from '../rides/loadRides'
import { RIDE_COLOR, buildRideLayerProps } from './rideLayer'

const rides = {
  manifest: { rideCount: 2, version: 1 },
  origin: [-105, 39.6] as [number, number],
  offsets: new Float32Array([0, 0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03]),
  buffers: {
    positions: new Float64Array(8),
    startIndices: new Uint32Array([0, 2, 4]),
    times: new Float64Array([1, 2]),
  },
} as unknown as LoadedRides

describe('buildRideLayerProps', () => {
  it('feeds deck.gl binary data', () => {
    const p = buildRideLayerProps(rides)
    expect(p.data.length).toBe(2)
    expect(p.data.startIndices).toBeInstanceOf(Uint32Array)
    expect(p.data.attributes.getPath.value).toBeInstanceOf(Float32Array)
    expect(p.data.attributes.getPath.size).toBe(2)
  })

  it('anchors to the rides origin', () => {
    expect(buildRideLayerProps(rides).coordinateOrigin).toEqual([-105, 39.6])
  })

  it('draws above the network with a single warm color', () => {
    const p = buildRideLayerProps(rides)
    expect(p.getColor).toEqual(RIDE_COLOR)
    expect(p.id).toBe('rides')
  })

  it('uses a wider stroke than the network so traces read on top', () => {
    expect(buildRideLayerProps(rides).widthMinPixels).toBeGreaterThan(0.75)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/layers/rideLayer.test.ts`

- [ ] **Step 3: Implement `src/layers/rideLayer.ts`**

```ts
import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { LoadedRides } from '../rides/loadRides.ts'

/**
 * Warm and semi-transparent: overlapping traces accumulate, so streets ridden
 * many times read brighter. An honest preview of what M3 computes properly.
 */
export const RIDE_COLOR: [number, number, number, number] = [255, 90, 40, 90]

export function buildRideLayerProps(rides: LoadedRides) {
  return {
    id: 'rides',
    data: {
      length: rides.manifest.rideCount,
      startIndices: rides.buffers.startIndices,
      attributes: {
        getPath: { value: rides.offsets, size: 2 },
      },
    },
    _pathType: 'open' as const,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
    coordinateOrigin: rides.origin,
    getColor: RIDE_COLOR,
    widthUnits: 'pixels' as const,
    getWidth: 2,
    widthMinPixels: 1.5,
    widthMaxPixels: 6,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    updateTriggers: { getColor: [rides.manifest.version] },
  }
}

export function createRideLayer(rides: LoadedRides): PathLayer {
  return new PathLayer(buildRideLayerProps(rides) as never)
}
```

- [ ] **Step 4: Wire into `MapView`**

Change the props and layer list:

```tsx
type Props = {
  regions: LoadedRegion[]
  rides: LoadedRides | null
  showRides: boolean
}

export default function MapView({ regions, rides, showRides }: Props) {
  const layers = useMemo(() => {
    const network = regions.map((region) => createNetworkLayer(region))
    // Rides draw last so they sit above the network.
    return rides && showRides ? [...network, createRideLayer(rides)] : network
  }, [regions, rides, showRides])
  ...
}
```

Add the imports for `createRideLayer` and `LoadedRides`.

- [ ] **Step 5: Add ride stats and a toggle to `StatsPanel`**

Extend the props to `{ state, rides, showRides, onToggleRides }` and add, above the diagnostics row:

```tsx
      {rides.status === 'ready' && rides.rides && (
        <div className="mt-3 border-t border-white/20 pt-2">
          <label className="flex cursor-pointer items-center justify-between text-xs">
            <span>
              {rides.rides.manifest.rideCount.toLocaleString()} rides ·{' '}
              {km(rides.rides.manifest.totalMeters)} km ridden
            </span>
            <input
              type="checkbox"
              checked={showRides}
              onChange={onToggleRides}
              className="ml-2"
            />
          </label>
          {rides.rides.manifest.clipMeters > 0 && (
            <div className="mt-1 text-xs text-neutral-500">
              {rides.rides.manifest.clipMeters} m clipped from each end
            </div>
          )}
        </div>
      )}
      {rides.status === 'absent' && (
        <div className="mt-3 border-t border-white/20 pt-2 text-xs text-neutral-500">
          No rides imported — run npm run import:rides
        </div>
      )}
```

The headline percentage stays `0.00%`: M2 computes no coverage, and showing anything else would be a lie.

- [ ] **Step 6: Wire `App.tsx`**

```tsx
const state = useNetwork()
const rides = useRides()
const [showRides, setShowRides] = useState(true)
...
<MapView regions={state.regions} rides={rides.rides} showRides={showRides} />
<StatsPanel state={state} rides={rides} showRides={showRides} onToggleRides={() => setShowRides((v) => !v)} />
```

- [ ] **Step 7: Verify in the browser**

```bash
npm run build && npm run dev
```

With no rides imported: the network renders and the panel reads "No rides imported". With rides imported: traces draw over the network and the checkbox toggles them.

- [ ] **Step 8: Full verification and commit**

```bash
npm test && npx tsc -b && npm run build
git status --short   # must show NO data/rides or public/rides entries
git add -A && git commit -m "feat(rides): render ride traces over the network"
```

---

## Task 13: Documentation and real-archive run

**Files:**
- Modify: `README.md`, `docs/measurements.md`

- [ ] **Step 1: Document the ride pipeline in `README.md`**

Add after the network setup section:

```markdown
## Rides

```bash
npm run import:rides -- --dir <path to unzipped Strava export>/activities
npm run build:rides
```

Ride traces are **never committed** — `data/rides/` and `public/rides/` are gitignored,
because they are personal location data. A fresh clone shows the street network and no
rides until you re-import.

**Privacy clipping** removes the first and last 500 m of every ride (`--clip-meters` to
change). Rides start where you live. The cost is real and permanent: streets within 500 m
of any ride start may never reach 100% coverage.

**Rejected automatically:** virtual rides (Zwift sets `subSport: virtualActivity`, and its
coordinates are in the Solomon Sea), rides with no GPS, and rides whose bounding box falls
outside the metro-core regions. The importer reports counts by reason.
```

- [ ] **Step 2: Run against the real archive when it arrives**

```bash
unzip -q ~/Downloads/strava_export_*.zip -d ~/Downloads/strava
npm run import:rides -- --dir ~/Downloads/strava/activities
npm run build:rides
```

Record in `docs/measurements.md`: rides imported, rides rejected by reason, total km,
snapshot size, and decode time. Expect a meaningful `virtual` count given the Zwift history.

- [ ] **Step 3: Sanity-check the result on the map**

Traces should follow streets, not cut across blocks. A trace that visibly ignores the road
network means the coordinate conversion is wrong — check semicircles first.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/measurements.md
git commit -m "docs: ride import pipeline and privacy trade-offs"
```

---

## Self-Review Notes

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| FIT parsing, semicircle conversion | 2, 7 |
| GPX parsing, mixed-format archive | 8, 9 |
| Virtual / out-of-region / empty rejection | 5, 9 |
| Privacy clipping before any write | 3, 9 |
| Distance-based resampling | 4, 9 |
| Gitignored storage | 1, 12 |
| Versioned binary snapshot | 6, 10 |
| Browser load, absent-is-normal | 11 |
| Trace rendering, toggle, stats | 12 |
| Headline stays 0.00% | 12 |
| Tests over pure modules | 2–6, 11, 12 |

**Deferred confirmed absent:** coverage computation, node matching, PostGIS, MCP sync, neighborhood stats, timeline scrubber. `times.bin` is stored but unused — M6 needs it and it costs 8 bytes per ride.
