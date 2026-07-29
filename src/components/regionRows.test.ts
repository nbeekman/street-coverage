import { describe, expect, it } from 'vitest'
import type { CoverageManifest } from '../coverage/snapshot.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'
import { coreTotals, regionRows } from './regionRows.ts'

function net(id: string, group: string, ways: number, meters: number): LoadedRegion {
  return {
    id,
    name: id.toUpperCase(),
    group,
    manifest: { wayCount: ways, totalMeters: meters },
  } as unknown as LoadedRegion
}

function cov(
  entries: { id: string; group: string; ways: number; total: number; covered: number }[],
): CoverageManifest {
  return {
    regions: entries.map((e) => ({
      regionId: e.id,
      regionName: e.id.toUpperCase(),
      group: e.group,
      wayCount: e.ways,
      totalMeters: e.total,
      coveredMeters: e.covered,
    })),
  } as unknown as CoverageManifest
}

describe('regionRows', () => {
  it('prefers coverage, which carries everything the table needs', () => {
    // This is what lets coverage mode skip fetching the network snapshot.
    const rows = regionRows(
      [net('denver', 'metro-core', 1, 1)],
      cov([{ id: 'denver', group: 'metro-core', ways: 24_011, total: 4_193_000, covered: 142_000 }]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'denver',
      name: 'DENVER',
      segments: 24_011,
      totalMeters: 4_193_000,
      coveredMeters: 142_000,
    })
  })

  it('falls back to network manifests when coverage is absent', () => {
    const rows = regionRows([net('denver', 'metro-core', 24_011, 4_193_000)], null)
    expect(rows[0].segments).toBe(24_011)
    expect(rows[0].coveredMeters).toBeUndefined()
  })

  it('returns nothing when neither source has loaded', () => {
    expect(regionRows([], null)).toEqual([])
  })
})

describe('coreTotals', () => {
  const rows = regionRows(
    [],
    cov([
      { id: 'denver', group: 'metro-core', ways: 100, total: 1000, covered: 100 },
      { id: 'aurora', group: 'metro-core', ways: 50, total: 1000, covered: 0 },
      { id: 'summit', group: 'mountain', ways: 999, total: 9_999_999, covered: 9_999_999 },
    ]),
  )

  it('sums only the metro-core group', () => {
    const t = coreTotals(rows)
    expect(t.segments).toBe(150)
    expect(t.totalMeters).toBe(2000)
    expect(t.coveredMeters).toBe(100)
  })

  it('excludes away regions from the headline entirely', () => {
    // Summit is fully covered and enormous. If it leaked into the totals the
    // headline would read ~100% and describe the registry, not the riding.
    expect(coreTotals(rows).percent).toBeCloseTo(5, 10)
  })

  it('reports zero rather than NaN before anything is loaded', () => {
    const t = coreTotals([])
    expect(t.percent).toBe(0)
    expect(t.totalMeters).toBe(0)
  })

  it('reports zero percent when coverage has not been computed', () => {
    const t = coreTotals(regionRows([net('denver', 'metro-core', 10, 1000)], null))
    expect(t.totalMeters).toBe(1000)
    expect(t.percent).toBe(0)
  })
})
