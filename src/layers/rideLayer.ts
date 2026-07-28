import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import { RIDE_TRACE_COLOR } from './colors.ts'
import type { LoadedRides } from '../rides/loadRides.ts'



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
    getColor: RIDE_TRACE_COLOR,
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

export function createRideLayer(rides: LoadedRides, beforeId?: string): PathLayer {
  return new PathLayer({ ...buildRideLayerProps(rides), beforeId } as never)
}
