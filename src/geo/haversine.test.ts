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
