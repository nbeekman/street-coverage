import type { NetworkState } from '../network/useNetwork.ts'
import { useFps } from './useFps.ts'

const km = (meters: number) => (meters / 1000).toFixed(0)

export default function StatsPanel({ state }: { state: NetworkState }) {
  const fps = useFps()

  const core = state.regions.filter((r) => r.group === 'metro-core')
  const totalWays = core.reduce((s, r) => s + r.manifest.wayCount, 0)
  const totalMeters = core.reduce((s, r) => s + r.manifest.totalMeters, 0)
  const totalNodes = core.reduce((s, r) => s + r.manifest.uniqueNodeCount, 0)

  // No numerator until M3 computes coverage; the denominator is real today.
  const riddenMeters = 0
  const percent = totalMeters === 0 ? 0 : (riddenMeters / totalMeters) * 100

  return (
    <div className="absolute top-4 left-4 z-10 w-96 rounded-lg bg-black/75 p-4 text-sm backdrop-blur">
      <div className="mb-3">
        <div className="text-4xl font-semibold tabular-nums">
          {percent.toFixed(2)}%
        </div>
        <div className="text-xs text-neutral-400">
          of {km(totalMeters)} km across {core.length} metro-core regions
        </div>
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
            <th className="pl-3 text-right font-normal">km</th>
          </tr>
        </thead>
        <tbody>
          {state.regions.map((r) => (
            <tr key={r.id} className="border-t border-white/10">
              <td className="py-0.5 text-left">{r.name}</td>
              <td className="pl-3 text-right">{r.manifest.wayCount.toLocaleString()}</td>
              <td className="pl-3 text-right">{r.manifest.uniqueNodeCount.toLocaleString()}</td>
              <td className="pl-3 text-right">{km(r.manifest.totalMeters)}</td>
            </tr>
          ))}
          <tr className="border-t border-white/30 font-semibold">
            <td className="py-0.5 text-left">Total</td>
            <td className="pl-3 text-right">{totalWays.toLocaleString()}</td>
            <td className="pl-3 text-right">{totalNodes.toLocaleString()}</td>
            <td className="pl-3 text-right">{km(totalMeters)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 flex justify-between text-xs text-neutral-500">
        <span>snapshot v{state.regions[0]?.manifest.version ?? '—'}</span>
        <span>{state.decodeMs} ms decode</span>
        <span>{fps} fps</span>
      </div>
    </div>
  )
}
