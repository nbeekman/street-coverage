import { useState } from 'react'
import type { CoverageState } from '../coverage/useCoverage.ts'
import type { NetworkState } from '../network/useNetwork.ts'
import type { RidesState } from '../rides/useRides.ts'
import {
  distanceLabel,
  formatDistance,
  formatShortDistance,
  shortDistanceLabel,
  type Units,
} from '../units/units.ts'
import InfoIcon from './InfoIcon.tsx'
import MapKey from './MapKey.tsx'
import { filteredTotals, type YearFilter } from '../coverage/yearFilter.ts'
import { coreTotals, regionRows } from './regionRows.ts'
import YearSelector from './YearSelector.tsx'
import UnitsToggle from './UnitsToggle.tsx'
import ViewToggle from './ViewToggle.tsx'
import type { ViewMode } from './viewMode.ts'
import { useFps } from './useFps.ts'

type Props = {
  state: NetworkState
  rides: RidesState
  coverage: CoverageState
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  year: YearFilter
  onYearChange: (year: YearFilter) => void
  units: Units
  onToggleUnits: () => void
  /** Drawer state; only meaningful below the md breakpoint. */
  open: boolean
}

export default function StatsPanel({
  state,
  rides,
  coverage,
  mode,
  onModeChange,
  year,
  onYearChange,
  units,
  onToggleUnits,
  open,
}: Props) {
  const fps = useFps()
  const [showSegmentInfo, setShowSegmentInfo] = useState(false)

  // Rows come from whichever snapshot this mode loaded. Coverage mode never
  // fetches the network, so the table is driven by the coverage manifest.
  const base = regionRows(state.regions, coverage.coverage?.manifest ?? null)
  // With a year selected, covered distance is recomputed from the run buffers
  // rather than read from the manifest, which only holds all-time figures.
  const filtered =
    year !== null && coverage.coverage
      ? filteredTotals(coverage.coverage.regions, year)
      : null
  const rows = filtered
    ? base.map((r) => ({ ...r, coveredMeters: filtered.byRegion.get(r.id) ?? 0 }))
    : base
  const core = rows.filter((r) => r.group === 'metro-core')
  const { segments: totalSegments, totalMeters, coveredMeters, percent } = coreTotals(rows)
  const totals = coverage.coverage?.manifest.totals ?? null

  // Ride count and distance follow the year filter too, from the per-ride
  // figures in the snapshot rather than re-derived from render coordinates.
  const selectedYear =
    year !== null ? (coverage.coverage?.manifest.years[year] ?? null) : null
  const rideStats = (() => {
    const loaded = rides.rides
    if (!loaded) return null
    const { times, meters } = loaded.buffers
    if (selectedYear === null) {
      return { count: loaded.manifest.rideCount, meters: loaded.manifest.totalMeters }
    }
    let count = 0
    let total = 0
    for (let i = 0; i < times.length; i++) {
      if (new Date(times[i]).getUTCFullYear() !== selectedYear) continue
      count++
      total += meters[i]
    }
    return { count, meters: total }
  })()

  const unit = distanceLabel(units)

  return (
    // Below md this is an off-canvas drawer; from md up it is the floating
    // panel it always was. Both states scroll, because 19 region rows overflow
    // a laptop viewport too -- that was already true before mobile.
    <div
      className={
        'fixed inset-y-0 left-0 z-20 w-[88vw] max-w-sm overflow-y-auto bg-black/90 p-4 pt-16 text-sm backdrop-blur transition-transform duration-200 ' +
        'md:absolute md:inset-y-auto md:top-4 md:left-4 md:z-10 md:max-h-[calc(100vh-2rem)] md:w-96 md:max-w-none md:translate-x-0 md:rounded-lg md:bg-black/75 md:pt-4 ' +
        (open ? 'translate-x-0' : '-translate-x-full')
      }
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-4xl font-semibold tabular-nums">
            {percent.toFixed(2)}%
          </div>
          <div className="text-xs text-neutral-400">
            {formatDistance(coveredMeters, units)} of{' '}
            {formatDistance(totalMeters, units)} {unit} across {core.length} metro-core
            regions
            {/*
              A filtered headline has to say so. Without it a screenshot of
              1.53% is indistinguishable from the all-time figure -- exactly
              the kind of misleading number this project avoids elsewhere.
            */}
            {year !== null && coverage.coverage && (
              <span className="text-amber-300">
                {' · '}ridden during {coverage.coverage.manifest.years[year]}
              </span>
            )}
          </div>
        </div>
        <UnitsToggle units={units} onToggle={onToggleUnits} />
      </div>

      <div className="mb-3">
        <ViewToggle
          mode={mode}
          onChange={onModeChange}
          // Rides load on demand, so availability cannot be known before
          // switching. The panel reports an absent snapshot once it tries.
          ridesAvailable

        />
        <MapKey mode={mode} />
        {coverage.coverage && (
          <div className="mt-2">
            <YearSelector
              years={coverage.coverage.manifest.years}
              filter={year}
              onChange={onYearChange}
            />
          </div>
        )}
      </div>

      {state.status === 'loading' && state.regions.length > 0 && (
        <div className="mb-2 text-xs text-amber-300">
          Loading… {state.regions.length} region
          {state.regions.length === 1 ? '' : 's'} decoded
        </div>
      )}

      <div className="overflow-x-auto">
      <table className="w-full min-w-[19rem] text-xs tabular-nums">
        <thead className="text-neutral-400">
          <tr>
            <th className="text-left font-normal">Region</th>
            <th className="pl-2 text-right font-normal whitespace-nowrap">
              Segments
              <InfoIcon
                open={showSegmentInfo}
                onToggle={() => setShowSegmentInfo((v) => !v)}
                label="What is a segment?"
                controls="segment-info"
              />
            </th>
            <th className="pl-2 text-right font-normal">{unit}</th>
            <th className="pl-2 text-right font-normal">Ridden</th>
            <th className="pl-2 text-right font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const covered = r.coveredMeters
            const pct =
              covered !== undefined && r.totalMeters > 0 ? (covered / r.totalMeters) * 100 : 0
            return (
              <tr key={r.id} className="border-t border-white/10">
                <td className="py-0.5 text-left">{r.name}</td>
                <td className="pl-2 text-right">{r.segments.toLocaleString()}</td>
                <td className="pl-2 text-right">{formatDistance(r.totalMeters, units)}</td>
                <td className="pl-2 text-right">
                  {covered !== undefined ? formatDistance(covered, units, 1) : '—'}
                </td>
                <td
                  className={
                    pct > 0 ? 'pl-2 text-right text-amber-300' : 'pl-2 text-right text-neutral-600'
                  }
                >
                  {covered !== undefined ? pct.toFixed(2) : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="border-t border-white/30 font-semibold">
            <td className="py-0.5 text-left">Total</td>
            <td className="pl-2 text-right">{totalSegments.toLocaleString()}</td>
            <td className="pl-2 text-right">{formatDistance(totalMeters, units)}</td>
            <td className="pl-2 text-right">
              {totals ? formatDistance(coveredMeters, units, 1) : '—'}
            </td>
            <td className="pl-2 text-right text-amber-300">
              {totals ? percent.toFixed(2) : '—'}
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      {showSegmentInfo && (
        <div
          id="segment-info"
          role="note"
          className="mt-2 rounded border border-white/15 bg-white/5 p-2 text-xs text-neutral-300"
        >
          A <strong>segment</strong> is one piece of road as OpenStreetMap stores it, not a
          whole street. OSM splits a street wherever something changes — an intersection, a
          city boundary, a speed limit, a bike lane. Segments here average about 180 m, and a
          long street is many of them: East Colfax Avenue alone is 277.
        </div>
      )}

      {coverage.status === 'ready' && coverage.coverage && totals && (
        <div className="mt-3 border-t border-white/20 pt-2">
          <div className="text-xs text-neutral-500">
            {totals.nodesHit.toLocaleString()} of {totals.uniqueNodeCount.toLocaleString()}{' '}
            nodes hit ·{' '}
            {totals.waysComplete.toLocaleString()} segments complete
          </div>
          <div className="text-xs text-neutral-500">
            {formatShortDistance(coverage.coverage.manifest.radiusMeters, units)}{' '}
            {shortDistanceLabel(units)} match radius
          </div>
        </div>
      )}
      {coverage.status === 'absent' && (
        <div className="mt-3 border-t border-white/20 pt-2 text-xs text-neutral-500">
          No coverage computed — run npm run build:coverage
        </div>
      )}
      {coverage.status === 'error' && (
        <div className="mt-3 border-t border-white/20 pt-2 text-xs text-red-300">
          {coverage.error}
        </div>
      )}

      {rides.status === 'ready' && rides.rides && (
        <div className="mt-3 border-t border-white/20 pt-2">
          <div className="text-xs">
            {(rideStats?.count ?? 0).toLocaleString()} rides ·{' '}
            {formatDistance(rideStats?.meters ?? 0, units)} {unit} ridden
            {selectedYear !== null && (
              <span className="text-amber-300"> in {selectedYear}</span>
            )}
          </div>
          {rides.rides.manifest.outOfRegionCount > 0 && (
            <div className="mt-1 text-xs text-neutral-500">
              {rides.rides.manifest.outOfRegionCount} outside the metro — drawn, but
              they score no coverage
            </div>
          )}
          {rides.rides.manifest.clipMeters > 0 && (
            <div className="mt-1 text-xs text-neutral-500">
              {formatShortDistance(rides.rides.manifest.clipMeters, units)}{' '}
              {shortDistanceLabel(units)} clipped from each end
            </div>
          )}
        </div>
      )}
      {rides.status === 'absent' && (
        <div className="mt-3 border-t border-white/20 pt-2 text-xs text-neutral-500">
          No rides imported — run npm run import:rides
        </div>
      )}

      <div className="mt-3 flex justify-between text-xs text-neutral-500">
        <span>
          snapshot v
          {coverage.coverage?.manifest.version ??
            state.regions[0]?.manifest.version ??
            '—'}
        </span>
        {/*
          Whichever snapshot this mode actually loaded. Reading the network's
          figure unconditionally showed 0 ms in coverage mode, where the
          network is never fetched.
        */}
        <span>{(mode === 'coverage' ? coverage.decodeMs : state.decodeMs)} ms decode</span>
        <span>{fps} fps</span>
      </div>
    </div>
  )
}
