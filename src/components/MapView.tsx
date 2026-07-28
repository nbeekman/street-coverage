import { useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createCoverageLayer } from '../layers/coverageLayer.ts'
import { createNetworkLayer } from '../layers/networkLayer.ts'
import { createRideLayer } from '../layers/rideLayer.ts'
import type { LoadedCoverage } from '../coverage/loadCoverage.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'
import type { LoadedRides } from '../rides/loadRides.ts'

/** Free, no-token basemap. Attribution renders from the style itself. */
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** Centered between Littleton and downtown Denver. */
const INITIAL_VIEW_STATE = {
  longitude: -105.0,
  latitude: 39.65,
  zoom: 10.5,
  pitch: 0,
  bearing: 0,
}

type Props = {
  regions: LoadedRegion[]
  rides: LoadedRides | null
  showRides: boolean
  coverage: LoadedCoverage | null
  showCoverage: boolean
}

export default function MapView({
  regions,
  rides,
  showRides,
  coverage,
  showCoverage,
}: Props) {
  const layers = useMemo(() => {
    // Coverage geometry is the same network, split at ridden/unridden
    // boundaries, so the two layer sets are alternatives rather than a stack.
    const base =
      coverage && showCoverage
        ? coverage.regions.map((region) => createCoverageLayer(region))
        : regions.map((region) => createNetworkLayer(region))

    // Rides draw last so they sit above the network.
    return rides && showRides ? [...base, createRideLayer(rides)] : base
  }, [regions, rides, showRides, coverage, showCoverage])

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      style={{ position: 'absolute', inset: '0' }}
    >
      <Map mapStyle={BASEMAP_STYLE} />
    </DeckGL>
  )
}
