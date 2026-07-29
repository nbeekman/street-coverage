import type { LoadedCoverageRegion } from './loadCoverage.ts'

/**
 * Which years to count. `null` means all-time.
 *
 * Held as a year index rather than a calendar year so the mask arithmetic
 * never has to know what the years are -- the manifest owns that mapping.
 */
export type YearFilter = number | null

/** Bitmask a run must intersect. 0 means "any ridden run counts". */
export function maskFor(filter: YearFilter): number {
  return filter === null ? 0 : 1 << filter
}

/**
 * Does this run count under the filter?
 *
 * Unridden runs never count. With no filter, every ridden run does; with one,
 * only runs carrying that year's bit.
 */
export function runCounts(flag: number, years: number, mask: number): boolean {
  if (flag !== 1) return false
  return mask === 0 || (years & mask) !== 0
}

export type FilteredTotals = {
  /** Covered metres per region id, under the filter. */
  byRegion: Map<string, number>
  /** Covered metres across the metro-core group. */
  coreCoveredMeters: number
}

/**
 * Covered distance under a year filter, in one pass over the runs.
 *
 * Every run carries its own length, so this is a sum rather than a
 * recomputation -- no geometry is touched and nothing is re-fetched. Across
 * ~70,000 runs it is well under a frame.
 */
export function filteredTotals(
  regions: readonly LoadedCoverageRegion[],
  filter: YearFilter,
): FilteredTotals {
  const mask = maskFor(filter)
  const byRegion = new Map<string, number>()
  let coreCoveredMeters = 0

  for (const region of regions) {
    const { flags, years, meters } = region.buffers
    let covered = 0
    for (let i = 0; i < flags.length; i++) {
      if (runCounts(flags[i], years[i], mask)) covered += meters[i]
    }
    byRegion.set(region.id, covered)
    if (region.region.group === 'metro-core') coreCoveredMeters += covered
  }

  return { byRegion, coreCoveredMeters }
}
