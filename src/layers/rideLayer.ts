import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { LoadedRides } from '../rides/loadRides.ts'

/**
 * Warm and semi-transparent: overlapping traces accumulate, so streets ridden
 * many times read brighter. An honest preview of what M3 computes properly.
 */
export const RIDE_COLOR: [number, number, number, number] = [255, 90, 40, 90]

export function buildRideLayerProps(rides: LoadedRides) {
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
    getColor: RIDE_COLOR,
    widthUnits: 'pixels' as const,
    getWidth: 2,
    widthMinPixels: 1.5,
    widthMaxPixels: 6,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    updateTriggers: { getColor: [rides.manifest.version] },
  }
}

export function createRideLayer(rides: LoadedRides): PathLayer {
  return new PathLayer(buildRideLayerProps(rides) as never)
}
