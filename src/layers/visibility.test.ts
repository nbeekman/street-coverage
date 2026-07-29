import { describe, expect, it } from 'vitest'
import type { Bbox } from '../geo/bounds.ts'
import {
  NETWORK_MIN_ZOOM,
  padViewport,
  shouldDrawNetwork,
  visibleRegions,
} from './visibility.ts'

type Region = { id: string; bbox: Bbox }
const bboxOf = (r: Region) => r.bbox

const denver: Region = {
  id: 'denver',
  bbox: { minLon: -105.1, minLat: 39.6, maxLon: -104.9, maxLat: 39.8 },
}
const aurora: Region = {
  id: 'aurora',
  bbox: { minLon: -104.89, minLat: 39.55, maxLon: -104.49, maxLat: 39.83 },
}
const summit: Region = {
  id: 'summit',
  bbox: { minLon: -106.2, minLat: 39.4, maxLon: -105.9, maxLat: 39.7 },
}
const ALL = [denver, aurora, summit]

describe('shouldDrawNetwork', () => {
  it('draws at the default city zoom', () => {
    expect(shouldDrawNetwork(10.5)).toBe(true)
  })

  it('stops drawing when zoomed out past the threshold', () => {
    expect(shouldDrawNetwork(8)).toBe(false)
    expect(shouldDrawNetwork(4)).toBe(false)
  })

  it('is inclusive at the threshold, so the boundary is not a flicker', () => {
    expect(shouldDrawNetwork(NETWORK_MIN_ZOOM)).toBe(true)
    expect(shouldDrawNetwork(NETWORK_MIN_ZOOM - 0.01)).toBe(false)
  })

  it('keeps drawing all the way in', () => {
    expect(shouldDrawNetwork(18)).toBe(true)
  })
})

describe('padViewport', () => {
  it('grows the box on every side', () => {
    const v: Bbox = { minLon: -105, minLat: 39, maxLon: -104, maxLat: 40 }
    const p = padViewport(v, 0.1)
    expect(p.minLon).toBeCloseTo(-105.1, 10)
    expect(p.maxLon).toBeCloseTo(-103.9, 10)
    expect(p.minLat).toBeCloseTo(38.9, 10)
    expect(p.maxLat).toBeCloseTo(40.1, 10)
  })
})

describe('visibleRegions', () => {
  it('keeps everything when the viewport is unknown', () => {
    // First paint has no measured bounds; dropping regions there would show
    // an empty map, which is worse than drawing too much.
    expect(visibleRegions(ALL, bboxOf, null)).toHaveLength(3)
  })

  it('keeps only the region under the viewport', () => {
    const view: Bbox = { minLon: -105.05, minLat: 39.65, maxLon: -104.95, maxLat: 39.75 }
    expect(visibleRegions(ALL, bboxOf, view).map((r) => r.id)).toEqual(['denver'])
  })

  it('keeps both when the viewport straddles two regions', () => {
    const view: Bbox = { minLon: -104.95, minLat: 39.65, maxLon: -104.8, maxLat: 39.75 }
    expect(visibleRegions(ALL, bboxOf, view).map((r) => r.id)).toEqual(['denver', 'aurora'])
  })

  it('drops everything when the viewport is somewhere else entirely', () => {
    const view: Bbox = { minLon: -95, minLat: 41, maxLon: -94, maxLat: 42 }
    expect(visibleRegions(ALL, bboxOf, view)).toHaveLength(0)
  })

  it('keeps a region just outside the viewport, thanks to the pad', () => {
    // Denver's bbox ends at -104.9; this viewport starts 0.02 deg east of it,
    // inside the pad. Without padding it would pop in and out while panning.
    const view: Bbox = { minLon: -104.88, minLat: 39.65, maxLon: -104.87, maxLat: 39.7 }
    expect(visibleRegions([denver], bboxOf, view).map((r) => r.id)).toEqual(['denver'])
  })

  it('keeps every region when zoomed out over all of them', () => {
    const view: Bbox = { minLon: -107, minLat: 38, maxLon: -103, maxLat: 41 }
    expect(visibleRegions(ALL, bboxOf, view)).toHaveLength(3)
  })

  it('does not mutate the input', () => {
    const view: Bbox = { minLon: -105.05, minLat: 39.65, maxLon: -104.95, maxLat: 39.75 }
    visibleRegions(ALL, bboxOf, view)
    expect(ALL).toHaveLength(3)
  })
})
