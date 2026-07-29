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
import MapKey from './MapKey.tsx'
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
  units,
  onToggleUnits,
  open,
}: Props) {
  const fps = useFps()

  const core = state.regions.filter((r) => r.group === 'metro-core')
  const totalWays = core.reduce((s, r) => s + r.manifest.wayCount, 0)
  const totalMeters = core.reduce((s, r) => s + r.manifest.totalMeters, 0)

  const totals = coverage.coverage?.manifest.totals ?? null
  const byRegion = new Map(
    (coverage.coverage?.manifest.regions ?? []).map((r) => [r.regionId, r]),
  )

  // Until the coverage build has run there is no numerator, and showing
  // anything other than zero would be a lie.
  const coveredMeters = totals?.coveredMeters ?? 0
  const percent = totalMeters === 0 ? 0 : (coveredMeters / totalMeters) * 100

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
          </div>
        </div>
        <UnitsToggle units={units} onToggle={onToggleUnits} />
      </div>

      <div className="mb-3">
        <ViewToggle
          mode={mode}
          onChange={onModeChange}
          ridesAvailable={rides.status === 'ready' && rides.rides !== null}
        />
        <MapKey mode={mode} />
      </div>

      {state.status === 'loading' && (
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
            <th className="pl-2 text-right font-normal">Ways</th>
            <th className="pl-2 text-right font-normal">{unit}</th>
            <th className="pl-2 text-right font-normal">Ridden</th>
            <th className="pl-2 text-right font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {state.regions.map((r) => {
            const c = byRegion.get(r.id)
            const pct = c && c.totalMeters > 0 ? (c.coveredMeters / c.totalMeters) * 100 : 0
            return (
              <tr key={r.id} className="border-t border-white/10">
                <td className="py-0.5 text-left">{r.name}</td>
                <td className="pl-2 text-right">{r.manifest.wayCount.toLocaleString()}</td>
                <td className="pl-2 text-right">
                  {formatDistance(r.manifest.totalMeters, units)}
                </td>
                <td className="pl-2 text-right">
                  {c ? formatDistance(c.coveredMeters, units, 1) : '—'}
                </td>
                <td
                  className={
                    pct > 0 ? 'pl-2 text-right text-amber-300' : 'pl-2 text-right text-neutral-600'
                  }
                >
                  {c ? pct.toFixed(2) : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="border-t border-white/30 font-semibold">
            <td className="py-0.5 text-left">Total</td>
            <td className="pl-2 text-right">{totalWays.toLocaleString()}</td>
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

      {coverage.status === 'ready' && coverage.coverage && totals && (
        <div className="mt-3 border-t border-white/20 pt-2">
          <div className="text-xs text-neutral-500">
            {totals.nodesHit.toLocaleString()} of {totals.uniqueNodeCount.toLocaleString()}{' '}
            nodes hit ·{' '}
            {totals.waysComplete.toLocaleString()} streets complete
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
            {rides.rides.manifest.rideCount.toLocaleString()} rides ·{' '}
            {formatDistance(rides.rides.manifest.totalMeters, units)} {unit} ridden
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
        <span>snapshot v{state.regions[0]?.manifest.version ?? '—'}</span>
        <span>{state.decodeMs} ms decode</span>
        <span>{fps} fps</span>
      </div>
    </div>
  )
}
