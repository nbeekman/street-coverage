import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import { RIDE_TRACE_COLOR, type Rgba } from './colors.ts'

const TRANSPARENT: Rgba = [0, 0, 0, 0]
import type { LoadedRides } from '../rides/loadRides.ts'



/**
 * Calendar year of each ride, from its start time.
 *
 * Memoized per snapshot: 190 Date constructions is nothing, but rebuilding
 * the array on every filter click would be pointless work.
 */
const yearsOf = new WeakMap<LoadedRides, Int32Array>()

function rideYears(rides: LoadedRides): Int32Array {
  let years = yearsOf.get(rides)
  if (years === undefined) {
    const times = rides.buffers.times
    years = new Int32Array(times.length)
    for (let i = 0; i < times.length; i++) {
      years[i] = new Date(times[i]).getUTCFullYear()
    }
    yearsOf.set(rides, years)
  }
  return years
}

export function buildRideLayerProps(rides: LoadedRides, selectedYear: number | null = null) {
  const years = rideYears(rides)

  // Non-matching rides go fully transparent rather than being removed from the
  // buffer: dropping them would mean rebuilding `data`, and deck.gl would
  // re-upload every trace on each year click. There are only 190 paths.
  const color = (_: unknown, info: { index: number }) =>
    selectedYear === null || years[info.index] === selectedYear
      ? RIDE_TRACE_COLOR
      : TRANSPARENT

  return {
    id: 'rides',
    data: {
      length: rides.manifest.rideCount,
      startIndices: rides.buffers.startIndices,
      attributes: { getPath: { value: rides.offsets, size: 2 } },
    },
    _pathType: 'open' as const,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
    coordinateOrigin: rides.origin,
    getColor: color,
    widthUnits: 'pixels' as const,
    getWidth: 2,
    widthMinPixels: 1.5,
    widthMaxPixels: 6,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    updateTriggers: { getColor: [rides.manifest.version, selectedYear] },
  }
}

export function createRideLayer(
  rides: LoadedRides,
  beforeId?: string,
  selectedYear: number | null = null,
): PathLayer {
  return new PathLayer({ ...buildRideLayerProps(rides, selectedYear), beforeId } as never)
}
