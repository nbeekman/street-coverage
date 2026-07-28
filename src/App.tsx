import { useState } from 'react'
import MapView from './components/MapView.tsx'
import StatsPanel from './components/StatsPanel.tsx'
import { useCoverage } from './coverage/useCoverage.ts'
import { useNetwork } from './network/useNetwork.ts'
import { useRides } from './rides/useRides.ts'
import { useUnits } from './units/useUnits.ts'

export default function App() {
  const state = useNetwork()
  const rides = useRides()
  const coverage = useCoverage()
  const [showRides, setShowRides] = useState(true)
  const [showCoverage, setShowCoverage] = useState(true)
  const { units, toggle: toggleUnits } = useUnits()

  if (state.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-lg border border-red-500/40 bg-red-950/40 p-6">
          <h1 className="mb-2 text-lg font-semibold text-red-200">
            Could not load the network snapshot
          </h1>
          <p className="font-mono text-sm text-red-100/80">{state.error}</p>
        </div>
      </div>
    )
  }

  // A blank map is indistinguishable from being zoomed somewhere empty, so
  // the first paint waits for at least one region.
  if (state.regions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-neutral-400">Loading network…</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <MapView
        regions={state.regions}
        rides={rides.rides}
        showRides={showRides}
        coverage={coverage.coverage}
        showCoverage={showCoverage}
      />
      <StatsPanel
        state={state}
        rides={rides}
        coverage={coverage}
        showRides={showRides}
        onToggleRides={() => setShowRides((v) => !v)}
        showCoverage={showCoverage}
        onToggleCoverage={() => setShowCoverage((v) => !v)}
        units={units}
        onToggleUnits={toggleUnits}
      />
    </div>
  )
}
