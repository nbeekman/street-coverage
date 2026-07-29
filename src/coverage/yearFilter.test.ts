import { describe, expect, it } from 'vitest'
import type { LoadedCoverageRegion } from './loadCoverage.ts'
import { filteredTotals, maskFor, runCounts } from './yearFilter.ts'

// Year indices, as the manifest would define them: [2021, 2022, 2023]
const Y2021 = 0
const Y2022 = 1
const Y2023 = 2
const bit = (i: number) => 1 << i
const only = (index: number) => ({ kind: 'year' as const, index })
const upTo = (index: number) => ({ kind: 'through' as const, index })

function region(
  id: string,
  group: string,
  runs: { flag: number; years: number; meters: number }[],
): LoadedCoverageRegion {
  return {
    id,
    region: { regionId: id, group },
    buffers: {
      flags: Uint8Array.from(runs.map((r) => r.flag)),
      years: Uint32Array.from(runs.map((r) => r.years)),
      meters: Float32Array.from(runs.map((r) => r.meters)),
    },
  } as unknown as LoadedCoverageRegion
}

describe('maskFor', () => {
  it('is zero for all-time, which means "no filtering"', () => {
    expect(maskFor(null)).toBe(0)
  })

  it('is cumulative for a through-filter, which is what the scrubber needs', () => {
    // 'as of 2023' means 2021, 2022 and 2023 all count.
    expect(maskFor(upTo(Y2021))).toBe(0b001)
    expect(maskFor(upTo(Y2022))).toBe(0b011)
    expect(maskFor(upTo(Y2023))).toBe(0b111)
  })

  it('sets one bit per year index', () => {
    expect(maskFor(only(Y2021))).toBe(0b001)
    expect(maskFor(only(Y2023))).toBe(0b100)
  })
})

describe('runCounts', () => {
  it('never counts an unridden run, filter or not', () => {
    expect(runCounts(0, 0, 0)).toBe(false)
    expect(runCounts(0, bit(Y2022), maskFor(only(Y2022)))).toBe(false)
  })

  it('counts every ridden run when there is no filter', () => {
    expect(runCounts(1, bit(Y2021), 0)).toBe(true)
    // A ridden run with no year recorded still counts toward all-time.
    expect(runCounts(1, 0, 0)).toBe(true)
  })

  it('counts a run only in the years it was ridden', () => {
    const years = bit(Y2021) | bit(Y2023)
    expect(runCounts(1, years, maskFor(only(Y2021)))).toBe(true)
    expect(runCounts(1, years, maskFor(only(Y2022)))).toBe(false)
    expect(runCounts(1, years, maskFor(only(Y2023)))).toBe(true)
  })
})

describe('filteredTotals', () => {
  const denver = region('denver', 'metro-core', [
    { flag: 1, years: bit(Y2021), meters: 100 },
    { flag: 1, years: bit(Y2022), meters: 200 },
    { flag: 1, years: bit(Y2021) | bit(Y2022), meters: 50 },
    { flag: 0, years: 0, meters: 9999 },
  ])
  const summit = region('summit', 'mountain', [{ flag: 1, years: bit(Y2021), meters: 7000 }])

  it('sums every ridden run for all-time', () => {
    const t = filteredTotals([denver], null)
    expect(t.byRegion.get('denver')).toBeCloseTo(350, 5)
  })

  it('sums only the selected year', () => {
    expect(filteredTotals([denver], only(Y2021)).byRegion.get('denver')).toBeCloseTo(150, 5)
    expect(filteredTotals([denver], only(Y2022)).byRegion.get('denver')).toBeCloseTo(250, 5)
  })

  it('counts a stretch ridden in two years under each of them', () => {
    // Deliberate: the 50 m run appears in both totals. Per-year figures are
    // "ground covered that year", so they sum to more than the all-time total.
    const a = filteredTotals([denver], only(Y2021)).byRegion.get('denver')!
    const b = filteredTotals([denver], only(Y2022)).byRegion.get('denver')!
    expect(a + b).toBeGreaterThan(filteredTotals([denver], null).byRegion.get('denver')!)
  })

  it('never counts unridden runs, however long', () => {
    // The 9999 m unridden run would dominate if the flag were ignored.
    expect(filteredTotals([denver], null).byRegion.get('denver')).toBeLessThan(400)
  })

  it('excludes away regions from the core total but still reports them', () => {
    const t = filteredTotals([denver, summit], null)
    expect(t.coreCoveredMeters).toBeCloseTo(350, 5)
    expect(t.byRegion.get('summit')).toBeCloseTo(7000, 5)
  })

  it('returns zero for a year with no riding', () => {
    expect(filteredTotals([denver], only(Y2023)).byRegion.get('denver')).toBe(0)
    expect(filteredTotals([denver], only(Y2023)).coreCoveredMeters).toBe(0)
  })

  it('handles no regions', () => {
    expect(filteredTotals([], null).coreCoveredMeters).toBe(0)
  })
})
