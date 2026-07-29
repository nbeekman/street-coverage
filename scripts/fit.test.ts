import { describe, expect, it } from 'vitest'
import { parseFit } from './fit'
import {
  SYNTHETIC_RECORD_COUNT,
  SYNTHETIC_START,
  buildSyntheticFit,
  degreesToSemicircles,
} from '../test/fixtures/syntheticFit.ts'

// Built in memory rather than read from a committed recording. See
// test/fixtures/README.md for why no binary fixture lives in this repo.
const track = parseFit(buildSyntheticFit(), 'synthetic')

describe('parseFit', () => {
  it('extracts every positioned record', () => {
    expect(track.points.length).toBe(SYNTHETIC_RECORD_COUNT)
  })

  it('converts semicircles to real degrees', () => {
    // The fixture writes raw semicircles, which is what FIT actually stores.
    // A parser that skips the conversion yields values like -138818392 --
    // silently wrong rather than obviously broken, which is the whole risk.
    expect(track.points[0].lat).toBeCloseTo(SYNTHETIC_START.lat, 4)
    expect(track.points[0].lon).toBeCloseTo(SYNTHETIC_START.lon, 4)
    for (const p of track.points) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180)
    }
  })

  it('reads the stored value as semicircles, not degrees', () => {
    // Pins the direction of the conversion: the encoded integer is large and
    // the parsed value is small. Inverting the formula would fail here.
    expect(Math.abs(degreesToSemicircles(SYNTHETIC_START.lat))).toBeGreaterThan(1_000_000)
    expect(Math.abs(track.points[0].lat)).toBeLessThan(90)
  })

  it('surfaces the fields the virtual-ride filter needs', () => {
    expect(track.subSport).toBe('virtualActivity')
    expect(track.manufacturer).toBe('zwift')
    expect(track.sport).toBe('cycling')
  })

  it('surfaces manufacturer even when subSport is ordinary', () => {
    // The filter rejects on either field alone, so each must survive parsing
    // independently. A single real recording could not exercise this.
    const t = parseFit(buildSyntheticFit({ subSport: 'generic' }), 'mfr-only')
    expect(t.manufacturer).toBe('zwift')
    expect(t.subSport).not.toBe('virtualActivity')
  })

  it('surfaces subSport even when the manufacturer is ordinary', () => {
    const t = parseFit(buildSyntheticFit({ manufacturer: 'garmin' }), 'sub-only')
    expect(t.subSport).toBe('virtualActivity')
    expect(t.manufacturer).toBe('garmin')
  })

  it('yields no points for a session that recorded no positions', () => {
    // Trainer rides record power and cadence but never a coordinate.
    const t = parseFit(buildSyntheticFit({ positioned: false }), 'trainer')
    expect(t.points.length).toBe(0)
  })

  it('records a start time and the source', () => {
    expect(track.startTime).toBeGreaterThan(1_600_000_000_000)
    expect(track.source).toBe('fit')
    expect(track.id).toBe('synthetic')
  })

  it('emits monotonically non-decreasing timestamps', () => {
    for (let i = 1; i < track.points.length; i++) {
      expect(track.points[i].t).toBeGreaterThanOrEqual(track.points[i - 1].t)
    }
  })

  it('throws a clear error on a non-FIT buffer', () => {
    expect(() => parseFit(new Uint8Array([1, 2, 3, 4]), 'junk')).toThrow(/not a valid FIT/i)
  })
})
