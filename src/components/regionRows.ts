import type { CoverageManifest } from '../coverage/snapshot.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'

export type RegionRow = {
  id: string
  name: string
  group: string
  segments: number
  totalMeters: number
  /** Undefined when coverage has not been computed or loaded. */
  coveredMeters?: number
}

export type Totals = {
  segments: number
  totalMeters: number
  coveredMeters: number
  percent: number
}

/**
 * Rows for the stats table, from whichever source is loaded.
 *
 * The coverage manifest already carries every field the table shows --
 * region name, group, segment count, total metres -- plus covered metres. So
 * in coverage mode the panel needs no network data at all, which is what lets
 * the app skip fetching a 5.3 MB snapshot it would only read four numbers from.
 *
 * The network manifests are the fallback for when coverage has not been built.
 */
export function regionRows(
  regions: readonly LoadedRegion[],
  coverage: CoverageManifest | null,
): RegionRow[] {
  if (coverage !== null) {
    return sorted(
      coverage.regions.map((r) => ({
        id: r.regionId,
        name: r.regionName,
        group: r.group,
        segments: r.wayCount,
        totalMeters: r.totalMeters,
        coveredMeters: r.coveredMeters,
      })),
    )
  }

  return sorted(
    regions.map((r) => ({
      id: r.id,
      name: r.name,
      group: r.group,
      segments: r.manifest.wayCount,
      totalMeters: r.manifest.totalMeters,
    })),
  )
}

/** Largest first, so the table reads the same whichever source fed it. */
function sorted(rows: RegionRow[]): RegionRow[] {
  return [...rows].sort((a, b) => b.segments - a.segments)
}

/**
 * Totals over the metro-core group only.
 *
 * Away regions are excluded deliberately: including a mountain county would
 * move the headline every time somewhere distant was added, which would make
 * the number describe the registry rather than the riding.
 */
export function coreTotals(rows: readonly RegionRow[]): Totals {
  const core = rows.filter((r) => r.group === 'metro-core')
  const segments = core.reduce((s, r) => s + r.segments, 0)
  const totalMeters = core.reduce((s, r) => s + r.totalMeters, 0)
  const coveredMeters = core.reduce((s, r) => s + (r.coveredMeters ?? 0), 0)
  return {
    segments,
    totalMeters,
    coveredMeters,
    // Showing anything but zero before coverage exists would be a lie.
    percent: totalMeters === 0 ? 0 : (coveredMeters / totalMeters) * 100,
  }
}
