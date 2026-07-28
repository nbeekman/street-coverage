import { describe, expect, it } from 'vitest'
import { haversineMeters } from '../geo/haversine.ts'
import { segmentRidden, splitIntoRuns, wayCoverage } from './segments.ts'

/** Four collinear vertices, ~51.3 m apart, running east at Denver's latitude. */
const STEP = 0.0006
const LINE = [
  -105.0, 39.7,
  -105.0 + STEP, 39.7,
  -105.0 + 2 * STEP, 39.7,
  -105.0 + 3 * STEP, 39.7,
]

describe('segmentRidden', () => {
  it('requires both endpoints', () => {
    expect(segmentRidden([true, true], 0)).toBe(true)
    expect(segmentRidden([true, false], 0)).toBe(false)
    expect(segmentRidden([false, true], 0)).toBe(false)
    expect(segmentRidden([false, false], 0)).toBe(false)
  })

  it('does not let one stray hit carry a segment', () => {
    // A single hit node in the middle of an otherwise unridden way.
    const hits = [false, true, false]
    expect(segmentRidden(hits, 0)).toBe(false)
    expect(segmentRidden(hits, 1)).toBe(false)
  })
})

describe('splitIntoRuns', () => {
  it('yields one ridden run for a fully hit way', () => {
    expect(splitIntoRuns([true, true, true, true])).toEqual([
      { ridden: true, startVertex: 0, endVertex: 3 },
    ])
  })

  it('yields one unridden run for a fully missed way', () => {
    expect(splitIntoRuns([false, false, false, false])).toEqual([
      { ridden: false, startVertex: 0, endVertex: 3 },
    ])
  })

  it('splits at the state change, sharing the boundary vertex', () => {
    // Segments: 0 ridden, 1 not, 2 not.
    const runs = splitIntoRuns([true, true, false, false])
    expect(runs).toEqual([
      { ridden: true, startVertex: 0, endVertex: 1 },
      { ridden: false, startVertex: 1, endVertex: 3 },
    ])
    // Vertex 1 belongs to both runs -- the duplication the packer must expect.
    expect(runs[0].endVertex).toBe(runs[1].startVertex)
  })

  it('handles a way with a single segment', () => {
    expect(splitIntoRuns([true, true])).toEqual([
      { ridden: true, startVertex: 0, endVertex: 1 },
    ])
  })

  it('returns nothing when there are no segments', () => {
    expect(splitIntoRuns([true])).toEqual([])
    expect(splitIntoRuns([])).toEqual([])
  })

  it('covers every segment exactly once, with no gaps', () => {
    const hits = [true, true, false, true, true, false]
    const runs = splitIntoRuns(hits)
    expect(runs[0].startVertex).toBe(0)
    expect(runs[runs.length - 1].endVertex).toBe(hits.length - 1)
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].startVertex).toBe(runs[i - 1].endVertex)
      expect(runs[i].ridden).not.toBe(runs[i - 1].ridden)
    }
  })
})

describe('wayCoverage', () => {
  it('credits the full length when every node is hit', () => {
    const c = wayCoverage(LINE, [true, true, true, true])
    expect(c.coveredMeters).toBeCloseTo(c.totalMeters, 9)
    expect(c.complete).toBe(true)
    expect(c.runs).toHaveLength(1)
  })

  it('credits nothing when no node is hit', () => {
    const c = wayCoverage(LINE, [false, false, false, false])
    expect(c.coveredMeters).toBe(0)
    expect(c.totalMeters).toBeGreaterThan(0)
    expect(c.complete).toBe(false)
  })

  it('credits exactly the ridden segments', () => {
    // Only segment 0 qualifies.
    const c = wayCoverage(LINE, [true, true, false, false])
    const firstSegment = haversineMeters(LINE[0], LINE[1], LINE[2], LINE[3])
    expect(c.coveredMeters).toBeCloseTo(firstSegment, 9)
    expect(c.coveredMeters).toBeLessThan(c.totalMeters)
  })

  it('is not complete when a single interior node is missed', () => {
    const c = wayCoverage(LINE, [true, false, true, true])
    expect(c.complete).toBe(false)
    // Segments 0 and 1 both touch the missed node, so only segment 2 counts.
    const lastSegment = haversineMeters(LINE[4], LINE[5], LINE[6], LINE[7])
    expect(c.coveredMeters).toBeCloseTo(lastSegment, 9)
  })

  it('never credits more than the total length', () => {
    const patterns: boolean[][] = [
      [true, true, true, true],
      [true, false, true, false],
      [false, true, true, false],
      [true, true, false, true],
    ]
    for (const hits of patterns) {
      const c = wayCoverage(LINE, hits)
      expect(c.coveredMeters).toBeLessThanOrEqual(c.totalMeters + 1e-9)
      expect(c.coveredMeters).toBeGreaterThanOrEqual(0)
    }
  })

  it('measures total length independently of the hits', () => {
    const a = wayCoverage(LINE, [true, true, true, true])
    const b = wayCoverage(LINE, [false, false, false, false])
    expect(a.totalMeters).toBeCloseTo(b.totalMeters, 9)
    expect(a.totalMeters).toBeCloseTo(154, 0)
  })
})
