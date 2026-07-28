import { describe, expect, it } from 'vitest'
import type { Bbox } from '../geo/bounds'
import type { RawTrack, TrackPoint } from './types'
import { bboxesIntersect, classifyTrack, isInRegion, padBbox, trackBbox } from './filter'

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
    expect(classifyTrack(track(denver, { subSport: 'virtualActivity' }), METRO)).toBe('virtual')
  })

  it('rejects a Zwift ride by manufacturer', () => {
    // Checked independently: a future virtual platform may set only one field.
    expect(classifyTrack(track(denver, { manufacturer: 'zwift' }), METRO)).toBe('virtual')
  })

  it('keeps a ride outside the metro by default', () => {
    // A ride in Iowa is still a ride. It scores no coverage -- there is no
    // network out there to credit -- but the rider wants to see it.
    expect(classifyTrack(track(watopia), METRO)).toBeNull()
  })

  it('rejects a ride outside the metro when requireRegion is set', () => {
    expect(classifyTrack(track(watopia), METRO, { requireRegion: true })).toBe(
      'out-of-region',
    )
  })

  it('still rejects a virtual ride even when out-of-region is allowed', () => {
    // Zwift must never survive on the "keep everything" path.
    expect(classifyTrack(track(watopia, { subSport: 'virtualActivity' }), METRO)).toBe(
      'virtual',
    )
  })

  it('checks virtual before region, so a Watopia Zwift ride reports virtual', () => {
    expect(
      classifyTrack(track(watopia, { subSport: 'virtualActivity' }), METRO, {
        requireRegion: true,
      }),
    ).toBe('virtual')
  })
})

describe('isInRegion', () => {
  it('is true for a Denver ride', () => {
    expect(isInRegion(track(denver), METRO)).toBe(true)
  })

  it('is false for a ride far away', () => {
    expect(isInRegion(track(watopia), METRO)).toBe(false)
  })

  it('is false for a track with no points', () => {
    expect(isInRegion(track([]), METRO)).toBe(false)
  })
})
