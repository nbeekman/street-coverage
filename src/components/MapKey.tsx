import { RIDDEN_COLOR, RIDE_TRACE_COLOR, UNRIDDEN_COLOR, type Rgb } from '../layers/colors.ts'
import { CLASS_COLORS } from '../layers/networkLayer.ts'
import { HIGHWAY_CLASSES } from '../network/regions.ts'
import type { ViewMode } from './viewMode.ts'

const rgb = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`

/** OSM class names are not what a rider calls them. */
const CLASS_LABELS: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  tertiary: 'Tertiary',
  residential: 'Residential',
  unclassified: 'Unclassified',
  living_street: 'Living street',
  cycleway: 'Cycleway',
  path: 'Path (bike-legal)',
  bridleway: 'Bridleway (bike-legal)',
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-0.5 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * Reads the same palette the layers draw with, so the key cannot drift from
 * the map. Class entries are generated from HIGHWAY_CLASSES rather than
 * hand-listed for the same reason.
 */
export default function MapKey({ mode }: { mode: ViewMode }) {
  if (mode === 'coverage') {
    return (
      <div className="mt-2 flex gap-4 text-xs text-neutral-400">
        <Swatch color={rgb(RIDDEN_COLOR)} label="Ridden" />
        <Swatch color={rgb(UNRIDDEN_COLOR)} label="Not yet ridden" />
      </div>
    )
  }

  return (
    <div className="mt-2 text-xs text-neutral-400">
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="inline-block h-1 w-3 shrink-0 rounded-full"
          style={{
            backgroundColor: `rgba(${RIDE_TRACE_COLOR[0]},${RIDE_TRACE_COLOR[1]},${RIDE_TRACE_COLOR[2]},1)`,
          }}
        />
        <span className="text-neutral-200">Your ride traces</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-neutral-500">
        {HIGHWAY_CLASSES.map((cls, i) => (
          <Swatch
            key={cls}
            color={rgb(CLASS_COLORS[i] ?? [255, 0, 255])}
            label={CLASS_LABELS[cls] ?? cls}
          />
        ))}
      </div>
    </div>
  )
}
