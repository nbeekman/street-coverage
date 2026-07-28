import type { NetworkState } from '../network/useNetwork.ts'
import type { RidesState } from '../rides/useRides.ts'
import {
  distanceLabel,
  formatDistance,
  formatShortDistance,
  shortDistanceLabel,
  type Units,
} from '../units/units.ts'
import UnitsToggle from './UnitsToggle.tsx'
import { useFps } from './useFps.ts'

type Props = {
  state: NetworkState
  rides: RidesState
  showRides: boolean
  onToggleRides: () => void
  units: Units
  onToggleUnits: () => void
}

export default function StatsPanel({
  state,
  rides,
  showRides,
  onToggleRides,
  units,
  onToggleUnits,
}: Props) {
  const fps = useFps()

  const core = state.regions.filter((r) => r.group === 'metro-core')
  const totalWays = core.reduce((s, r) => s + r.manifest.wayCount, 0)
  const totalMeters = core.reduce((s, r) => s + r.manifest.totalMeters, 0)
  const totalNodes = core.reduce((s, r) => s + r.manifest.uniqueNodeCount, 0)

  // No numerator until M3 computes coverage; the denominator is real today.
  const riddenMeters = 0
  const percent = totalMeters === 0 ? 0 : (riddenMeters / totalMeters) * 100

  const unit = distanceLabel(units)

  return (
    <div className="absolute top-4 left-4 z-10 w-96 rounded-lg bg-black/75 p-4 text-sm backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-4xl font-semibold tabular-nums">
            {percent.toFixed(2)}%
          </div>
          <div className="text-xs text-neutral-400">
            of {formatDistance(totalMeters, units)} {unit} across {core.length}{' '}
            metro-core regions
          </div>
        </div>
        <UnitsToggle units={units} onToggle={onToggleUnits} />
      </div>

      {state.status === 'loading' && (
        <div className="mb-2 text-xs text-amber-300">
          Loading… {state.regions.length} region
          {state.regions.length === 1 ? '' : 's'} decoded
        </div>
      )}

      <table className="w-full text-xs tabular-nums">
        <thead className="text-neutral-400">
          <tr>
            <th className="text-left font-normal">Region</th>
            <th className="pl-3 text-right font-normal">Ways</th>
            <th className="pl-3 text-right font-normal">Nodes</th>
            <th className="pl-3 text-right font-normal">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {state.regions.map((r) => (
            <tr key={r.id} className="border-t border-white/10">
              <td className="py-0.5 text-left">{r.name}</td>
              <td className="pl-3 text-right">{r.manifest.wayCount.toLocaleString()}</td>
              <td className="pl-3 text-right">{r.manifest.uniqueNodeCount.toLocaleString()}</td>
              <td className="pl-3 text-right">
                {formatDistance(r.manifest.totalMeters, units)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-white/30 font-semibold">
            <td className="py-0.5 text-left">Total</td>
            <td className="pl-3 text-right">{totalWays.toLocaleString()}</td>
            <td className="pl-3 text-right">{totalNodes.toLocaleString()}</td>
            <td className="pl-3 text-right">{formatDistance(totalMeters, units)}</td>
          </tr>
        </tbody>
      </table>

      {rides.status === 'ready' && rides.rides && (
        <div className="mt-3 border-t border-white/20 pt-2">
          <label className="flex cursor-pointer items-center justify-between text-xs">
            <span>
              {rides.rides.manifest.rideCount.toLocaleString()} rides ·{' '}
              {formatDistance(rides.rides.manifest.totalMeters, units)} {unit} ridden
            </span>
            <input type="checkbox" checked={showRides} onChange={onToggleRides} className="ml-2" />
          </label>
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
