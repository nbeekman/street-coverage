# M1 Network Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch the street network for ten Denver-metro regions from Overpass, pack it into versioned binary snapshots, and render all of it over a MapLibre basemap with deck.gl at interactive framerates.

**Architecture:** Two offline Node scripts own all Overpass contact and produce committed binary snapshots (`positions`/`startIndices`/`wayIds`/`classes` + a manifest per region). The browser only fetches static files, decodes typed arrays, and feeds them straight into a deck.gl `PathLayer` as binary attributes. Geometry is stored Float64 for later coverage math but rendered as Float32 offsets from a per-region origin, which keeps centimeter precision in a 32-bit attribute.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Vitest 4, Tailwind 4, deck.gl 9.3, MapLibre GL 6, react-map-gl 8.

**Spec:** `docs/superpowers/specs/2026-07-27-m1-network-render-design.md`

## Global Constraints

- **TypeScript must be `~5.9.3`, NOT 7.x.** `typescript-eslint@8.65` declares `typescript >=4.8.4 <6.1.0`. TypeScript 7.0.2 is `latest` on npm and will break linting. Verified 2026-07-27.
- **`@vitejs/plugin-react@6` requires `vite@^8`.** These two move together.
- **Everything under `scripts/` and everything it imports must use erasable TypeScript syntax only.** The scripts run via Node 24 native type stripping (`node --disable-warning=ExperimentalWarning scripts/x.ts`). No `enum`, no `namespace`, no constructor parameter properties (`constructor(public x: T)`), no `declare` class fields. Plain `type`/`interface`/annotations are fine. This constrains `src/network/*` and `src/geo/*` because the scripts import them.
- **Install scoped deck.gl packages, not the `deck.gl` umbrella.** The umbrella declares `@arcgis/core` as a peer dependency. Use `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/react`, `@deck.gl/widgets`, all `^9.3.7` (`@deck.gl/react` peers on `~9.3.0` of core *and* widgets).
- **`overpass.osm.ch` must never be in the mirror pool.** It responds quickly but only holds Switzerland, returning a valid `0`-element response for Colorado rather than an error.
- **Snapshot format version is `1`.** Any change to buffer layout bumps `SNAPSHOT_VERSION` and invalidates existing snapshots.
- **Highway class list, in this exact order** (index into `classes.bin` — reordering silently recolors every existing snapshot): `primary`, `secondary`, `tertiary`, `residential`, `unclassified`, `living_street`, `cycleway`.
- **Basemap style URL:** `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` — free, no token, no account.
- Commit after every task. Never commit `data/raw/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/geo/haversine.ts` | Great-circle distance; path length over a flat coordinate array |
| `src/geo/bounds.ts` | Bbox, center, and lng/lat → Float32 offset conversion |
| `src/network/regions.ts` | Region registry + Overpass query construction |
| `src/network/normalize.ts` | Overpass elements → ways with resolved coordinates |
| `src/network/snapshot.ts` | Binary pack/unpack + validation, manifest types |
| `src/network/loadSnapshot.ts` | Browser-side fetch + decode of one region |
| `src/network/useNetwork.ts` | React hook orchestrating all region loads |
| `src/layers/networkLayer.ts` | deck.gl PathLayer factory with binary attributes |
| `src/components/MapView.tsx` | MapLibre basemap + DeckGL overlay |
| `src/components/StatsPanel.tsx` | Headline %, per-region rows, diagnostics |
| `src/components/useFps.ts` | rAF-based FPS sampler |
| `src/App.tsx` | Wiring + top-level error/loading states |
| `scripts/overpass.ts` | Mirror pool, response validation, retry policy |
| `scripts/fetch-network.ts` | CLI: Overpass → `data/raw/<id>.json` |
| `scripts/build-snapshot.ts` | CLI: raw JSON → `public/network/<id>/*` |

---

## Task 1: Project scaffold and toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Test: `src/geo/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test`, `npm run dev`, `npm run build` for every later task

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "street-coverage",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "fetch:network": "node --disable-warning=ExperimentalWarning scripts/fetch-network.ts",
    "build:snapshot": "node --disable-warning=ExperimentalWarning scripts/build-snapshot.ts"
  },
  "dependencies": {
    "@deck.gl/core": "^9.3.7",
    "@deck.gl/layers": "^9.3.7",
    "@deck.gl/react": "^9.3.7",
    "@deck.gl/widgets": "^9.3.7",
    "maplibre-gl": "^6.0.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-map-gl": "^8.1.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/node": "^24.10.1",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.4",
    "tailwindcss": "^4.3.3",
    "typescript": "~5.9.3",
    "vite": "^8.1.5",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules
dist
data/raw
*.local
.DS_Store
```

`data/raw` holds the multi-hundred-megabyte Overpass responses. Only `public/network/` is committed.

- [ ] **Step 3: Create `vite.config.ts`**

```ts
// `vitest/config` re-exports Vite's defineConfig with the `test` key typed.
// Importing from 'vite' instead makes `test` a type error.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
```

The pure modules under test need no DOM, so `environment: 'node'` avoids a jsdom dependency entirely. M1 ships no component tests.

- [ ] **Step 4: Create `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "scripts"]
}
```

`erasableSyntaxOnly` makes the compiler enforce the Node type-stripping constraint from Global Constraints, so a violation is a build error rather than a runtime crash in a script.

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Street Coverage — Denver</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/index.css`, `src/main.tsx`, `src/App.tsx`**

`src/index.css`:

```css
@import "tailwindcss";

html, body, #root {
  height: 100%;
  margin: 0;
  background: #0b0d10;
  color: #e6e8eb;
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx`:

```tsx
export default function App() {
  return <div className="p-4">Street Coverage</div>
}
```

- [ ] **Step 7: Write a smoke test that proves the runner works**

Create `src/geo/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 8: Install and verify**

```bash
npm install
npm test
npm run build
```

Expected: `npm test` passes 1 test. `npm run build` completes with no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React 19 + TS + Tailwind + Vitest"
```

---

## Task 2: Geo primitives

**Files:**
- Create: `src/geo/haversine.ts`, `src/geo/bounds.ts`
- Test: `src/geo/haversine.test.ts`, `src/geo/bounds.test.ts`
- Delete: `src/geo/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number`
  - `pathLengthMeters(positions: Float64Array, startVertex: number, endVertex: number): number` — `endVertex` exclusive
  - `type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number }`
  - `bboxOf(positions: Float64Array): Bbox`
  - `centerOf(bbox: Bbox): [number, number]`
  - `toLngLatOffsets(positions: Float64Array, origin: [number, number]): Float32Array`

- [ ] **Step 1: Write the failing haversine test**

Create `src/geo/haversine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { haversineMeters, pathLengthMeters } from './haversine'

// One degree of latitude on a sphere of radius 6371008.8 m:
// 6371008.8 * PI / 180 = 111195.08 m
const ONE_DEGREE_M = 111195.08

describe('haversineMeters', () => {
  it('returns zero for identical points', () => {
    expect(haversineMeters(-104.99, 39.74, -104.99, 39.74)).toBe(0)
  })

  it('measures one degree of latitude', () => {
    expect(haversineMeters(0, 0, 0, 1)).toBeCloseTo(ONE_DEGREE_M, 1)
  })

  it('measures one degree of longitude at the equator', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(ONE_DEGREE_M, 1)
  })

  it('shrinks longitude distance with latitude', () => {
    // At 60N, a degree of longitude is half its equatorial length.
    // Precision -1 (within 5 m); the cosine approximation is not exact.
    expect(haversineMeters(0, 60, 1, 60)).toBeCloseTo(ONE_DEGREE_M / 2, -1)
  })

  it('is symmetric', () => {
    const a = haversineMeters(-104.99, 39.74, -105.02, 39.61)
    const b = haversineMeters(-105.02, 39.61, -104.99, 39.74)
    expect(a).toBeCloseTo(b, 9)
  })
})

describe('pathLengthMeters', () => {
  it('returns zero for a single vertex', () => {
    const p = new Float64Array([0, 0])
    expect(pathLengthMeters(p, 0, 1)).toBe(0)
  })

  it('sums consecutive segments', () => {
    const p = new Float64Array([0, 0, 0, 1, 0, 2])
    expect(pathLengthMeters(p, 0, 3)).toBeCloseTo(ONE_DEGREE_M * 2, 1)
  })

  it('respects a vertex sub-range', () => {
    const p = new Float64Array([0, 0, 0, 1, 0, 2])
    expect(pathLengthMeters(p, 1, 3)).toBeCloseTo(ONE_DEGREE_M, 1)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/geo/haversine.test.ts`
Expected: FAIL — cannot resolve `./haversine`.

- [ ] **Step 3: Implement `src/geo/haversine.ts`**

```ts
/** IUGG mean Earth radius, meters. */
const EARTH_RADIUS_M = 6371008.8
const DEG_TO_RAD = Math.PI / 180

export function haversineMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const phi1 = lat1 * DEG_TO_RAD
  const phi2 = lat2 * DEG_TO_RAD
  const dPhi = (lat2 - lat1) * DEG_TO_RAD
  const dLambda = (lon2 - lon1) * DEG_TO_RAD

  const sinDPhi = Math.sin(dPhi / 2)
  const sinDLambda = Math.sin(dLambda / 2)
  const a =
    sinDPhi * sinDPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda

  // Math.min guards against a > 1 from floating point error at antipodes.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Length of a polyline stored as a flat [lon, lat, lon, lat, ...] array.
 * Indices are vertex indices (not array indices); `endVertex` is exclusive.
 */
export function pathLengthMeters(
  positions: Float64Array,
  startVertex: number,
  endVertex: number,
): number {
  let total = 0
  for (let v = startVertex; v < endVertex - 1; v++) {
    total += haversineMeters(
      positions[v * 2],
      positions[v * 2 + 1],
      positions[v * 2 + 2],
      positions[v * 2 + 3],
    )
  }
  return total
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/geo/haversine.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing bounds test**

Create `src/geo/bounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bboxOf, centerOf, toLngLatOffsets } from './bounds'

describe('bboxOf', () => {
  it('spans all points', () => {
    const p = new Float64Array([-105, 39.6, -104.8, 39.9, -104.95, 39.7])
    expect(bboxOf(p)).toEqual({
      minLon: -105,
      minLat: 39.6,
      maxLon: -104.8,
      maxLat: 39.9,
    })
  })

  it('handles a single point', () => {
    const p = new Float64Array([-104.99, 39.74])
    expect(bboxOf(p)).toEqual({
      minLon: -104.99,
      minLat: 39.74,
      maxLon: -104.99,
      maxLat: 39.74,
    })
  })

  it('throws on an empty array', () => {
    expect(() => bboxOf(new Float64Array([]))).toThrow(/empty/i)
  })
})

describe('centerOf', () => {
  it('returns the bbox midpoint', () => {
    expect(
      centerOf({ minLon: -105, minLat: 39.6, maxLon: -104.8, maxLat: 39.9 }),
    ).toEqual([-104.9, 39.75])
  })
})

describe('toLngLatOffsets', () => {
  it('round-trips Denver coordinates to sub-centimeter precision', () => {
    // This is the whole point of the offset scheme: raw Float32 lng/lat at
    // longitude -105 carries ~1.4 m of error, which is unusable next to a
    // 25 m coverage radius.
    const origin: [number, number] = [-104.9, 39.75]
    const positions = new Float64Array([
      -104.987654321, 39.739812345, -105.012345678, 39.812345678,
    ])
    const offsets = toLngLatOffsets(positions, origin)

    for (let i = 0; i < positions.length; i += 2) {
      const lon = offsets[i] + origin[0]
      const lat = offsets[i + 1] + origin[1]
      // 1e-7 degrees is roughly 1 cm of latitude.
      expect(Math.abs(lon - positions[i])).toBeLessThan(1e-7)
      expect(Math.abs(lat - positions[i + 1])).toBeLessThan(1e-7)
    }
  })

  it('returns a Float32Array of the same length', () => {
    const offsets = toLngLatOffsets(
      new Float64Array([-105, 39.6, -104.8, 39.9]),
      [-104.9, 39.75],
    )
    expect(offsets).toBeInstanceOf(Float32Array)
    expect(offsets.length).toBe(4)
  })

  it('demonstrates why raw Float32 lng/lat is insufficient', () => {
    // Guard against anyone "simplifying" this module away later.
    const trueLon = -104.987654321
    const naive = Math.fround(trueLon)
    expect(Math.abs(naive - trueLon)).toBeGreaterThan(1e-6)
  })
})
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `npx vitest run src/geo/bounds.test.ts`
Expected: FAIL — cannot resolve `./bounds`.

- [ ] **Step 7: Implement `src/geo/bounds.ts`**

```ts
export type Bbox = {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

/** Bounding box of a flat [lon, lat, ...] coordinate array. */
export function bboxOf(positions: Float64Array): Bbox {
  if (positions.length === 0) {
    throw new Error('bboxOf: positions array is empty')
  }
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  for (let i = 0; i < positions.length; i += 2) {
    const lon = positions[i]
    const lat = positions[i + 1]
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

export function centerOf(bbox: Bbox): [number, number] {
  return [(bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2]
}

/**
 * Convert absolute lng/lat to Float32 offsets from `origin`.
 *
 * Float32 has ~7 significant decimal digits. At longitude -105 that leaves
 * roughly 1.4 m of error, which is visible on a 30 m street grid and useless
 * beside a 25 m coverage radius. Subtracting a nearby origin first drops the
 * magnitude to ~0.3 degrees, where Float32 resolves to a few millimeters.
 */
export function toLngLatOffsets(
  positions: Float64Array,
  origin: [number, number],
): Float32Array {
  const offsets = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 2) {
    offsets[i] = positions[i] - origin[0]
    offsets[i + 1] = positions[i + 1] - origin[1]
  }
  return offsets
}
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. Delete `src/geo/smoke.test.ts` — it has served its purpose.

- [ ] **Step 9: Commit**

```bash
git rm src/geo/smoke.test.ts
git add -A
git commit -m "feat(geo): haversine distance and lng/lat offset transforms"
```

---

## Task 3: Region registry and Overpass query builder

**Files:**
- Create: `src/network/regions.ts`
- Test: `src/network/regions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type RegionGroup = 'metro-core' | 'metro-outer' | 'mountain' | 'route'`
  - `type OsmKind = 'relation' | 'way'`
  - `type Region = { id: string; name: string; osmId: number; osmKind: OsmKind; group: RegionGroup }`
  - `const HIGHWAY_CLASSES: readonly string[]`
  - `const REGIONS: readonly Region[]`
  - `regionsInGroup(group: RegionGroup): Region[]`
  - `regionById(id: string): Region | undefined`
  - `buildOverpassQuery(region: Region): string`

- [ ] **Step 1: Write the failing test**

Create `src/network/regions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  HIGHWAY_CLASSES,
  REGIONS,
  buildOverpassQuery,
  regionById,
  regionsInGroup,
} from './regions'

describe('REGIONS', () => {
  it('has unique ids', () => {
    const ids = REGIONS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique osm ids', () => {
    const keys = REGIONS.map((r) => `${r.osmKind}:${r.osmId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('defines exactly ten metro-core regions', () => {
    expect(regionsInGroup('metro-core')).toHaveLength(10)
  })

  it('pins Denver to relation 1411339', () => {
    // Denver is a consolidated city-county at admin_level 6, so a name lookup
    // or an admin_level=8 filter finds nothing. The numeric id is the contract.
    const denver = regionById('denver')
    expect(denver).toMatchObject({ osmId: 1411339, osmKind: 'relation' })
  })

  it('includes both way-boundary CDPs in metro-core', () => {
    const ways = regionsInGroup('metro-core').filter((r) => r.osmKind === 'way')
    expect(ways.map((r) => r.id).sort()).toEqual(['columbine', 'ken-caryl'])
  })
})

describe('HIGHWAY_CLASSES', () => {
  it('is frozen in this exact order', () => {
    // classes.bin stores indices into this array. Reordering silently
    // recolors every snapshot already on disk.
    expect([...HIGHWAY_CLASSES]).toEqual([
      'primary',
      'secondary',
      'tertiary',
      'residential',
      'unclassified',
      'living_street',
      'cycleway',
    ])
  })
})

describe('buildOverpassQuery', () => {
  it('seeds a relation with rel()', () => {
    const q = buildOverpassQuery(regionById('denver')!)
    expect(q).toContain('rel(1411339);map_to_area->.r;')
  })

  it('seeds a way with way()', () => {
    const q = buildOverpassQuery(regionById('columbine')!)
    expect(q).toContain('way(33168093);map_to_area->.r;')
  })

  it('never uses area id offset arithmetic', () => {
    // area(2400000000 + wayId) measurably returns zero ways for these CDPs.
    const q = buildOverpassQuery(regionById('ken-caryl')!)
    expect(q).not.toMatch(/area\(\d{10,}\)/)
  })

  it('filters to every highway class', () => {
    const q = buildOverpassQuery(regionById('littleton')!)
    for (const cls of HIGHWAY_CLASSES) {
      expect(q).toContain(cls)
    }
  })

  it('excludes private access and requests node geometry', () => {
    const q = buildOverpassQuery(regionById('littleton')!)
    expect(q).toContain('["access"!~"private"]')
    expect(q).toContain('(._;>;);')
    expect(q).toContain('out body;')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/network/regions.test.ts`
Expected: FAIL — cannot resolve `./regions`.

- [ ] **Step 3: Implement `src/network/regions.ts`**

```ts
export type RegionGroup = 'metro-core' | 'metro-outer' | 'mountain' | 'route'
export type OsmKind = 'relation' | 'way'

export type Region = {
  /** Stable slug; used as the snapshot directory name. */
  id: string
  name: string
  osmId: number
  osmKind: OsmKind
  group: RegionGroup
}

/**
 * Index order is a storage contract: classes.bin holds indices into this
 * array. Append only. Reordering recolors every existing snapshot.
 */
export const HIGHWAY_CLASSES = [
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
  'cycleway',
] as const

export type HighwayClass = (typeof HIGHWAY_CLASSES)[number]

export function highwayClassIndex(tag: string | undefined): number {
  if (tag === undefined) return -1
  return (HIGHWAY_CLASSES as readonly string[]).indexOf(tag)
}

/**
 * OSM ids verified against live Nominatim and Overpass on 2026-07-27.
 * Denver is admin_level 6 (consolidated city-county), not 8.
 * Columbine and Ken Caryl are census designated places mapped as ways.
 */
export const REGIONS: readonly Region[] = [
  { id: 'denver',            name: 'Denver',            osmId: 1411339,   osmKind: 'relation', group: 'metro-core' },
  { id: 'lakewood',          name: 'Lakewood',          osmId: 112200,    osmKind: 'relation', group: 'metro-core' },
  { id: 'centennial',        name: 'Centennial',        osmId: 112951,    osmKind: 'relation', group: 'metro-core' },
  { id: 'highlands-ranch',   name: 'Highlands Ranch',   osmId: 19685245,  osmKind: 'relation', group: 'metro-core' },
  { id: 'littleton',         name: 'Littleton',         osmId: 112959,    osmKind: 'relation', group: 'metro-core' },
  { id: 'greenwood-village', name: 'Greenwood Village', osmId: 112940,    osmKind: 'relation', group: 'metro-core' },
  { id: 'ken-caryl',         name: 'Ken Caryl',         osmId: 624295048, osmKind: 'way',      group: 'metro-core' },
  { id: 'columbine',         name: 'Columbine',         osmId: 33168093,  osmKind: 'way',      group: 'metro-core' },
  { id: 'englewood',         name: 'Englewood',         osmId: 7243979,   osmKind: 'relation', group: 'metro-core' },
  { id: 'sheridan',          name: 'Sheridan',          osmId: 7240527,   osmKind: 'relation', group: 'metro-core' },

  { id: 'castle-rock',       name: 'Castle Rock',       osmId: 112343,    osmKind: 'relation', group: 'metro-outer' },

  { id: 'summit-county',     name: 'Summit County',     osmId: 441008,    osmKind: 'relation', group: 'mountain' },
]

export function regionsInGroup(group: RegionGroup): Region[] {
  return REGIONS.filter((r) => r.group === group)
}

export function regionById(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id)
}

/**
 * `map_to_area` derives the area from the element itself. The alternative --
 * area(3600000000 + relId) / area(2400000000 + wayId) -- measurably returns
 * zero ways for way-based CDPs, because Overpass only materializes areas for
 * ways present in its areas file.
 */
export function buildOverpassQuery(region: Region): string {
  const seed = region.osmKind === 'relation' ? 'rel' : 'way'
  const classes = HIGHWAY_CLASSES.join('|')
  return [
    '[out:json][timeout:180];',
    `${seed}(${region.osmId});map_to_area->.r;`,
    `way(area.r)["highway"~"^(${classes})$"]["access"!~"private"];`,
    '(._;>;);',
    'out body;',
  ].join('\n')
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/network/regions.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(network): region registry and map_to_area query builder"
```

---

## Task 4: Normalize Overpass elements into ways

**Files:**
- Create: `src/network/normalize.ts`
- Test: `src/network/normalize.test.ts`

**Interfaces:**
- Consumes: `HIGHWAY_CLASSES`, `highwayClassIndex` from `src/network/regions.ts`
- Produces:
  - `type OsmElement = OsmNode | OsmWay`
  - `type NormalizedWay = { id: number; classIndex: number; coords: number[] }`
  - `type NormalizedNetwork = { ways: NormalizedWay[]; uniqueNodeCount: number; droppedWays: number }`
  - `normalize(elements: OsmElement[]): NormalizedNetwork`

- [ ] **Step 1: Write the failing test**

Create `src/network/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalize, type OsmElement } from './normalize'

function node(id: number, lon: number, lat: number): OsmElement {
  return { type: 'node', id, lon, lat }
}

function way(id: number, nodes: number[], highway?: string): OsmElement {
  return { type: 'way', id, nodes, tags: highway ? { highway } : {} }
}

describe('normalize', () => {
  it('resolves node refs into flat coordinates', () => {
    const result = normalize([
      node(1, -105, 39.6),
      node(2, -104.9, 39.7),
      way(100, [1, 2], 'residential'),
    ])
    expect(result.ways).toHaveLength(1)
    expect(result.ways[0].id).toBe(100)
    expect(result.ways[0].coords).toEqual([-105, 39.6, -104.9, 39.7])
  })

  it('maps the highway tag to its class index', () => {
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      way(100, [1, 2], 'cycleway'),
    ])
    expect(result.ways[0].classIndex).toBe(6)
  })

  it('drops ways whose highway tag is not in the class list', () => {
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      way(100, [1, 2], 'motorway'),
    ])
    expect(result.ways).toHaveLength(0)
    expect(result.droppedWays).toBe(1)
  })

  it('drops ways with no highway tag at all', () => {
    const result = normalize([node(1, 0, 0), node(2, 0, 1), way(100, [1, 2])])
    expect(result.ways).toHaveLength(0)
    expect(result.droppedWays).toBe(1)
  })

  it('skips node refs that were not returned', () => {
    // Overpass can return a way whose nodes fall outside the requested set.
    const result = normalize([
      node(1, 0, 0),
      node(3, 0, 2),
      way(100, [1, 2, 3], 'residential'),
    ])
    expect(result.ways[0].coords).toEqual([0, 0, 0, 2])
  })

  it('drops ways left with fewer than two resolvable nodes', () => {
    const result = normalize([node(1, 0, 0), way(100, [1, 2], 'residential')])
    expect(result.ways).toHaveLength(0)
    expect(result.droppedWays).toBe(1)
  })

  it('counts unique referenced nodes, not repeats', () => {
    // Intersection nodes are shared between ways; the positions array
    // duplicates them but the unique count must not.
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      node(3, 0, 2),
      way(100, [1, 2], 'residential'),
      way(101, [2, 3], 'residential'),
    ])
    expect(result.uniqueNodeCount).toBe(3)
    expect(result.ways).toHaveLength(2)
  })

  it('preserves way order for deterministic snapshots', () => {
    const result = normalize([
      node(1, 0, 0),
      node(2, 0, 1),
      way(200, [1, 2], 'residential'),
      way(100, [1, 2], 'primary'),
    ])
    expect(result.ways.map((w) => w.id)).toEqual([200, 100])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/network/normalize.test.ts`
Expected: FAIL — cannot resolve `./normalize`.

- [ ] **Step 3: Implement `src/network/normalize.ts`**

```ts
import { highwayClassIndex } from './regions'

export type OsmNode = {
  type: 'node'
  id: number
  lon: number
  lat: number
}

export type OsmWay = {
  type: 'way'
  id: number
  nodes: number[]
  tags?: Record<string, string>
}

export type OsmElement = OsmNode | OsmWay

export type NormalizedWay = {
  id: number
  classIndex: number
  /** Flat [lon, lat, lon, lat, ...]. */
  coords: number[]
}

export type NormalizedNetwork = {
  ways: NormalizedWay[]
  uniqueNodeCount: number
  droppedWays: number
}

export function normalize(elements: OsmElement[]): NormalizedNetwork {
  const nodeLon = new Map<number, number>()
  const nodeLat = new Map<number, number>()

  for (const el of elements) {
    if (el.type === 'node') {
      nodeLon.set(el.id, el.lon)
      nodeLat.set(el.id, el.lat)
    }
  }

  const ways: NormalizedWay[] = []
  const referenced = new Set<number>()
  let droppedWays = 0

  for (const el of elements) {
    if (el.type !== 'way') continue

    const classIndex = highwayClassIndex(el.tags?.highway)
    if (classIndex < 0) {
      droppedWays++
      continue
    }

    const coords: number[] = []
    const seen: number[] = []
    for (const ref of el.nodes) {
      const lon = nodeLon.get(ref)
      const lat = nodeLat.get(ref)
      // A ref can be absent when the way straddles the boundary.
      if (lon === undefined || lat === undefined) continue
      coords.push(lon, lat)
      seen.push(ref)
    }

    if (coords.length < 4) {
      droppedWays++
      continue
    }

    for (const ref of seen) referenced.add(ref)
    ways.push({ id: el.id, classIndex, coords })
  }

  return { ways, uniqueNodeCount: referenced.size, droppedWays }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/network/normalize.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(network): normalize Overpass elements into coordinate ways"
```

---

## Task 5: Binary snapshot pack and unpack

**Files:**
- Create: `src/network/snapshot.ts`
- Test: `src/network/snapshot.test.ts`

**Interfaces:**
- Consumes: `NormalizedWay` from `./normalize`, `Bbox` from `../geo/bounds`, `RegionGroup`/`OsmKind` from `./regions`
- Produces:
  - `const SNAPSHOT_VERSION = 1`
  - `type SnapshotBuffers = { positions: Float64Array; startIndices: Uint32Array; wayIds: Float64Array; classes: Uint8Array }`
  - `type SnapshotManifest` (full shape below)
  - `class SnapshotError extends Error` with `.code`
  - `packSnapshot(ways: NormalizedWay[]): SnapshotBuffers`
  - `wayCoords(buffers: SnapshotBuffers, wayIndex: number): number[]`
  - `validateSnapshot(manifest: SnapshotManifest, buffers: SnapshotBuffers): void`

- [ ] **Step 1: Write the failing test**

Create `src/network/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { NormalizedWay } from './normalize'
import {
  SNAPSHOT_VERSION,
  SnapshotError,
  packSnapshot,
  validateSnapshot,
  wayCoords,
  type SnapshotManifest,
} from './snapshot'

const WAYS: NormalizedWay[] = [
  { id: 100, classIndex: 3, coords: [-105, 39.6, -104.99, 39.61] },
  { id: 101, classIndex: 6, coords: [-104.99, 39.61, -104.98, 39.62, -104.97, 39.63] },
]

function manifestFor(buffers: ReturnType<typeof packSnapshot>): SnapshotManifest {
  return {
    version: SNAPSHOT_VERSION,
    regionId: 'test',
    regionName: 'Test',
    group: 'metro-core',
    osmId: 1,
    osmKind: 'relation',
    generatedAt: '2026-07-27T00:00:00.000Z',
    osmTimestamp: '2026-07-27T00:00:00Z',
    queryHash: 'abc123',
    bbox: { minLon: -105, minLat: 39.6, maxLon: -104.97, maxLat: 39.63 },
    wayCount: 2,
    positionCount: 5,
    uniqueNodeCount: 4,
    totalMeters: 1234,
    classes: ['primary'],
    byteLengths: {
      positions: buffers.positions.byteLength,
      startIndices: buffers.startIndices.byteLength,
      wayIds: buffers.wayIds.byteLength,
      classes: buffers.classes.byteLength,
    },
  }
}

describe('packSnapshot', () => {
  it('produces one startIndex per way plus a terminator', () => {
    const b = packSnapshot(WAYS)
    expect(b.startIndices.length).toBe(3)
    expect(Array.from(b.startIndices)).toEqual([0, 2, 5])
  })

  it('preserves coordinates exactly', () => {
    const b = packSnapshot(WAYS)
    expect(wayCoords(b, 0)).toEqual(WAYS[0].coords)
    expect(wayCoords(b, 1)).toEqual(WAYS[1].coords)
  })

  it('stores way ids in Float64 so large OSM ids survive', () => {
    // 624295048 fits in Uint32, but OSM way ids have already passed 2^32.
    const b = packSnapshot([{ id: 12_345_678_901, classIndex: 0, coords: [0, 0, 1, 1] }])
    expect(b.wayIds).toBeInstanceOf(Float64Array)
    expect(b.wayIds[0]).toBe(12_345_678_901)
  })

  it('stores class indices per way', () => {
    const b = packSnapshot(WAYS)
    expect(Array.from(b.classes)).toEqual([3, 6])
  })

  it('handles an empty way list', () => {
    const b = packSnapshot([])
    expect(b.positions.length).toBe(0)
    expect(Array.from(b.startIndices)).toEqual([0])
  })
})

describe('validateSnapshot', () => {
  it('accepts a matching manifest', () => {
    const b = packSnapshot(WAYS)
    expect(() => validateSnapshot(manifestFor(b), b)).not.toThrow()
  })

  it('rejects a version mismatch', () => {
    const b = packSnapshot(WAYS)
    const m = { ...manifestFor(b), version: SNAPSHOT_VERSION + 1 }
    expect(() => validateSnapshot(m, b)).toThrow(SnapshotError)
    try {
      validateSnapshot(m, b)
    } catch (e) {
      expect((e as SnapshotError).code).toBe('VERSION_MISMATCH')
    }
  })

  it('rejects a truncated positions buffer', () => {
    const b = packSnapshot(WAYS)
    const m = manifestFor(b)
    const truncated = { ...b, positions: b.positions.slice(0, 4) }
    try {
      validateSnapshot(m, truncated)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SnapshotError).code).toBe('TRUNCATED')
    }
  })

  it('rejects a startIndices terminator that disagrees with positionCount', () => {
    const b = packSnapshot(WAYS)
    const m = { ...manifestFor(b), positionCount: 99 }
    try {
      validateSnapshot(m, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SnapshotError).code).toBe('MISALIGNED')
    }
  })

  it('rejects a wayCount that disagrees with the buffers', () => {
    const b = packSnapshot(WAYS)
    const m = { ...manifestFor(b), wayCount: 7 }
    try {
      validateSnapshot(m, b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SnapshotError).code).toBe('MISALIGNED')
    }
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/network/snapshot.test.ts`
Expected: FAIL — cannot resolve `./snapshot`.

- [ ] **Step 3: Implement `src/network/snapshot.ts`**

Note the explicit field assignment in `SnapshotError`; constructor parameter properties are banned by the erasable-syntax constraint.

```ts
import type { Bbox } from '../geo/bounds'
import type { NormalizedWay } from './normalize'
import type { OsmKind, RegionGroup } from './regions'

/** Bump when the buffer layout changes. Invalidates snapshots on disk. */
export const SNAPSHOT_VERSION = 1

export type SnapshotBuffers = {
  /** Flat [lon, lat, ...] Float64. Shared nodes are duplicated per way. */
  positions: Float64Array
  /** wayCount + 1 vertex offsets; last entry is the total vertex count. */
  startIndices: Uint32Array
  wayIds: Float64Array
  classes: Uint8Array
}

export type SnapshotManifest = {
  version: number
  regionId: string
  regionName: string
  group: RegionGroup
  osmId: number
  osmKind: OsmKind
  generatedAt: string
  /** Overpass `timestamp_osm_base` — pins the denominator to an OSM instant. */
  osmTimestamp: string
  queryHash: string
  bbox: Bbox
  wayCount: number
  /** Vertex count including duplicated shared nodes. */
  positionCount: number
  /** Distinct OSM nodes referenced; always <= positionCount. */
  uniqueNodeCount: number
  totalMeters: number
  classes: string[]
  byteLengths: {
    positions: number
    startIndices: number
    wayIds: number
    classes: number
  }
}

export type SnapshotErrorCode = 'VERSION_MISMATCH' | 'TRUNCATED' | 'MISALIGNED'

export class SnapshotError extends Error {
  code: SnapshotErrorCode

  constructor(code: SnapshotErrorCode, message: string) {
    super(message)
    this.name = 'SnapshotError'
    this.code = code
  }
}

export function packSnapshot(ways: NormalizedWay[]): SnapshotBuffers {
  const wayCount = ways.length

  let vertexCount = 0
  for (const w of ways) vertexCount += w.coords.length / 2

  const positions = new Float64Array(vertexCount * 2)
  const startIndices = new Uint32Array(wayCount + 1)
  const wayIds = new Float64Array(wayCount)
  const classes = new Uint8Array(wayCount)

  let vertex = 0
  for (let i = 0; i < wayCount; i++) {
    const w = ways[i]
    startIndices[i] = vertex
    positions.set(w.coords, vertex * 2)
    vertex += w.coords.length / 2
    wayIds[i] = w.id
    classes[i] = w.classIndex
  }
  startIndices[wayCount] = vertex

  return { positions, startIndices, wayIds, classes }
}

/** Coordinates of one way, as a plain array. Test and debug helper. */
export function wayCoords(buffers: SnapshotBuffers, wayIndex: number): number[] {
  const start = buffers.startIndices[wayIndex]
  const end = buffers.startIndices[wayIndex + 1]
  return Array.from(buffers.positions.subarray(start * 2, end * 2))
}

export function validateSnapshot(
  manifest: SnapshotManifest,
  buffers: SnapshotBuffers,
): void {
  if (manifest.version !== SNAPSHOT_VERSION) {
    throw new SnapshotError(
      'VERSION_MISMATCH',
      `Snapshot version ${manifest.version} does not match expected ${SNAPSHOT_VERSION}. Re-run build:snapshot.`,
    )
  }

  const expected = manifest.byteLengths
  const actual = {
    positions: buffers.positions.byteLength,
    startIndices: buffers.startIndices.byteLength,
    wayIds: buffers.wayIds.byteLength,
    classes: buffers.classes.byteLength,
  }
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (actual[key] !== expected[key]) {
      throw new SnapshotError(
        'TRUNCATED',
        `Buffer "${key}" is ${actual[key]} bytes, manifest declares ${expected[key]}.`,
      )
    }
  }

  if (buffers.startIndices.length !== manifest.wayCount + 1) {
    throw new SnapshotError(
      'MISALIGNED',
      `startIndices has ${buffers.startIndices.length} entries, expected wayCount + 1 = ${manifest.wayCount + 1}.`,
    )
  }

  const terminator = buffers.startIndices[manifest.wayCount]
  if (terminator !== manifest.positionCount) {
    throw new SnapshotError(
      'MISALIGNED',
      `startIndices terminator is ${terminator}, manifest declares positionCount ${manifest.positionCount}.`,
    )
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/network/snapshot.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(network): versioned binary snapshot pack, unpack, and validation"
```

---

## Task 6: Resilient Overpass client

**Files:**
- Create: `scripts/overpass.ts`
- Test: `scripts/overpass.test.ts`

**Interfaces:**
- Consumes: `Region`, `buildOverpassQuery` from `../src/network/regions`
- Produces:
  - `const OVERPASS_MIRRORS: readonly string[]`
  - `class OverpassError extends Error` with `.code`
  - `type OverpassResponse = { elements: OsmElement[]; osm3s?: { timestamp_osm_base?: string } }`
  - `parseOverpassBody(body: string): OverpassResponse`
  - `fetchRegion(region, opts): Promise<OverpassResponse>` where `opts = { fetchImpl?, mirrors?, maxAttempts?, sleepMs? }`

- [ ] **Step 1: Write the failing test**

Create `scripts/overpass.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { regionById } from '../src/network/regions'
import {
  OVERPASS_MIRRORS,
  OverpassError,
  fetchRegion,
  parseOverpassBody,
} from './overpass'

// Captured from overpass-api.de on 2026-07-27. Note: HTTP 200.
const DISPATCHER_TIMEOUT_HTML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "...">
<html><body>
<p><strong style="color:#FF0000">Error</strong>: runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request. </p>
</body></html>`

const VALID_BODY = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-07-27T12:00:00Z' },
  elements: [
    { type: 'node', id: 1, lon: -105, lat: 39.6 },
    { type: 'node', id: 2, lon: -104.9, lat: 39.7 },
    { type: 'way', id: 100, nodes: [1, 2], tags: { highway: 'residential' } },
  ],
})

// What overpass.osm.ch returns for a Colorado query: valid, parseable, empty.
const EMPTY_BODY = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-07-27T12:00:00Z' },
  elements: [],
})

function jsonResponse(body: string, status = 200) {
  return { ok: status < 400, status, text: async () => body }
}

describe('OVERPASS_MIRRORS', () => {
  it('excludes the Switzerland-only mirror', () => {
    // overpass.osm.ch answers fast but holds only Switzerland, returning a
    // clean empty result for Colorado rather than an error.
    expect(OVERPASS_MIRRORS.join(' ')).not.toContain('osm.ch')
  })

  it('lists more than one mirror', () => {
    expect(OVERPASS_MIRRORS.length).toBeGreaterThan(1)
  })
})

describe('parseOverpassBody', () => {
  it('parses a valid response', () => {
    const r = parseOverpassBody(VALID_BODY)
    expect(r.elements).toHaveLength(3)
    expect(r.osm3s?.timestamp_osm_base).toBe('2026-07-27T12:00:00Z')
  })

  it('rejects an HTML error body delivered with HTTP 200', () => {
    try {
      parseOverpassBody(DISPATCHER_TIMEOUT_HTML)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('HTML_ERROR')
    }
  })

  it('rejects unparseable JSON', () => {
    try {
      parseOverpassBody('{not json')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('BAD_JSON')
    }
  })

  it('rejects JSON with no elements array', () => {
    try {
      parseOverpassBody('{"version":0.6}')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('BAD_SHAPE')
    }
  })

  it('rejects a response containing zero ways', () => {
    // The broken area-id form returned exactly this. Treating it as an empty
    // region would have written a valid-looking, entirely wrong snapshot.
    try {
      parseOverpassBody(EMPTY_BODY)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('EMPTY_RESULT')
    }
  })
})

describe('fetchRegion', () => {
  const region = regionById('littleton')!
  const opts = { mirrors: ['https://a.test', 'https://b.test'], sleepMs: 0 }

  it('returns the parsed body on first success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_BODY))
    const r = await fetchRegion(region, { ...opts, fetchImpl })
    expect(r.elements).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rotates to the next mirror after an HTML error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(DISPATCHER_TIMEOUT_HTML))
      .mockResolvedValueOnce(jsonResponse(VALID_BODY))

    const r = await fetchRegion(region, { ...opts, fetchImpl })
    expect(r.elements).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://a.test')
    expect(fetchImpl.mock.calls[1][0]).toBe('https://b.test')
  })

  it('retries after a thrown network error', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(VALID_BODY))
    const r = await fetchRegion(region, { ...opts, fetchImpl })
    expect(r.elements).toHaveLength(3)
  })

  it('gives up after maxAttempts and reports the last cause', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(DISPATCHER_TIMEOUT_HTML))
    await expect(
      fetchRegion(region, { ...opts, fetchImpl, maxAttempts: 3 }),
    ).rejects.toThrow(/littleton/i)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('posts the region query as the request body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_BODY))
    await fetchRegion(region, { ...opts, fetchImpl })
    const init = fetchImpl.mock.calls[0][1] as { body: string; method: string }
    expect(init.method).toBe('POST')
    expect(init.body).toContain('rel(112959);map_to_area->.r;')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run scripts/overpass.test.ts`
Expected: FAIL — cannot resolve `./overpass`.

- [ ] **Step 3: Implement `scripts/overpass.ts`**

```ts
import type { OsmElement } from '../src/network/normalize'
import { buildOverpassQuery, type Region } from '../src/network/regions'

/**
 * Deliberately excludes overpass.osm.ch: it responds quickly but holds only
 * Switzerland, returning a clean, parseable, empty result for Colorado.
 */
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const

export type OverpassErrorCode =
  | 'HTML_ERROR'
  | 'BAD_JSON'
  | 'BAD_SHAPE'
  | 'EMPTY_RESULT'
  | 'HTTP_ERROR'
  | 'EXHAUSTED'

export class OverpassError extends Error {
  code: OverpassErrorCode

  constructor(code: OverpassErrorCode, message: string) {
    super(message)
    this.name = 'OverpassError'
    this.code = code
  }
}

export type OverpassResponse = {
  elements: OsmElement[]
  osm3s?: { timestamp_osm_base?: string }
}

/**
 * Overpass signals overload with an HTML body under HTTP 200, so status codes
 * alone are not enough. A zero-way result is also treated as failure: every
 * region in the registry is known to contain streets, so an empty response
 * means the query or the area resolution is wrong, not that the town is empty.
 */
export function parseOverpassBody(body: string): OverpassResponse {
  if (body.trimStart().startsWith('<')) {
    throw new OverpassError(
      'HTML_ERROR',
      `Overpass returned an HTML error body: ${body.slice(0, 200)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new OverpassError('BAD_JSON', `Response was not valid JSON: ${body.slice(0, 200)}`)
  }

  const candidate = parsed as Partial<OverpassResponse>
  if (!Array.isArray(candidate.elements)) {
    throw new OverpassError('BAD_SHAPE', 'Response has no "elements" array.')
  }

  const wayCount = candidate.elements.filter((e) => e.type === 'way').length
  if (wayCount === 0) {
    throw new OverpassError(
      'EMPTY_RESULT',
      'Response contained zero ways. The area probably failed to resolve.',
    )
  }

  return candidate as OverpassResponse
}

type FetchLike = (
  url: string,
  init: { method: string; body: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export type FetchRegionOptions = {
  fetchImpl?: FetchLike
  mirrors?: readonly string[]
  maxAttempts?: number
  sleepMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchRegion(
  region: Region,
  options: FetchRegionOptions = {},
): Promise<OverpassResponse> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const mirrors = options.mirrors ?? OVERPASS_MIRRORS
  const maxAttempts = options.maxAttempts ?? 9
  const baseSleep = options.sleepMs ?? 8000

  const query = buildOverpassQuery(region)
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = mirrors[attempt % mirrors.length]
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        body: query,
        headers: { 'User-Agent': 'street-coverage/0.1 (github.com/nbeekman)' },
      })
      if (!res.ok) {
        throw new OverpassError('HTTP_ERROR', `${url} returned HTTP ${res.status}`)
      }
      return parseOverpassBody(await res.text())
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts - 1 && baseSleep > 0) {
        // Backoff caps at 60s; mirrors recover on the order of minutes.
        await sleep(Math.min(baseSleep * 2 ** Math.floor(attempt / mirrors.length), 60_000))
      }
    }
  }

  throw new OverpassError(
    'EXHAUSTED',
    `All ${maxAttempts} attempts failed for region "${region.id}". Last error: ${String(lastError)}`,
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run scripts/overpass.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scripts): Overpass client with mirror rotation and HTML-error detection"
```

---

## Task 7: Fetch CLI

**Files:**
- Create: `scripts/fetch-network.ts`

**Interfaces:**
- Consumes: `fetchRegion` from `./overpass`; `REGIONS`, `regionById`, `regionsInGroup`, `buildOverpassQuery` from `../src/network/regions`
- Produces: `data/raw/<regionId>.json` files shaped `{ regionId, fetchedAt, osmTimestamp, queryHash, query, elements }`

- [ ] **Step 1: Implement `scripts/fetch-network.ts`**

```ts
import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchRegion } from './overpass'
import {
  REGIONS,
  buildOverpassQuery,
  regionById,
  regionsInGroup,
  type Region,
  type RegionGroup,
} from '../src/network/regions'

const RAW_DIR = join(process.cwd(), 'data', 'raw')

type Args = { regions: Region[]; force: boolean }

function parseArgs(argv: string[]): Args {
  const force = argv.includes('--force')
  const regions: Region[] = []

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--region') {
      const region = regionById(argv[i + 1])
      if (!region) throw new Error(`Unknown region "${argv[i + 1]}"`)
      regions.push(region)
    }
    if (argv[i] === '--group') {
      const group = argv[i + 1] as RegionGroup
      const found = regionsInGroup(group)
      if (found.length === 0) throw new Error(`No regions in group "${group}"`)
      regions.push(...found)
    }
    if (argv[i] === '--all') regions.push(...REGIONS)
  }

  if (regions.length === 0) {
    throw new Error(
      'Specify --region <id>, --group <metro-core|metro-outer|mountain|route>, or --all',
    )
  }
  return { regions, force }
}

async function alreadyFetched(): Promise<Set<string>> {
  try {
    const files = await readdir(RAW_DIR)
    return new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)))
  } catch {
    return new Set()
  }
}

async function main(): Promise<void> {
  const { regions, force } = parseArgs(process.argv.slice(2))
  await mkdir(RAW_DIR, { recursive: true })
  const done = await alreadyFetched()

  let fetched = 0
  let skipped = 0
  const failures: string[] = []

  for (const region of regions) {
    if (!force && done.has(region.id)) {
      console.log(`skip     ${region.id} (already fetched; use --force to refetch)`)
      skipped++
      continue
    }

    const started = Date.now()
    try {
      const response = await fetchRegion(region)
      const query = buildOverpassQuery(region)
      const payload = {
        regionId: region.id,
        fetchedAt: new Date().toISOString(),
        osmTimestamp: response.osm3s?.timestamp_osm_base ?? 'unknown',
        queryHash: createHash('sha256').update(query).digest('hex').slice(0, 16),
        query,
        elements: response.elements,
      }
      // Write per region as it lands so a run that dies at region 6 does not
      // restart from region 1.
      await writeFile(join(RAW_DIR, `${region.id}.json`), JSON.stringify(payload))

      const ways = response.elements.filter((e) => e.type === 'way').length
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`ok       ${region.id} — ${ways} ways in ${secs}s`)
      fetched++
    } catch (error) {
      console.error(`FAILED   ${region.id} — ${String(error)}`)
      failures.push(region.id)
    }
  }

  console.log(`\nfetched ${fetched}, skipped ${skipped}, failed ${failures.length}`)
  if (failures.length > 0) {
    console.error(`Re-run for: ${failures.map((id) => `--region ${id}`).join(' ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 2: Verify the CLI argument handling without touching the network**

Run: `npm run fetch:network`
Expected: exits non-zero printing `Specify --region <id>, --group ...`.

Run: `npm run fetch:network -- --region nope`
Expected: exits non-zero printing `Unknown region "nope"`.

- [ ] **Step 3: Fetch one small region for real**

Run: `npm run fetch:network -- --region sheridan`
Expected: `ok       sheridan — 304 ways in Ns` (the count may drift by a few — OSM changes). Creates `data/raw/sheridan.json`.

Run it a second time. Expected: `skip     sheridan (already fetched; use --force to refetch)`.

- [ ] **Step 4: Confirm the raw file is gitignored**

Run: `git status --short`
Expected: `data/raw/sheridan.json` does NOT appear.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scripts): resumable per-region Overpass fetch CLI"
```

---

## Task 8: Snapshot build CLI

**Files:**
- Create: `scripts/build-snapshot.ts`

**Interfaces:**
- Consumes: `normalize` from `../src/network/normalize`; `packSnapshot`, `validateSnapshot`, `SNAPSHOT_VERSION`, `SnapshotManifest` from `../src/network/snapshot`; `bboxOf` from `../src/geo/bounds`; `pathLengthMeters` from `../src/geo/haversine`; `HIGHWAY_CLASSES`, `regionById` from `../src/network/regions`
- Produces: `public/network/<regionId>/{manifest.json,positions.bin,startIndices.bin,wayIds.bin,classes.bin}` and `public/network/index.json`

- [ ] **Step 1: Implement `scripts/build-snapshot.ts`**

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bboxOf } from '../src/geo/bounds'
import { pathLengthMeters } from '../src/geo/haversine'
import { normalize, type OsmElement } from '../src/network/normalize'
import { HIGHWAY_CLASSES, regionById } from '../src/network/regions'
import {
  SNAPSHOT_VERSION,
  packSnapshot,
  validateSnapshot,
  type SnapshotManifest,
} from '../src/network/snapshot'

const RAW_DIR = join(process.cwd(), 'data', 'raw')
const OUT_DIR = join(process.cwd(), 'public', 'network')

type RawPayload = {
  regionId: string
  fetchedAt: string
  osmTimestamp: string
  queryHash: string
  elements: OsmElement[]
}

type IndexEntry = {
  id: string
  name: string
  group: string
  wayCount: number
  positionCount: number
  totalMeters: number
  bytes: number
}

async function buildRegion(rawFile: string): Promise<IndexEntry> {
  const raw = JSON.parse(await readFile(join(RAW_DIR, rawFile), 'utf8')) as RawPayload
  const region = regionById(raw.regionId)
  if (!region) throw new Error(`Raw file references unknown region "${raw.regionId}"`)

  const network = normalize(raw.elements)
  if (network.ways.length === 0) {
    throw new Error(`Region "${region.id}" normalized to zero ways`)
  }

  const buffers = packSnapshot(network.ways)

  let totalMeters = 0
  for (let i = 0; i < network.ways.length; i++) {
    totalMeters += pathLengthMeters(
      buffers.positions,
      buffers.startIndices[i],
      buffers.startIndices[i + 1],
    )
  }

  const manifest: SnapshotManifest = {
    version: SNAPSHOT_VERSION,
    regionId: region.id,
    regionName: region.name,
    group: region.group,
    osmId: region.osmId,
    osmKind: region.osmKind,
    generatedAt: new Date().toISOString(),
    osmTimestamp: raw.osmTimestamp,
    queryHash: raw.queryHash,
    bbox: bboxOf(buffers.positions),
    wayCount: network.ways.length,
    positionCount: buffers.startIndices[network.ways.length],
    uniqueNodeCount: network.uniqueNodeCount,
    totalMeters,
    classes: [...HIGHWAY_CLASSES],
    byteLengths: {
      positions: buffers.positions.byteLength,
      startIndices: buffers.startIndices.byteLength,
      wayIds: buffers.wayIds.byteLength,
      classes: buffers.classes.byteLength,
    },
  }

  // Catch a bad build here rather than in the browser.
  validateSnapshot(manifest, buffers)

  const dir = join(OUT_DIR, region.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(dir, 'positions.bin'), Buffer.from(buffers.positions.buffer))
  await writeFile(join(dir, 'startIndices.bin'), Buffer.from(buffers.startIndices.buffer))
  await writeFile(join(dir, 'wayIds.bin'), Buffer.from(buffers.wayIds.buffer))
  await writeFile(join(dir, 'classes.bin'), Buffer.from(buffers.classes.buffer))

  const bytes =
    manifest.byteLengths.positions +
    manifest.byteLengths.startIndices +
    manifest.byteLengths.wayIds +
    manifest.byteLengths.classes

  const km = (totalMeters / 1000).toFixed(0)
  const mb = (bytes / 1e6).toFixed(2)
  console.log(
    `ok  ${region.id.padEnd(18)} ways=${String(network.ways.length).padEnd(6)} ` +
      `verts=${String(manifest.positionCount).padEnd(7)} uniq=${String(network.uniqueNodeCount).padEnd(7)} ` +
      `dropped=${String(network.droppedWays).padEnd(5)} ${km}km ${mb}MB`,
  )

  return {
    id: region.id,
    name: region.name,
    group: region.group,
    wayCount: network.ways.length,
    positionCount: manifest.positionCount,
    totalMeters,
    bytes,
  }
}

async function main(): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    throw new Error(`No raw data at ${RAW_DIR}. Run "npm run fetch:network -- --group metro-core" first.`)
  }
  if (files.length === 0) {
    throw new Error(`No raw data at ${RAW_DIR}. Run "npm run fetch:network -- --group metro-core" first.`)
  }

  await mkdir(OUT_DIR, { recursive: true })
  const entries: IndexEntry[] = []
  for (const file of files) entries.push(await buildRegion(file))

  entries.sort((a, b) => b.wayCount - a.wayCount)
  await writeFile(
    join(OUT_DIR, 'index.json'),
    JSON.stringify({ version: SNAPSHOT_VERSION, generatedAt: new Date().toISOString(), regions: entries }, null, 2),
  )

  const totalWays = entries.reduce((s, e) => s + e.wayCount, 0)
  const totalVerts = entries.reduce((s, e) => s + e.positionCount, 0)
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0)
  const totalKm = entries.reduce((s, e) => s + e.totalMeters, 0) / 1000

  console.log(
    `\n${entries.length} regions — ${totalWays} ways, ${totalVerts} vertices, ` +
      `${totalKm.toFixed(0)} km, ${(totalBytes / 1e6).toFixed(2)} MB`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 2: Build the one region already fetched**

Run: `npm run build:snapshot`
Expected: one `ok  sheridan ...` line, then a summary. Creates `public/network/sheridan/` with five files and `public/network/index.json`.

- [ ] **Step 3: Sanity-check the output by hand**

Run:

`package.json` sets `"type": "module"`, so `require` is unavailable — use `--input-type=module`:

```bash
node --input-type=module -e "
import { readFileSync, statSync } from 'node:fs'
const m = JSON.parse(readFileSync('./public/network/sheridan/manifest.json', 'utf8'))
const pos = statSync('./public/network/sheridan/positions.bin').size
console.log('manifest positions bytes:', m.byteLengths.positions, 'file bytes:', pos)
console.log('positionCount:', m.positionCount, 'uniqueNodeCount:', m.uniqueNodeCount)
console.log('duplication ratio:', (m.positionCount / m.uniqueNodeCount).toFixed(2))
console.log('bbox:', m.bbox)
"
```

Expected: manifest bytes equal file bytes. `positionCount > uniqueNodeCount` — this is the duplication the spec predicted; record the ratio. bbox longitudes near −105, latitudes near 39.6.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(scripts): build versioned binary snapshots from raw Overpass data"
```

---

## Task 9: Run the full pipeline and commit the snapshots

**Files:**
- Create: `public/network/<10 regions>/*`, `public/network/index.json`
- Create: `docs/measurements.md`

**Interfaces:**
- Consumes: both CLIs from Tasks 7 and 8
- Produces: the committed dataset every client task renders

- [ ] **Step 1: Fetch all ten metro-core regions**

Run: `npm run fetch:network -- --group metro-core`

Expect this to take a while and to partially fail — during design, 6 of 10 probe queries failed. Denver is the big one (~23k ways). If any region fails, re-run the printed command; already-fetched regions are skipped automatically.

Expected end state: `data/raw/` holds ten JSON files.

- [ ] **Step 2: Build all snapshots**

Run: `npm run build:snapshot`
Expected: ten `ok` lines and a summary near 45,000 ways.

- [ ] **Step 3: Verify against the spec's predictions**

Compare the summary to the spec's estimate of ~45,020 ways / 310,723 unique nodes and 400k–470k vertices at 6.5–7.5 MB.

If total bytes exceed ~12 MB, stop and reconsider before committing — options are Float32 offsets on disk (losing coverage precision), gzip at rest, or dropping a region. Record whichever way it lands.

- [ ] **Step 4: Record the real numbers**

Create `docs/measurements.md`:

```markdown
# Measurements

Baseline numbers for the M7 performance write-up. Update whenever the
snapshot is rebuilt; note the snapshot version and OSM timestamp.

## M1 — snapshot build

| Region | Ways | Vertices | Unique nodes | km | MB |
|---|---:|---:|---:|---:|---:|
| _fill from `npm run build:snapshot` output_ | | | | | |

**Totals:** _ways_ / _vertices_ / _MB_

**Vertex duplication ratio:** _positionCount ÷ uniqueNodeCount_ — the spec
predicted 1.3–1.5x from shared intersection nodes.

## M1 — client render

| Metric | Value |
|---|---|
| Snapshot fetch + decode (ms) | |
| Steady-state FPS, full metro core | |
| FPS while panning | |
| Browser / GPU | |
```

- [ ] **Step 5: Commit the dataset**

```bash
git add public/network docs/measurements.md
git commit -m "data: metro-core network snapshots (10 regions)"
```

Confirm with `git status --short` that no `data/raw/` file was staged.

---

## Task 10: Load snapshots in the browser

**Files:**
- Create: `src/network/loadSnapshot.ts`, `src/network/useNetwork.ts`
- Test: `src/network/loadSnapshot.test.ts`

**Interfaces:**
- Consumes: `SnapshotManifest`, `SnapshotBuffers`, `validateSnapshot`, `SnapshotError` from `./snapshot`; `bboxOf`, `centerOf`, `toLngLatOffsets` from `../geo/bounds`
- Produces:
  - `type LoadedRegion = { id: string; name: string; group: string; manifest: SnapshotManifest; buffers: SnapshotBuffers; origin: [number, number]; offsets: Float32Array }`
  - `loadRegion(id: string, fetchImpl?): Promise<LoadedRegion>`
  - `type NetworkState = { status: 'loading' | 'ready' | 'error'; regions: LoadedRegion[]; error?: string; decodeMs: number }`
  - `useNetwork(): NetworkState`

- [ ] **Step 1: Write the failing test**

Create `src/network/loadSnapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadRegion } from './loadSnapshot'
import { SNAPSHOT_VERSION, packSnapshot } from './snapshot'

const WAYS = [
  { id: 100, classIndex: 3, coords: [-105.01, 39.6, -104.99, 39.61] },
  { id: 101, classIndex: 6, coords: [-104.99, 39.61, -104.97, 39.63] },
]

function fixture() {
  const b = packSnapshot(WAYS)
  const manifest = {
    version: SNAPSHOT_VERSION,
    regionId: 'test',
    regionName: 'Test',
    group: 'metro-core',
    osmId: 1,
    osmKind: 'relation',
    generatedAt: '2026-07-27T00:00:00.000Z',
    osmTimestamp: '2026-07-27T00:00:00Z',
    queryHash: 'abc123',
    bbox: { minLon: -105.01, minLat: 39.6, maxLon: -104.97, maxLat: 39.63 },
    wayCount: 2,
    positionCount: 4,
    uniqueNodeCount: 3,
    totalMeters: 100,
    classes: ['primary'],
    byteLengths: {
      positions: b.positions.byteLength,
      startIndices: b.startIndices.byteLength,
      wayIds: b.wayIds.byteLength,
      classes: b.classes.byteLength,
    },
  }
  return { manifest, buffers: b }
}

function fetchFor(manifest: unknown, b: ReturnType<typeof packSnapshot>) {
  return async (url: string) => {
    const body =
      url.endsWith('manifest.json') ? JSON.stringify(manifest)
      : url.endsWith('positions.bin') ? b.positions.buffer
      : url.endsWith('startIndices.bin') ? b.startIndices.buffer
      : url.endsWith('wayIds.bin') ? b.wayIds.buffer
      : b.classes.buffer
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(body as string),
      arrayBuffer: async () => body as ArrayBuffer,
    }
  }
}

describe('loadRegion', () => {
  it('decodes buffers and computes a render origin', async () => {
    const { manifest, buffers } = fixture()
    const region = await loadRegion('test', fetchFor(manifest, buffers) as never)

    expect(region.manifest.wayCount).toBe(2)
    expect(region.buffers.positions.length).toBe(8)
    // Origin is the bbox center, so offsets stay small.
    expect(region.origin[0]).toBeCloseTo(-104.99, 5)
    expect(region.offsets).toBeInstanceOf(Float32Array)
    expect(Math.abs(region.offsets[0])).toBeLessThan(0.1)
  })

  it('surfaces a version mismatch as a SnapshotError', async () => {
    const { manifest, buffers } = fixture()
    const bad = { ...manifest, version: SNAPSHOT_VERSION + 1 }
    await expect(
      loadRegion('test', fetchFor(bad, buffers) as never),
    ).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
  })

  it('surfaces an HTTP failure with the region id', async () => {
    const failing = async () => ({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })
    await expect(loadRegion('test', failing as never)).rejects.toThrow(/test/)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/network/loadSnapshot.test.ts`
Expected: FAIL — cannot resolve `./loadSnapshot`.

- [ ] **Step 3: Implement `src/network/loadSnapshot.ts`**

```ts
import { bboxOf, centerOf, toLngLatOffsets } from '../geo/bounds'
import {
  validateSnapshot,
  type SnapshotBuffers,
  type SnapshotManifest,
} from './snapshot'

export type LoadedRegion = {
  id: string
  name: string
  group: string
  manifest: SnapshotManifest
  buffers: SnapshotBuffers
  /** Render origin for LNGLAT_OFFSETS; the region bbox center. */
  origin: [number, number]
  /** Float32 lng/lat offsets from `origin`, ready for the GPU. */
  offsets: Float32Array
}

type FetchLike = typeof globalThis.fetch

async function getBuffer(
  fetchImpl: FetchLike,
  url: string,
  regionId: string,
): Promise<ArrayBuffer> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Region "${regionId}": ${url} returned HTTP ${res.status}`)
  }
  return res.arrayBuffer()
}

export async function loadRegion(
  id: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<LoadedRegion> {
  const base = `network/${id}`

  const manifestRes = await fetchImpl(`${base}/manifest.json`)
  if (!manifestRes.ok) {
    throw new Error(`Region "${id}": manifest returned HTTP ${manifestRes.status}`)
  }
  const manifest = (await manifestRes.json()) as SnapshotManifest

  const [pos, starts, ids, classes] = await Promise.all([
    getBuffer(fetchImpl, `${base}/positions.bin`, id),
    getBuffer(fetchImpl, `${base}/startIndices.bin`, id),
    getBuffer(fetchImpl, `${base}/wayIds.bin`, id),
    getBuffer(fetchImpl, `${base}/classes.bin`, id),
  ])

  const buffers: SnapshotBuffers = {
    positions: new Float64Array(pos),
    startIndices: new Uint32Array(starts),
    wayIds: new Float64Array(ids),
    classes: new Uint8Array(classes),
  }

  // Throws SnapshotError with a specific code on version or size mismatch.
  validateSnapshot(manifest, buffers)

  const origin = centerOf(bboxOf(buffers.positions))
  const offsets = toLngLatOffsets(buffers.positions, origin)

  return {
    id,
    name: manifest.regionName,
    group: manifest.group,
    manifest,
    buffers,
    origin,
    offsets,
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/network/loadSnapshot.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Implement `src/network/useNetwork.ts`**

```ts
import { useEffect, useState } from 'react'
import { loadRegion, type LoadedRegion } from './loadSnapshot'

type IndexFile = {
  version: number
  regions: { id: string; name: string; group: string }[]
}

export type NetworkState = {
  status: 'loading' | 'ready' | 'error'
  regions: LoadedRegion[]
  error?: string
  decodeMs: number
}

export function useNetwork(): NetworkState {
  const [state, setState] = useState<NetworkState>({
    status: 'loading',
    regions: [],
    decodeMs: 0,
  })

  useEffect(() => {
    let cancelled = false
    const started = performance.now()

    async function run() {
      try {
        const res = await fetch('network/index.json')
        if (!res.ok) {
          throw new Error(
            `network/index.json returned HTTP ${res.status}. Run "npm run fetch:network -- --group metro-core" then "npm run build:snapshot".`,
          )
        }
        const index = (await res.json()) as IndexFile
        if (index.regions.length === 0) {
          throw new Error('Snapshot index lists zero regions.')
        }

        const loaded: LoadedRegion[] = []
        // Render regions as they arrive rather than waiting for all ten.
        for (const entry of index.regions) {
          const region = await loadRegion(entry.id)
          if (cancelled) return
          loaded.push(region)
          setState({
            status: 'loading',
            regions: [...loaded],
            decodeMs: Math.round(performance.now() - started),
          })
        }

        if (cancelled) return
        setState({
          status: 'ready',
          regions: loaded,
          decodeMs: Math.round(performance.now() - started),
        })
      } catch (error) {
        if (cancelled) return
        setState({
          status: 'error',
          regions: [],
          error: error instanceof Error ? error.message : String(error),
          decodeMs: Math.round(performance.now() - started),
        })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(network): browser snapshot loading with per-region progress"
```

---

## Task 11: deck.gl network layer

**Files:**
- Create: `src/layers/networkLayer.ts`
- Test: `src/layers/networkLayer.test.ts`

**Interfaces:**
- Consumes: `LoadedRegion` from `../network/loadSnapshot`
- Produces:
  - `const CLASS_COLORS: readonly [number, number, number][]`
  - `createNetworkLayer(region: LoadedRegion): PathLayer`

- [ ] **Step 1: Write the failing test**

Create `src/layers/networkLayer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LoadedRegion } from '../network/loadSnapshot'
import { HIGHWAY_CLASSES } from '../network/regions'
import { CLASS_COLORS, buildLayerProps } from './networkLayer'

// Only the fields buildLayerProps reads; cast through unknown rather than
// constructing a full manifest.
const region = {
  id: 'test',
  name: 'Test',
  group: 'metro-core',
  origin: [-104.99, 39.61] as [number, number],
  offsets: new Float32Array([-0.02, -0.01, 0, 0, 0, 0, 0.02, 0.02]),
  buffers: {
    positions: new Float64Array(8),
    startIndices: new Uint32Array([0, 2, 4]),
    wayIds: new Float64Array([100, 101]),
    classes: new Uint8Array([3, 6]),
  },
  manifest: { wayCount: 2, version: 1 },
} as unknown as LoadedRegion

describe('CLASS_COLORS', () => {
  it('defines one color per highway class', () => {
    expect(CLASS_COLORS).toHaveLength(HIGHWAY_CLASSES.length)
  })

  it('returns a stable reference per class so deck.gl can cache', () => {
    expect(CLASS_COLORS[0]).toBe(CLASS_COLORS[0])
  })
})

describe('buildLayerProps', () => {
  it('feeds deck.gl binary data, not an object array', () => {
    const props = buildLayerProps(region)
    expect(props.data.length).toBe(2)
    expect(props.data.startIndices).toBeInstanceOf(Uint32Array)
    expect(props.data.attributes.getPath.value).toBeInstanceOf(Float32Array)
    expect(props.data.attributes.getPath.size).toBe(2)
  })

  it('renders in offset coordinates anchored at the region origin', () => {
    const props = buildLayerProps(region)
    expect(props.coordinateOrigin).toEqual([-104.99, 39.61])
  })

  it('colors each way by its class index', () => {
    const props = buildLayerProps(region)
    expect(props.getColor(null, { index: 0 })).toBe(CLASS_COLORS[3])
    expect(props.getColor(null, { index: 1 })).toBe(CLASS_COLORS[6])
  })

  it('falls back to a loud color for an out-of-range class index', () => {
    // Magenta is deliberate: a class index the palette does not cover means
    // the snapshot and HIGHWAY_CLASSES have drifted apart, and that should be
    // obvious on screen rather than blending in.
    const broken = {
      ...region,
      buffers: { ...region.buffers, classes: new Uint8Array([99, 99]) },
    }
    const color = buildLayerProps(broken).getColor(null, { index: 0 })
    expect(color).toEqual([255, 0, 255])
  })

  it('gives each region a distinct layer id', () => {
    expect(buildLayerProps(region).id).toBe('network-test')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/layers/networkLayer.test.ts`
Expected: FAIL — cannot resolve `./networkLayer`.

- [ ] **Step 3: Implement `src/layers/networkLayer.ts`**

`buildLayerProps` is separated from `createNetworkLayer` so the props can be tested without instantiating a WebGL layer in Node.

```ts
import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { LoadedRegion } from '../network/loadSnapshot'

export type Rgb = [number, number, number]

/**
 * Index-aligned with HIGHWAY_CLASSES. Warm for arterials, cool for
 * residential, green for cycleways -- readable on the dark basemap and
 * distinct enough to spot a misclassified way at a glance.
 */
export const CLASS_COLORS: readonly Rgb[] = [
  [255, 170, 80],  // primary
  [255, 210, 120], // secondary
  [200, 200, 160], // tertiary
  [120, 150, 190], // residential
  [130, 130, 150], // unclassified
  [170, 140, 200], // living_street
  [110, 220, 150], // cycleway
]

const FALLBACK_COLOR: Rgb = [255, 0, 255]

export function buildLayerProps(region: LoadedRegion) {
  const classes = region.buffers.classes
  return {
    id: `network-${region.id}`,
    data: {
      length: region.manifest.wayCount,
      startIndices: region.buffers.startIndices,
      attributes: {
        getPath: { value: region.offsets, size: 2 },
      },
    },
    _pathType: 'open' as const,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
    coordinateOrigin: region.origin,
    // With binary data deck.gl passes (null, {index, data, target}).
    getColor: (_: unknown, info: { index: number }): Rgb =>
      CLASS_COLORS[classes[info.index]] ?? FALLBACK_COLOR,
    widthUnits: 'pixels' as const,
    getWidth: 1,
    widthMinPixels: 0.75,
    widthMaxPixels: 4,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    // M3 recolors by coverage through this same trigger rather than
    // recreating the layer.
    updateTriggers: { getColor: [region.manifest.version] },
  }
}

export function createNetworkLayer(region: LoadedRegion): PathLayer {
  return new PathLayer(buildLayerProps(region) as never)
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/layers/networkLayer.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(layers): binary-attribute PathLayer for the street network"
```

---

## Task 12: Map view

**Files:**
- Create: `src/components/MapView.tsx`

**Interfaces:**
- Consumes: `createNetworkLayer` from `../layers/networkLayer`; `LoadedRegion` from `../network/loadSnapshot`
- Produces: `<MapView regions={LoadedRegion[]} />`

- [ ] **Step 1: Implement `src/components/MapView.tsx`**

```tsx
import { useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createNetworkLayer } from '../layers/networkLayer'
import type { LoadedRegion } from '../network/loadSnapshot'

/** Free, no-token basemap. Attribution renders from the style itself. */
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** Centered between Littleton and downtown Denver. */
const INITIAL_VIEW_STATE = {
  longitude: -105.0,
  latitude: 39.65,
  zoom: 10.5,
  pitch: 0,
  bearing: 0,
}

type Props = {
  regions: LoadedRegion[]
}

export default function MapView({ regions }: Props) {
  const layers = useMemo(
    () => regions.map((region) => createNetworkLayer(region)),
    [regions],
  )

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Map mapStyle={BASEMAP_STYLE} />
    </DeckGL>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(components): MapLibre basemap with deck.gl overlay"
```

---

## Task 13: Stats panel and app wiring

**Files:**
- Create: `src/components/useFps.ts`, `src/components/StatsPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `NetworkState` from `../network/useNetwork`; `LoadedRegion`
- Produces: `useFps(): number`, `<StatsPanel state={NetworkState} />`, a fully wired `App`

- [ ] **Step 1: Implement `src/components/useFps.ts`**

```ts
import { useEffect, useState } from 'react'

/** Samples frames per second over a rolling one-second window. */
export function useFps(): number {
  const [fps, setFps] = useState(0)

  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let raf = 0

    const tick = () => {
      frames++
      const now = performance.now()
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)))
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return fps
}
```

- [ ] **Step 2: Implement `src/components/StatsPanel.tsx`**

```tsx
import type { NetworkState } from '../network/useNetwork'
import { useFps } from './useFps'

const km = (meters: number) => (meters / 1000).toFixed(0)

export default function StatsPanel({ state }: { state: NetworkState }) {
  const fps = useFps()

  const core = state.regions.filter((r) => r.group === 'metro-core')
  const totalWays = core.reduce((s, r) => s + r.manifest.wayCount, 0)
  const totalMeters = core.reduce((s, r) => s + r.manifest.totalMeters, 0)
  const totalNodes = core.reduce((s, r) => s + r.manifest.uniqueNodeCount, 0)

  // No numerator until M3 computes coverage; the denominator is real today.
  const riddenMeters = 0
  const percent = totalMeters === 0 ? 0 : (riddenMeters / totalMeters) * 100

  return (
    <div className="absolute top-4 left-4 z-10 w-80 rounded-lg bg-black/75 p-4 text-sm backdrop-blur">
      <div className="mb-3">
        <div className="text-4xl font-semibold tabular-nums">
          {percent.toFixed(2)}%
        </div>
        <div className="text-xs text-neutral-400">
          of {km(totalMeters)} km across {core.length} metro-core regions
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="mb-2 text-xs text-amber-300">
          Loading… {state.regions.length} region
          {state.regions.length === 1 ? '' : 's'} decoded
        </div>
      )}

      <table className="w-full text-xs tabular-nums">
        <thead className="text-neutral-400">
          <tr>
            <th className="text-left font-normal">Region</th>
            <th className="text-right font-normal">Ways</th>
            <th className="text-right font-normal">Nodes</th>
            <th className="text-right font-normal">km</th>
          </tr>
        </thead>
        <tbody>
          {state.regions.map((r) => (
            <tr key={r.id} className="border-t border-white/10">
              <td className="py-0.5 text-left">{r.name}</td>
              <td className="text-right">{r.manifest.wayCount.toLocaleString()}</td>
              <td className="text-right">{r.manifest.uniqueNodeCount.toLocaleString()}</td>
              <td className="text-right">{km(r.manifest.totalMeters)}</td>
            </tr>
          ))}
          <tr className="border-t border-white/30 font-semibold">
            <td className="py-0.5 text-left">Total</td>
            <td className="text-right">{totalWays.toLocaleString()}</td>
            <td className="text-right">{totalNodes.toLocaleString()}</td>
            <td className="text-right">{km(totalMeters)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 flex justify-between text-xs text-neutral-500">
        <span>snapshot v{state.regions[0]?.manifest.version ?? '—'}</span>
        <span>{state.decodeMs} ms decode</span>
        <span>{fps} fps</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `src/App.tsx`**

```tsx
import MapView from './components/MapView'
import StatsPanel from './components/StatsPanel'
import { useNetwork } from './network/useNetwork'

export default function App() {
  const state = useNetwork()

  if (state.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-lg border border-red-500/40 bg-red-950/40 p-6">
          <h1 className="mb-2 text-lg font-semibold text-red-200">
            Could not load the network snapshot
          </h1>
          <p className="font-mono text-sm text-red-100/80">{state.error}</p>
        </div>
      </div>
    )
  }

  // A blank map is indistinguishable from being zoomed somewhere empty, so
  // the first paint waits for at least one region.
  if (state.regions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-neutral-400">Loading network…</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <MapView regions={state.regions} />
      <StatsPanel state={state} />
    </div>
  )
}
```

- [ ] **Step 4: Run it**

Run: `npm run dev`, open the printed URL.

Expected: a dark basemap with the metro-core street network drawn over it, arterials warm and residential streets cool. The stats panel shows `0.00%`, ten region rows, and a live FPS readout. Panning and zooming stay smooth.

- [ ] **Step 5: Verify the error path**

Temporarily rename `public/network/index.json`, reload, and confirm the red error panel appears with the actionable message rather than a blank map. Rename it back.

- [ ] **Step 6: Run the full suite and build**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(components): stats panel with headline percentage and diagnostics"
```

---

## Task 14: Record baselines and document

**Files:**
- Modify: `docs/measurements.md`
- Create: `README.md`

**Interfaces:**
- Consumes: the running app
- Produces: the M7 baseline table and project documentation

- [ ] **Step 1: Fill in `docs/measurements.md`**

Record from the running app: decode ms from the stats panel, steady-state FPS, FPS while panning, and browser/GPU. Fill the per-region table from the `npm run build:snapshot` output.

- [ ] **Step 2: Write `README.md`**

```markdown
# Street Coverage

Ride every street in the Denver metro. The map fills in as you do.

M1 renders the network; coverage arrives in M3.

## Setup

```bash
npm install
npm run fetch:network -- --group metro-core   # Overpass -> data/raw (slow, flaky, resumable)
npm run build:snapshot                        # raw -> public/network (committed)
npm run dev
```

Snapshots are committed, so a fresh clone only needs `npm install && npm run dev`.

## How it works

Overpass is contacted only by the offline scripts, never at runtime. Each region
is packed into typed arrays — `positions` (Float64), `startIndices` (Uint32),
`wayIds` (Float64), `classes` (Uint8) — plus a manifest that pins the OSM
timestamp so the coverage denominator stays comparable between snapshots.

The browser feeds those arrays straight to a deck.gl `PathLayer` as binary
attributes. Geometry is stored Float64 for coverage math but uploaded as Float32
offsets from a per-region origin: raw Float32 lng/lat carries ~1.4 m of error at
Denver's longitude, which is unusable next to a 25 m coverage radius.

## Regions

Regions are incorporated places and CDPs, not counties — county boundaries
include mountain and plains roads that will never be ridden, which would make
100% unreachable. Adding one is a single entry in `src/network/regions.ts`
followed by a re-fetch.

## Testing

```bash
npm test
```

Covers `src/geo`, `src/network`, `src/layers`, and the Overpass client. The
React components are deliberately thin and untested in M1.

## Data

Street network © OpenStreetMap contributors, ODbL. Basemap © CARTO.
```

- [ ] **Step 3: Verify the README instructions from a clean state**

Run:

```bash
rm -rf node_modules
npm install
npm test
npm run build
```

Expected: all succeed without re-fetching anything, proving the committed snapshots make the repo self-contained.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: README and M1 baseline measurements"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| MapLibre basemap, no token | 12 |
| Offline fetch → committed snapshot | 7, 8, 9 |
| Binary attributes from day one | 11 |
| Region registry, `map_to_area`, both osmKinds | 3 |
| Ten metro-core regions incl. two way-boundaries | 3, 9 |
| Mirror pool excluding osm.ch, HTML-error detection, zero-way rejection | 6 |
| Resumable per-region fetch, `--force` | 7 |
| Snapshot format + manifest + index.json | 5, 8 |
| Float64 storage, LNGLAT_OFFSETS render | 2, 10, 11 |
| Headline % over metro-core, per-region rows, diagnostics | 13 |
| Named error states, never a blank map | 10, 13 |
| Vitest over geo/, network/, overpass | 2, 3, 4, 5, 6, 10, 11 |
| M7 baseline numbers recorded | 9, 14 |

**Deferred items confirmed absent from this plan:** GPX parsing, coverage computation, PostGIS, neighborhood breakdown, timeline scrubber, route planning, dual-carriageway pairing, node densification, Douglas–Peucker simplification, Web Worker decode.
