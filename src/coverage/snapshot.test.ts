import { describe, expect, it } from 'vitest'
import { splitIntoRuns } from './segments.ts'
import {
  COVERAGE_SNAPSHOT_VERSION,
  CoverageError,
  packCoverage,
  runCoords,
  validateCoverage,
  type CoverageBuffers,
  type CoverageManifest,
  type PackedWay,
  type RegionCoverage,
} from './snapshot.ts'

const LINE = [0, 0, 1, 1, 2, 2, 3, 3]

function bytesOf(b: CoverageBuffers) {
  return {
    positions: b.positions.byteLength,
    startIndices: b.startIndices.byteLength,
    flags: b.flags.byteLength,
  }
}

function regionFor(b: CoverageBuffers, overrides: Partial<RegionCoverage> = {}): RegionCoverage {
  const runCount = b.flags.length
  return {
    regionId: 'test',
    regionName: 'Test',
    group: 'metro-core',
    wayCount: 1,
    uniqueNodeCount: 4,
    nodesHit: 2,
    waysComplete: 0,
    totalMeters: 100,
    coveredMeters: 50,
    runCount,
    riddenRunCount: b.flags.reduce((s, f) => s + f, 0),
    positionCount: b.startIndices[runCount],
    byteLengths: bytesOf(b),
    ...overrides,
  }
}

function manifestFor(regions: RegionCoverage[]): CoverageManifest {
  return {
    version: COVERAGE_SNAPSHOT_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    radiusMeters: 25,
    ridesSnapshotVersion: 1,
    rideCount: 165,
    ridePointCount: 151382,
    densifiedPointCount: 400000,
    densifyMeters: 10,
    regions,
    totals: {
      wayCount: 1,
      uniqueNodeCount: 4,
      nodesHit: 2,
      waysComplete: 0,
      totalMeters: 100,
      coveredMeters: 50,
    },
  }
}

describe('packCoverage', () => {
  it('round-trips a single fully ridden run exactly', () => {
    const way: PackedWay = { coords: LINE, runs: splitIntoRuns([true, true, true, true]) }
    const b = packCoverage([way])

    expect(b.flags).toEqual(new Uint8Array([1]))
    expect(b.startIndices).toEqual(new Uint32Array([0, 4]))
    expect(runCoords(b, 0)).toEqual(LINE)
  })

  it('duplicates the boundary vertex when a way splits', () => {
    const way: PackedWay = { coords: LINE, runs: splitIntoRuns([true, true, false, false]) }
    const b = packCoverage([way])

    expect(b.flags).toEqual(new Uint8Array([1, 0]))
    // Run 0 is vertices 0..1, run 1 is vertices 1..3 -- vertex 1 in both.
    expect(runCoords(b, 0)).toEqual([0, 0, 1, 1])
    expect(runCoords(b, 1)).toEqual([1, 1, 2, 2, 3, 3])
    // 4 source vertices became 5 packed vertices.
    expect(b.startIndices[2]).toBe(5)
  })

  it('preserves coordinates bit for bit', () => {
    const precise = [-105.0123456789012, 39.7098765432109, -104.9876543210987, 39.6543210987654]
    const way: PackedWay = { coords: precise, runs: splitIntoRuns([true, true]) }
    const b = packCoverage([way])
    expect(runCoords(b, 0)).toEqual(precise)
  })

  it('concatenates runs across several ways', () => {
    const a: PackedWay = { coords: LINE, runs: splitIntoRuns([true, true, true, true]) }
    const c: PackedWay = { coords: LINE, runs: splitIntoRuns([false, true, true, false]) }
    const b = packCoverage([a, c])

    expect(b.flags.length).toBe(1 + 3)
    expect(Array.from(b.flags)).toEqual([1, 0, 1, 0])
    expect(b.startIndices[b.flags.length]).toBe(b.positions.length / 2)
  })

  it('produces empty buffers for no ways', () => {
    const b = packCoverage([])
    expect(b.positions.length).toBe(0)
    expect(b.flags.length).toBe(0)
    expect(b.startIndices).toEqual(new Uint32Array([0]))
  })

  it('ends startIndices at the true vertex count', () => {
    const ways: PackedWay[] = [
      { coords: LINE, runs: splitIntoRuns([true, false, true, false]) },
      { coords: LINE, runs: splitIntoRuns([true, true, true, true]) },
    ]
    const b = packCoverage(ways)
    expect(b.startIndices[b.startIndices.length - 1]).toBe(b.positions.length / 2)
  })
})

describe('validateCoverage', () => {
  const buffers = packCoverage([
    { coords: LINE, runs: splitIntoRuns([true, true, false, false]) },
  ])

  it('accepts a consistent snapshot', () => {
    const region = regionFor(buffers)
    expect(() => validateCoverage(manifestFor([region]), region, buffers)).not.toThrow()
  })

  it('rejects a version mismatch with a distinct code', () => {
    const region = regionFor(buffers)
    const manifest = { ...manifestFor([region]), version: COVERAGE_SNAPSHOT_VERSION + 1 }
    try {
      validateCoverage(manifest, region, buffers)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CoverageError)
      expect((err as CoverageError).code).toBe('VERSION_MISMATCH')
    }
  })

  it('rejects a truncated buffer', () => {
    const region = regionFor(buffers, {
      byteLengths: { ...bytesOf(buffers), positions: bytesOf(buffers).positions + 8 },
    })
    try {
      validateCoverage(manifestFor([region]), region, buffers)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as CoverageError).code).toBe('TRUNCATED')
    }
  })

  it('rejects a run count that disagrees with startIndices', () => {
    const region = regionFor(buffers, { runCount: 99 })
    try {
      validateCoverage(manifestFor([region]), region, buffers)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as CoverageError).code).toBe('MISALIGNED')
    }
  })

  it('rejects a positionCount that disagrees with the terminator', () => {
    const region = regionFor(buffers, { positionCount: 999 })
    try {
      validateCoverage(manifestFor([region]), region, buffers)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as CoverageError).code).toBe('MISALIGNED')
    }
  })
})
