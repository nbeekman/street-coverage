import type { Layer } from '@deck.gl/core'
import type { ViewMode } from '../components/viewMode.ts'
import type { LoadedCoverage } from '../coverage/loadCoverage.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'
import type { LoadedRides } from '../rides/loadRides.ts'
import { createCoverageLayer } from './coverageLayer.ts'
import { createNetworkLayer } from './networkLayer.ts'
import { RegionStackLayer } from './regionStackLayer.ts'
import { createRideLayer } from './rideLayer.ts'

export type MapLayerInput = {
  regions: LoadedRegion[]
  rides: LoadedRides | null
  coverage: LoadedCoverage | null
  mode: ViewMode
  /**
   * Id of the basemap's first symbol layer. Every deck layer is inserted
   * before it, which is what keeps place labels above the network.
   *
   * Undefined until the style has loaded; layers built before then render
   * above the labels and are rebuilt once it resolves.
   */
  labelLayerId: string | undefined
  /** Year bitmask; 0 is all-time. Filters coverage runs. */
  yearMask: number
  /** Calendar year, or null for all-time. Filters ride traces. */
  selectedYear: number | null
}

/**
 * Assemble the deck.gl layers for the map.
 *
 * Extracted from the component so the z-order contract can be tested: every
 * layer returned here is inserted into maplibre's stack by MapboxOverlay, and
 * MapboxOverlay reads `beforeId` from *these* layers, not from any sublayers
 * they may render. Missing it on one of them puts the whole thing above the
 * labels -- which has happened twice.
 */
export function buildMapLayers({
  regions,
  rides,
  coverage,
  mode,
  labelLayerId,
  yearMask,
  selectedYear,
}: MapLayerInput): Layer[] {
  // Coverage mode paints the network by what has been ridden. Rides mode falls
  // back to class colors and draws the traces on top, so the two are genuinely
  // alternative readings of the same streets.
  const stack =
    mode === 'coverage' && coverage
      ? new RegionStackLayer({
          id: 'coverage-stack',
          beforeId: labelLayerId,
          regions: coverage.regions,
          bboxOf: (r: (typeof coverage.regions)[number]) => r.bbox,
          idOf: (r: (typeof coverage.regions)[number]) => r.id,
          build: (r: (typeof coverage.regions)[number]) =>
            createCoverageLayer(r, labelLayerId, yearMask),
        })
      : new RegionStackLayer({
          id: 'network-stack',
          beforeId: labelLayerId,
          regions,
          bboxOf: (r: (typeof regions)[number]) => r.manifest.bbox,
          idOf: (r: (typeof regions)[number]) => r.id,
          build: (r: (typeof regions)[number]) =>
            createNetworkLayer(r, labelLayerId, mode === 'rides'),
        })

  // Rides draw last so they sit above the network but still below labels, and
  // are never culled -- they are the reason to zoom out.
  return rides && mode === 'rides'
    ? [stack as unknown as Layer, createRideLayer(rides, labelLayerId, selectedYear)]
    : [stack as unknown as Layer]
}
