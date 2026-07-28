import { describe, expect, it } from 'vitest'
import { haversineMeters } from '../geo/haversine.ts'
import { densifyTrace } from './densify.ts'

/** Largest gap between consecutive points, ignoring ride boundaries. */
function maxGap(points: Float64Array): number {
  let max = 0
  for (let v = 0; v < points.length / 2 - 1; v++) {
    const d = haversineMeters(
      points[v * 2],
      points[v * 2 + 1],
      points[v * 2 + 2],
      points[v * 2 + 3],
    )
    if (d > max) max = d
  }
  return max
}

describe('densifyTrace', () => {
  it('leaves a trace already finer than the gap untouched', () => {
    // Two points ~5.6 m apart.
    const positions = new Float64Array([-105.0, 39.7, -105.0 + 0.0000651, 39.7])
    const out = densifyTrace(positions, new Uint32Array([0, 2]), 10)
    expect(Array.from(out)).toEqual(Array.from(positions))
  })

  it('splits a long gap so nothing exceeds the limit', () => {
    // ~257 m apart, the worst gap seen in the real archive.
    const positions = new Float64Array([-105.0, 39.7, -105.003, 39.7])
    const before = maxGap(positions)
    expect(before).toBeGreaterThan(250)

    const out = densifyTrace(positions, new Uint32Array([0, 2]), 10)
    expect(maxGap(out)).toBeLessThanOrEqual(10)
    expect(out.length).toBeGreaterThan(positions.length)
  })

  it('keeps the original endpoints exactly', () => {
    const positions = new Float64Array([-105.0, 39.7, -105.003, 39.71])
    const out = densifyTrace(positions, new Uint32Array([0, 2]), 10)
    expect(out[0]).toBe(-105.0)
    expect(out[1]).toBe(39.7)
    expect(out[out.length - 2]).toBe(-105.003)
    expect(out[out.length - 1]).toBe(39.71)
  })

  it('places interpolated points on the line between the originals', () => {
    const positions = new Float64Array([-105.0, 39.7, -105.0, 39.702])
    const out = densifyTrace(positions, new Uint32Array([0, 2]), 30)
    for (let v = 0; v < out.length / 2; v++) {
      expect(out[v * 2]).toBeCloseTo(-105.0, 12)
      expect(out[v * 2 + 1]).toBeGreaterThanOrEqual(39.7)
      expect(out[v * 2 + 1]).toBeLessThanOrEqual(39.702)
    }
  })

  it('never interpolates across a ride boundary', () => {
    // Ride A in Denver, ride B in Littleton. A straight line between them
    // would paint phantom coverage across everything in between.
    const positions = new Float64Array([
      -105.0, 39.75, -105.0001, 39.75, // ride A
      -105.02, 39.6, -105.0201, 39.6, // ride B
    ])
    const out = densifyTrace(positions, new Uint32Array([0, 2, 4]), 10)

    // No output point should land in the empty corridor between the rides.
    for (let v = 0; v < out.length / 2; v++) {
      const lat = out[v * 2 + 1]
      expect(lat > 39.62 && lat < 39.73).toBe(false)
    }
  })

  it('handles a single-point ride', () => {
    const out = densifyTrace(new Float64Array([-105.0, 39.7]), new Uint32Array([0, 1]), 10)
    expect(Array.from(out)).toEqual([-105.0, 39.7])
  })

  it('handles an empty trace', () => {
    expect(densifyTrace(new Float64Array([]), new Uint32Array([0]), 10).length).toBe(0)
  })

  it('is a no-op when the gap limit is zero', () => {
    const positions = new Float64Array([-105.0, 39.7, -105.003, 39.7])
    const out = densifyTrace(positions, new Uint32Array([0, 2]), 0)
    expect(Array.from(out)).toEqual(Array.from(positions))
  })

  it('bounds every gap across a multi-ride trace', () => {
    const positions = new Float64Array([
      -105.0, 39.7, -105.001, 39.7, -105.002, 39.7,
      -104.9, 39.6, -104.902, 39.6,
    ])
    const out = densifyTrace(positions, new Uint32Array([0, 3, 5]), 15)

    // Check within each contiguous run rather than across the join.
    let seenLargeJump = 0
    for (let v = 0; v < out.length / 2 - 1; v++) {
      const d = haversineMeters(out[v * 2], out[v * 2 + 1], out[v * 2 + 2], out[v * 2 + 3])
      if (d > 15) seenLargeJump++
    }
    // Exactly one oversized gap: the ride boundary itself.
    expect(seenLargeJump).toBe(1)
  })
})
