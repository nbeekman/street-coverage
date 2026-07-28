import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFit } from './fit'

const FIXTURE = join(process.cwd(), 'test', 'fixtures', 'zwift-virtual.fit')
const track = parseFit(new Uint8Array(readFileSync(FIXTURE)), 'zwift-virtual')

describe('parseFit', () => {
  it('extracts every positioned record', () => {
    expect(track.points.length).toBe(1592)
  })

  it('converts semicircles to real degrees', () => {
    // Raw semicircles would be -138818392 / 1991822250, not plausible
    // coordinates. Watopia is -11.64, 166.95.
    expect(track.points[0].lat).toBeCloseTo(-11.63562, 4)
    expect(track.points[0].lon).toBeCloseTo(166.95261, 4)
    for (const p of track.points) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180)
    }
  })

  it('surfaces the fields the virtual-ride filter needs', () => {
    expect(track.subSport).toBe('virtualActivity')
    expect(track.manufacturer).toBe('zwift')
    expect(track.sport).toBe('cycling')
  })

  it('records a start time and the source', () => {
    expect(track.startTime).toBeGreaterThan(1_600_000_000_000)
    expect(track.source).toBe('fit')
    expect(track.id).toBe('zwift-virtual')
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
