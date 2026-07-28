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
    // 200 points ~= 2224 m. Clipping 500 m from both ends leaves ~1224 m.
    const clipped = clipEnds(line(200), 500)
    expect(clipped.length).toBeGreaterThan(100)
    expect(clipped.length).toBeLessThan(160)
    expect(clipped[0].lat).toBeGreaterThan(39.604)
  })

  it('leaves the middle geometry untouched', () => {
    const original = line(200)
    for (const p of clipEnds(original, 500)) {
      expect(original).toContainEqual(p)
    }
  })

  it('clips a short trace to empty', () => {
    // 20 points ~= 211 m, far less than 2 x 500 m.
    expect(clipEnds(line(20), 500)).toEqual([])
  })

  it('honours zero as opt-out rather than a default', () => {
    expect(clipEnds(line(50), 0)).toHaveLength(50)
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
