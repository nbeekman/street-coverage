import { describe, expect, it } from 'vitest'
import { haversineMeters } from '../geo/haversine.ts'
import type { Bbox } from '../geo/bounds.ts'
import { PointGrid, cellSizeDegrees } from './grid.ts'

const DENVER: Bbox = { minLon: -105.2, minLat: 39.26, maxLon: -104.57, maxLat: 39.77 }

/** The definition the grid must not disagree with. */
function bruteForceWithin(
  points: Float64Array,
  lon: number,
  lat: number,
  radius: number,
): boolean {
  for (let v = 0; v < points.length / 2; v++) {
    if (haversineMeters(lon, lat, points[v * 2], points[v * 2 + 1]) <= radius) return true
  }
  return false
}

describe('cellSizeDegrees', () => {
  it('makes a cell at least the radius tall', () => {
    const { lat } = cellSizeDegrees(25, DENVER)
    const tall = haversineMeters(-105, 39.5, -105, 39.5 + lat)
    expect(tall).toBeGreaterThanOrEqual(25)
  })

  it('makes a cell at least the radius wide everywhere in the bbox', () => {
    const { lon } = cellSizeDegrees(25, DENVER)
    // Widest degree is at the southern edge, narrowest at the northern edge.
    for (const lat of [DENVER.minLat, 39.5, DENVER.maxLat]) {
      const wide = haversineMeters(-105, lat, -105 + lon, lat)
      expect(wide).toBeGreaterThanOrEqual(25)
    }
  })

  it('sizes longitude cells wider than latitude cells away from the equator', () => {
    const { lon, lat } = cellSizeDegrees(25, DENVER)
    expect(lon).toBeGreaterThan(lat)
  })

  it('scales linearly with the radius', () => {
    const small = cellSizeDegrees(25, DENVER)
    const big = cellSizeDegrees(50, DENVER)
    expect(big.lon).toBeCloseTo(small.lon * 2, 12)
    expect(big.lat).toBeCloseTo(small.lat * 2, 12)
  })
})

describe('PointGrid', () => {
  it('finds a point at the query position', () => {
    const grid = new PointGrid(new Float64Array([-105.0, 39.7]), 25, DENVER)
    expect(grid.hasPointWithin(-105.0, 39.7, 25)).toBe(true)
  })

  it('finds a point just inside the radius', () => {
    const points = new Float64Array([-105.0, 39.7])
    const grid = new PointGrid(points, 25, DENVER)
    // ~20 m north.
    const lat = 39.7 + 20 / 110574
    expect(haversineMeters(-105.0, lat, -105.0, 39.7)).toBeLessThan(25)
    expect(grid.hasPointWithin(-105.0, lat, 25)).toBe(true)
  })

  it('rejects a point just outside the radius', () => {
    const points = new Float64Array([-105.0, 39.7])
    const grid = new PointGrid(points, 25, DENVER)
    // ~30 m north.
    const lat = 39.7 + 30 / 110574
    expect(haversineMeters(-105.0, lat, -105.0, 39.7)).toBeGreaterThan(25)
    expect(grid.hasPointWithin(-105.0, lat, 25)).toBe(false)
  })

  it('rejects a point a kilometre away', () => {
    const grid = new PointGrid(new Float64Array([-105.0, 39.7]), 25, DENVER)
    expect(grid.hasPointWithin(-105.0, 39.71, 25)).toBe(false)
  })

  it('handles an empty point set without throwing', () => {
    const grid = new PointGrid(new Float64Array([]), 25, DENVER)
    expect(grid.cellCount).toBe(0)
    expect(grid.hasPointWithin(-105.0, 39.7, 25)).toBe(false)
  })

  it('finds a match that sits in a neighbouring cell', () => {
    // Place a point at a cell boundary so the query and the point land in
    // different cells; only the 3x3 scan can bridge them.
    const { lon } = cellSizeDegrees(25, DENVER)
    const boundary = Math.ceil(-105.0 / lon) * lon
    const points = new Float64Array([boundary - lon * 1e-9, 39.7])
    const grid = new PointGrid(points, 25, DENVER)
    expect(grid.hasPointWithin(boundary + lon * 1e-9, 39.7, 25)).toBe(true)
  })

  it('agrees with brute force on random points -- the test that matters', () => {
    // A deterministic LCG so a failure is reproducible.
    let seed = 20260728
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    const n = 2000
    const points = new Float64Array(n * 2)
    for (let i = 0; i < n; i++) {
      points[i * 2] = DENVER.minLon + rand() * (DENVER.maxLon - DENVER.minLon)
      points[i * 2 + 1] = DENVER.minLat + rand() * (DENVER.maxLat - DENVER.minLat)
    }

    const radius = 25
    const grid = new PointGrid(points, radius, DENVER)

    let hits = 0
    for (let q = 0; q < 3000; q++) {
      // Half the queries sit near a known point so hits actually occur;
      // random queries alone would almost never land within 25 m.
      let lon: number
      let lat: number
      if (q % 2 === 0) {
        const v = Math.floor(rand() * n)
        lon = points[v * 2] + (rand() - 0.5) * 0.0008
        lat = points[v * 2 + 1] + (rand() - 0.5) * 0.0008
      } else {
        lon = DENVER.minLon + rand() * (DENVER.maxLon - DENVER.minLon)
        lat = DENVER.minLat + rand() * (DENVER.maxLat - DENVER.minLat)
      }

      const expected = bruteForceWithin(points, lon, lat, radius)
      if (expected) hits++
      expect(grid.hasPointWithin(lon, lat, radius)).toBe(expected)
    }

    // Guard against a vacuous pass where nothing ever matched.
    expect(hits).toBeGreaterThan(100)
  })
})
