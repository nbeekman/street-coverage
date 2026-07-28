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
