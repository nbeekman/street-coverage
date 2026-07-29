import type { LoadedCoverageRegion } from './loadCoverage.ts'

/**
 * Which years to count.
 *
 * - `null` -- all time
 * - `{ kind: 'year' }` -- ground covered during that one year
 * - `{ kind: 'through' }` -- everything ridden up to and including that year
 *
 * `through` is what the timeline scrubber uses, and it needs no data the
 * year filter did not already require: "as of 2020" is simply every bit up to
 * 2020's, so the whole feature is a different mask over the same buffers.
 *
 * Held as a year index rather than a calendar year so the mask arithmetic
 * never has to know what the years are -- the manifest owns that mapping.
 *
 * **Known shortfall in `through`.** A run's year mask is the intersection of
 * its endpoints' years, so a stretch whose two ends were first ridden in
 * different years carries no year at all. That is right for `year` -- it was
 * never traversed within one calendar year -- but wrong cumulatively, since by
 * the final year both ends have been ridden. Measured on this dataset: 16 runs,
 * 1.5 km, 0.012 percentage points, which is why the last frame of the timeline
 * reads 2.85% against an all-time 2.86%.
 *
 * Fixing it properly means storing a per-run cumulative year --
 * max(firstYear(a), firstYear(b)) -- rather than deriving it from the mask.
 * Left undone deliberately: it is a format change and another rebuild for a
 * hundredth of a point.
 */
export type YearFilter =
  | null
  | { kind: 'year'; index: number }
  | { kind: 'through'; index: number }

/** Bitmask a run must intersect. 0 means "any ridden run counts". */
export function maskFor(filter: YearFilter): number {
  if (filter === null) return 0
  if (filter.kind === 'year') return 1 << filter.index
  // Every year up to and including this one: bits 0..index.
  return (1 << (filter.index + 1)) - 1
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

/** Calendar year a filter refers to, or null for all-time. */
export function calendarYearOf(filter: YearFilter, years: readonly number[]): number | null {
  return filter === null ? null : (years[filter.index] ?? null)
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
