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
