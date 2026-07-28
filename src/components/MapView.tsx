import { useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createNetworkLayer } from '../layers/networkLayer.ts'
import { createRideLayer } from '../layers/rideLayer.ts'
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
}

export default function MapView({ regions, rides, showRides }: Props) {
  const layers = useMemo(() => {
    const network = regions.map((region) => createNetworkLayer(region))
    // Rides draw last so they sit above the network.
    return rides && showRides ? [...network, createRideLayer(rides)] : network
  }, [regions, rides, showRides])

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
