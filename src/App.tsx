import { useState } from 'react'
import MapView from './components/MapView.tsx'
import PanelToggle from './components/PanelToggle.tsx'
import StatsPanel from './components/StatsPanel.tsx'
import type { ViewMode } from './components/viewMode.ts'
import { calendarYearOf, maskFor, type YearFilter } from './coverage/yearFilter.ts'
import { useCoverage } from './coverage/useCoverage.ts'
import { useNetwork } from './network/useNetwork.ts'
import { useRides } from './rides/useRides.ts'
import { useUnits } from './units/useUnits.ts'

export default function App() {
  const [mode, setMode] = useState<ViewMode>('coverage')
  const [year, setYear] = useState<YearFilter>(null)
  // Each view fetches only its own geometry. Coverage mode never needs the
  // network snapshot: the coverage manifest carries every field the stats
  // table shows, so loading it would be 5.3 MB to read four numbers from.
  const coverage = useCoverage(mode === 'coverage')
  const state = useNetwork(mode === 'rides')
  const rides = useRides(mode === 'rides')
  // Open by default on a wide screen, closed on a phone where it would cover
  // the map entirely. Read once: this is a starting state, not a live binding.
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  )
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

  // A blank map is indistinguishable from being zoomed somewhere empty, so the
  // first paint waits for geometry -- whichever kind this mode needs.
  const hasGeometry =
    mode === 'coverage'
      ? coverage.coverage !== null || coverage.status === 'absent' || coverage.status === 'error'
      : state.regions.length > 0
  if (!hasGeometry) {
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
        coverage={coverage.coverage}
        mode={mode}
        yearMask={maskFor(year)}
        selectedYear={
          year !== null ? (calendarYearOf(year, coverage.coverage?.manifest.years ?? [])) : null
        }
      />
      <PanelToggle open={panelOpen} onToggle={() => setPanelOpen((v) => !v)} />
      {panelOpen && (
        <button
          type="button"
          aria-label="Close stats"
          onClick={() => setPanelOpen(false)}
          className="absolute inset-0 z-10 bg-black/40 md:hidden"
        />
      )}
      <StatsPanel
        state={state}
        rides={rides}
        coverage={coverage}
        mode={mode}
        onModeChange={setMode}
        year={year}
        onYearChange={setYear}
        units={units}
        onToggleUnits={toggleUnits}
        open={panelOpen}
      />
    </div>
  )
}
