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
    // A coffee stop: 300 points inside a few meters. Time-based sampling would
    // keep all 300 and bias M3's matching toward wherever you paused.
    const stopped: TrackPoint[] = Array.from({ length: 300 }, (_, i) => ({
      lon: -105.0 + (i % 3) * 0.00001,
      lat: 39.6,
      t: 1_700_000_000_000 + i * 1000,
    }))
    expect(resampleByDistance(stopped, 10).length).toBeLessThan(10)
  })

  it('keeps the first and last point exactly', () => {
    const pts = line(100)
    const out = resampleByDistance(pts, 25)
    expect(out[0]).toEqual(pts[0])
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
  })

  it('thins a dense straight line toward the requested spacing', () => {
    // 100 points at ~11.1 m = ~1100 m. At 50 m spacing expect ~20-25.
    const out = resampleByDistance(line(100), 50)
    expect(out.length).toBeGreaterThan(15)
    expect(out.length).toBeLessThan(30)
  })

  it('leaves an already-sparse track alone', () => {
    // Points 111 m apart, spacing 50 m: every point survives.
    expect(resampleByDistance(line(10, 0.001), 50)).toHaveLength(10)
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
